#!/usr/bin/env bash
# Plays a folder of decks against each other, every pair, on a Google Cloud spot
# VM, and pulls the payoff matrix back.
#
# Usage:
#   scripts/gcp-roundrobin.sh <tag> <deck folder> [games] [machines] [zones] [max run]
#
# The decks are staged to the bucket with the build, the machine writes one CSV
# row per pairing as it finishes and uploads the file every five minutes, and
# this script watches the bucket. A pre-empted machine that starts again reads
# the CSV it already wrote and continues from there, so stopping at any moment
# keeps every pairing already played.
#
# Full search, deliberately: a payoff matrix that a weaker bot produced says
# what that bot's metagame looks like rather than the shipped one's.
set -euo pipefail
export PATH="$PATH:/c/Users/Krazv/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin"

TAG=${1:?usage: gcp-roundrobin.sh <tag> <deck folder> [games] [machines] [zones] [max run]}
DECKS=${2:?deck folder}
GAMES=${3:-12}
MACHINES=${4:-c3-standard-176,c3-standard-88}
ZONES=${5:-us-central1-a,us-central1-b,us-central1-c,us-central1-f,us-east1-b,us-east1-c,us-east1-d,europe-west4-a,europe-west4-b,europe-west4-c}
MAX_RUN=${6:-14h}
VM="rr-${TAG}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
BUCKET="gs://${PROJECT}-meta"
BUILD=$(mktemp -d)
CSV="runs/rr-${TAG}.csv"

[ -d "${DECKS}" ] || { echo "no deck folder at ${DECKS}"; exit 2; }
COUNT=$(find "${DECKS}" -name '*.txt' | wc -l | tr -d ' ')
echo "${DECKS}: ${COUNT} files, ${GAMES} games a pairing"

cleanup() {
  echo "deleting ${VM}"
  gcloud compute instances delete "${VM}" --zone "${FOUND_ZONE:-us-central1-a}" --quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "publishing the trainer for linux-x64"
dotnet publish csharp/Selatza.Train -c Release -r linux-x64 --self-contained true \
  -o "${BUILD}/train" -v q --nologo

echo "staging in ${BUCKET}"
gcloud storage rm -r "${BUCKET}/rr-${TAG}" >/dev/null 2>&1 || true
gcloud storage cp -r "${BUILD}/train" "${BUCKET}/rr-${TAG}/" >/dev/null
gcloud storage cp -r "${DECKS}" "${BUCKET}/rr-${TAG}/decks/" >/dev/null
# A CSV from an earlier attempt is what the machine resumes from.
[ -f "${CSV}" ] && gcloud storage cp "${CSV}" "${BUCKET}/rr-${TAG}/out.csv" >/dev/null

DECKDIR=$(basename "${DECKS}")
STARTUP="${BUILD}/startup.sh"
{
  echo '#!/bin/bash'
  echo 'set -u'
  echo 'cd /root'
  echo "gcloud storage cp -r ${BUCKET}/rr-${TAG}/train /root/ >/dev/null 2>&1"
  echo "gcloud storage cp -r ${BUCKET}/rr-${TAG}/decks /root/ >/dev/null 2>&1"
  echo 'chmod +x /root/train/Selatza.Train'
  echo 'mkdir -p runs'
  # Only onto a fresh disk: after a pre-emption the disk holds more rows than
  # the bucket does.
  echo "[ -f runs/out.csv ] || gcloud storage cp ${BUCKET}/rr-${TAG}/out.csv runs/out.csv >/dev/null 2>&1 || true"
  echo 'rm -f runs/ALL_DONE'
  echo "( while true; do sleep 300; gcloud storage cp runs/out.csv ${BUCKET}/rr-${TAG}/out.csv >/dev/null 2>&1; tail -n 2 runs/rr.log > runs/progress.txt 2>/dev/null; gcloud storage cp runs/progress.txt ${BUCKET}/rr-${TAG}/progress.txt >/dev/null 2>&1; done ) &"
  echo 'PROGRESS=$!'
  echo "./train/Selatza.Train roundrobin --decks /root/decks/${DECKDIR} --games ${GAMES} --threads \$(nproc) --out runs/out.csv > runs/rr.log 2>&1"
  echo 'kill $PROGRESS 2>/dev/null'
  echo "gcloud storage cp runs/out.csv ${BUCKET}/rr-${TAG}/out.csv >/dev/null 2>&1"
  echo "gcloud storage cp runs/rr.log ${BUCKET}/rr-${TAG}/rr.log >/dev/null 2>&1"
  echo 'touch runs/ALL_DONE'
  echo "gcloud storage cp runs/ALL_DONE ${BUCKET}/rr-${TAG}/ALL_DONE >/dev/null 2>&1"
} > "${STARTUP}"

FOUND_ZONE=""
IFS=',' read -r -a MACHINE_LIST <<< "${MACHINES}"
IFS=',' read -r -a ZONE_LIST <<< "${ZONES}"
for m in "${MACHINE_LIST[@]}"; do
  for z in "${ZONE_LIST[@]}"; do
    echo "creating ${VM} (${m}, spot, ${z})"
    if gcloud compute instances create "${VM}" --zone "${z}" --machine-type "${m}" \
        --provisioning-model=SPOT --instance-termination-action=STOP \
        --max-run-duration="${MAX_RUN}" \
        --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=100GB \
        --scopes=cloud-platform \
        --metadata-from-file=startup-script="${STARTUP}" >/dev/null 2>&1; then
      FOUND_ZONE="${z}"
      echo "created ${VM} as ${m} in ${z}"
      break 2
    fi
  done
done
[ -n "${FOUND_ZONE}" ] || { echo "no capacity for any shape in any zone"; exit 3; }

echo "running; watching ${BUCKET}/rr-${TAG}/ every five minutes"
while true; do
  sleep 300
  if gcloud storage ls "${BUCKET}/rr-${TAG}/ALL_DONE" >/dev/null 2>&1; then break; fi
  state=$(gcloud compute instances describe "${VM}" --zone "${FOUND_ZONE}" --format='value(status)' 2>/dev/null || echo GONE)
  if [ "${state}" != "RUNNING" ]; then
    echo "machine is ${state}; starting it again"
    gcloud compute instances start "${VM}" --zone "${FOUND_ZONE}" --quiet >/dev/null 2>&1 || true
  fi
  gcloud storage cat "${BUCKET}/rr-${TAG}/progress.txt" 2>/dev/null | tail -n 1 || true
done

echo "pulling the matrix"
gcloud storage cp "${BUCKET}/rr-${TAG}/out.csv" "${CSV}" >/dev/null
echo "done: ${CSV} holds $(( $(wc -l < "${CSV}") - 1 )) pairings"
