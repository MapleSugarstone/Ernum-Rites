#!/usr/bin/env bash
# Evolves one deck against a single fixed opponent on a Google Cloud spot VM.
#
# Usage:
#   scripts/gcp-climb.sh <tag> <deck file> <opponent file> [rounds] [target] [machines] [zones] [max run]
#
# The machine writes its best deck after every round and uploads it every five
# minutes. A pre-empted machine that starts again reads that deck back and
# climbs on from it, so stopping at any moment keeps the progress made.
#
# Full search throughout: a deck tuned by a weaker bot is tuned for that bot.
set -euo pipefail
export PATH="$PATH:/c/Users/Krazv/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin"

TAG=${1:?usage: gcp-climb.sh <tag> <deck> <opponent> [rounds] [target] [machines] [zones] [max run]}
DECK=${2:?deck file}
FOE=${3:?opponent file}
ROUNDS=${4:-30}
TARGET=${5:-0.55}
MACHINES=${6:-c3-standard-176,c3-standard-88}
ZONES=${7:-us-central1-a,us-central1-b,us-central1-c,us-central1-f,us-east1-b,us-east1-c,us-east1-d,europe-west4-a,europe-west4-b,europe-west4-c}
MAX_RUN=${8:-14h}
# Population sizes for the race. A round screens POP mutants cheaply, then plays
# the best FINALISTS and the incumbent properly, so the games go to the decision
# that matters rather than being spread evenly over mutants most of which lose.
CLIMBOPTS=${CLIMBOPTS:---pop 24 --screen 16 --finalists 4 --games 120 --confirm 1200}
VM="climb-${TAG}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
BUCKET="gs://${PROJECT}-meta"
BUILD=$(mktemp -d)
OUT="runs/climb-${TAG}.txt"

[ -f "${DECK}" ] || { echo "no deck at ${DECK}"; exit 2; }
[ -f "${FOE}" ] || { echo "no opponent at ${FOE}"; exit 2; }

cleanup() {
  echo "deleting ${VM}"
  gcloud compute instances delete "${VM}" --zone "${FOUND_ZONE:-us-central1-a}" --quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "publishing the trainer for linux-x64"
dotnet publish csharp/Selatza.Train -c Release -r linux-x64 --self-contained true \
  -o "${BUILD}/train" -v q --nologo

echo "staging in ${BUCKET}"
gcloud storage rm -r "${BUCKET}/climb-${TAG}" >/dev/null 2>&1 || true
gcloud storage cp -r "${BUILD}/train" "${BUCKET}/climb-${TAG}/" >/dev/null
gcloud storage cp "${DECK}" "${BUCKET}/climb-${TAG}/start.txt" >/dev/null
gcloud storage cp "${FOE}" "${BUCKET}/climb-${TAG}/foe.txt" >/dev/null
# A deck from an earlier attempt is what the machine climbs on from.
[ -f "${OUT}" ] && gcloud storage cp "${OUT}" "${BUCKET}/climb-${TAG}/best.txt" >/dev/null

STARTUP="${BUILD}/startup.sh"
{
  echo '#!/bin/bash'
  echo 'set -u'
  echo 'cd /root'
  echo "gcloud storage cp -r ${BUCKET}/climb-${TAG}/train /root/ >/dev/null 2>&1"
  echo "gcloud storage cp ${BUCKET}/climb-${TAG}/start.txt /root/start.txt >/dev/null 2>&1"
  echo "gcloud storage cp ${BUCKET}/climb-${TAG}/foe.txt /root/foe.txt >/dev/null 2>&1"
  echo 'chmod +x /root/train/Selatza.Train'
  echo 'mkdir -p runs'
  # Only onto a fresh disk: after a pre-emption the disk holds a later deck
  # than the bucket does.
  echo "[ -f runs/best.txt ] || gcloud storage cp ${BUCKET}/climb-${TAG}/best.txt runs/best.txt >/dev/null 2>&1 || true"
  echo 'rm -f runs/ALL_DONE'
  echo "( while true; do sleep 300; gcloud storage cp runs/best.txt ${BUCKET}/climb-${TAG}/best.txt >/dev/null 2>&1; tail -n 3 runs/climb.log > runs/progress.txt 2>/dev/null; gcloud storage cp runs/progress.txt ${BUCKET}/climb-${TAG}/progress.txt >/dev/null 2>&1; done ) &"
  echo 'PROGRESS=$!'
  echo 'START=/root/start.txt'
  echo '[ -s runs/best.txt ] && START=runs/best.txt'
  echo "./train/Selatza.Train climb --deck \$START --vs /root/foe.txt --rounds ${ROUNDS} --target ${TARGET} ${CLIMBOPTS} --threads \$(nproc) --out runs/best.txt > runs/climb.log 2>&1"
  echo 'kill $PROGRESS 2>/dev/null'
  echo "gcloud storage cp runs/best.txt ${BUCKET}/climb-${TAG}/best.txt >/dev/null 2>&1"
  echo "gcloud storage cp runs/climb.log ${BUCKET}/climb-${TAG}/climb.log >/dev/null 2>&1"
  echo 'touch runs/ALL_DONE'
  echo "gcloud storage cp runs/ALL_DONE ${BUCKET}/climb-${TAG}/ALL_DONE >/dev/null 2>&1"
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

echo "running; watching ${BUCKET}/climb-${TAG}/ every five minutes"
while true; do
  sleep 300
  if gcloud storage ls "${BUCKET}/climb-${TAG}/ALL_DONE" >/dev/null 2>&1; then break; fi
  state=$(gcloud compute instances describe "${VM}" --zone "${FOUND_ZONE}" --format='value(status)' 2>/dev/null || echo GONE)
  if [ "${state}" != "RUNNING" ]; then
    echo "machine is ${state}; starting it again"
    gcloud compute instances start "${VM}" --zone "${FOUND_ZONE}" --quiet >/dev/null 2>&1 || true
  fi
  gcloud storage cat "${BUCKET}/climb-${TAG}/progress.txt" 2>/dev/null | tail -n 1 || true
done

echo "pulling the deck"
gcloud storage cp "${BUCKET}/climb-${TAG}/best.txt" "${OUT}" >/dev/null
gcloud storage cp "${BUCKET}/climb-${TAG}/climb.log" "runs/climb-${TAG}.log" >/dev/null 2>&1 || true
echo "done: ${OUT}"
tail -n 3 "runs/climb-${TAG}.log" 2>/dev/null || true
