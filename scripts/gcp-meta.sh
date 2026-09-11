#!/usr/bin/env bash
# Runs a meta check on a Google Cloud spot VM and pulls the results back.
#
# Needs the Cloud SDK installed and signed in on this machine first:
#   gcloud auth login
#   gcloud config set project <project id>
#   gcloud storage buckets create gs://<project id>-meta --location=<region>
# and the project's default compute service account granted
# roles/storage.objectAdmin on that bucket, so the machine can read the build
# and write the results.
#
# Usage:
#   scripts/gcp-meta.sh <tag> [seeds] [rounds] [machine type] [zone] [max run] [first seed]
# Defaults: 2 seeds, 200 rounds, n2-standard-128, us-central1-a, a 14 hour cap
# after which the VM stops itself, and seed 1.
#
# What it does, in order: publishes the trainer self-contained for Linux so the
# VM needs no runtime, puts the build in the project's transfer bucket along
# with any existing runs/<tag>* for a resume, and creates a spot VM whose
# startup script fetches both, runs every seed at once with the cores split
# between them, builds the SQLite databases, uploads runs/<tag>* to the bucket
# and writes a done marker there. This script then only watches the bucket:
# no ssh is on the critical path, because the SDK's tunnelled ssh from
# Windows drops long commands and large copies. When the marker appears it
# copies the results into this repository's runs/ folder and deletes the VM.
#
# A spot VM can be pre-empted. It stops rather than deletes itself, this
# script starts it again, and the startup script runs again at boot and the
# trainer resumes every seed from the snapshot on the disk. Rerunning this
# script with the same tag also resumes; delete runs/<tag>* first to start
# over.
set -euo pipefail

TAG=${1:?usage: gcp-meta.sh <tag> [seeds] [rounds] [machine] [zone] [max run] [first seed]}
SEEDS=${2:-2}
ROUNDS=${3:-200}
MACHINE=${4:-n2-standard-128}
ZONE=${5:-us-central1-a}
MAX_RUN=${6:-14h}
SEED0=${7:-1}
VM="meta-${TAG}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
BUCKET="gs://${PROJECT}-meta"
BUILD=$(mktemp -d)
SEED1=$(( SEED0 + SEEDS - 1 ))

# A run may name its own leaders in runs/roster-<tag>.txt, one comma-separated
# list of card ids. The ids are read here and written into the startup script,
# so a relaunch from the keeper picks up the same roster without being told.
POOL="--every-leader --leader-pool meta"
ROSTER="runs/roster-${TAG}.txt"
if [ -f "${ROSTER}" ]; then
  LEADERS=$(tr -d ' \r\n' < "${ROSTER}")
  COUNT=$(printf '%s' "${LEADERS}" | tr ',' '\n' | grep -c .)
  POOL="--leaders ${LEADERS} --agents ${COUNT}"
  echo "roster ${ROSTER}: ${COUNT} leaders"
fi

# Extra trainer flags for this run, one line in runs/flags-<tag>.txt. Read here
# and written into the startup script, so a keeper relaunch keeps them.
EXTRA=""
if [ -f "runs/flags-${TAG}.txt" ]; then
  EXTRA=$(head -n 1 "runs/flags-${TAG}.txt" | tr -d '\r')
  echo "flags runs/flags-${TAG}.txt: ${EXTRA}"
fi

# Decks to start the population from, rather than generating random ones. The
# flags file names the path on the machine; this only has to put them there.
SEEDDECKS="runs/seeddecks-${TAG}"

# Decks a person built, played frozen beside the evolving field. Same idea as
# the roster: the folder is named for the tag, so a keeper relaunch keeps them.
REFDECKS="runs/refdecks-${TAG}"
REFFLAG=""
if [ -d "${REFDECKS}" ]; then
  REFCOUNT=$(find "${REFDECKS}" -name '*.txt' | wc -l | tr -d ' ')
  if [ "${REFCOUNT}" -gt 0 ]; then
    REFFLAG="--reference-decks /root/refdecks-${TAG}"
    echo "reference decks ${REFDECKS}: ${REFCOUNT}"
  fi
fi

cleanup() {
  echo "deleting ${VM}"
  gcloud compute instances delete "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "publishing the trainer for linux-x64"
dotnet publish csharp/Selatza.Train -c Release -r linux-x64 --self-contained true \
  -o "${BUILD}/train" -v q --nologo

echo "staging the build in ${BUCKET}"
gcloud storage rm -r "${BUCKET}/train-${TAG}" >/dev/null 2>&1 || true
gcloud storage rm "${BUCKET}/runs-${TAG}/ALL_DONE" >/dev/null 2>&1 || true
gcloud storage cp -r "${BUILD}/train" "${BUCKET}/train-${TAG}/" >/dev/null
if [ -n "${REFFLAG}" ]; then
  gcloud storage rm -r "${BUCKET}/refdecks-${TAG}" >/dev/null 2>&1 || true
  gcloud storage cp -r "${REFDECKS}" "${BUCKET}/refdecks-${TAG}/" >/dev/null
fi
if [ -d "${SEEDDECKS}" ]; then
  gcloud storage rm -r "${BUCKET}/seeddecks-${TAG}" >/dev/null 2>&1 || true
  gcloud storage cp -r "${SEEDDECKS}" "${BUCKET}/seeddecks-${TAG}/" >/dev/null
  echo "seed decks ${SEEDDECKS}: $(find "${SEEDDECKS}" -name '*.txt' | wc -l | tr -d ' ')"
fi
# Only the seed folders this run names. A pattern once matched a stale
# folder from another tag whose name happened to fit (tag meta2 seed 1 and
# tag meta seed 21 are both runs/meta21) and offered it as a resume.
for s in $(seq "${SEED0}" "${SEED1}"); do
  if [ -f "runs/${TAG}${s}/snapshot.bin" ]; then
    echo "uploading runs/${TAG}${s} for a resume"
    gcloud storage cp -r "runs/${TAG}${s}" "${BUCKET}/runs-${TAG}/" >/dev/null
  fi
done

# The whole run, as the machine's startup script. It runs at every boot, so a
# pre-empted machine that is started again resumes on its own.
STARTUP="${BUILD}/startup.sh"
{
  echo '#!/bin/bash'
  echo 'set -u'
  echo 'cd /root'
  echo 'mkdir -p runs'
  echo "gcloud storage cp -r ${BUCKET}/train-${TAG}/train /root/ >/dev/null 2>&1"
  echo 'chmod +x /root/train/Selatza.Train'
  if [ -n "${REFFLAG}" ]; then
    echo "gcloud storage cp -r ${BUCKET}/refdecks-${TAG}/refdecks-${TAG} /root/ >/dev/null 2>&1"
  fi
  if [ -d "${SEEDDECKS}" ]; then
    echo "gcloud storage cp -r ${BUCKET}/seeddecks-${TAG}/seeddecks-${TAG} /root/ >/dev/null 2>&1"
  fi
  # Only onto a fresh disk. After a pre-emption the disk holds a newer
  # snapshot than the bucket, and copying over it once cost ninety rounds.
  echo "[ -f runs/${TAG}${SEED0}/snapshot.bin ] || gcloud storage cp -r ${BUCKET}/runs-${TAG}/* /root/runs/ >/dev/null 2>&1 || true"
  echo 'rm -f runs/ALL_DONE'
  # Progress goes to the bucket every five minutes for the watcher to read.
  echo "( while true; do sleep 300; tail -n 1 runs/${TAG}${SEED0}.log > runs/progress.txt 2>/dev/null; gcloud storage cp runs/progress.txt ${BUCKET}/runs-${TAG}/progress.txt >/dev/null 2>&1; done ) &"
  echo 'PROGRESS=$!'
  # A checkpoint of every run folder every fifteen minutes, so a machine lost
  # to a zone that cannot start it again is relaunched elsewhere from the
  # last checkpoint rather than from the beginning.
  echo "( while true; do sleep 900; for d in runs/${TAG}[0-9]*/; do [ -d \"\$d\" ] && gcloud storage cp -r \"\$d\" ${BUCKET}/runs-${TAG}/ >/dev/null 2>&1; done; done ) &"
  echo 'CHECKPOINT=$!'
  echo "THREADS=\$(( \$(nproc) / ${SEEDS} ))"
  echo '[ "$THREADS" -lt 1 ] && THREADS=1'
  # The waits name their jobs: a bare wait would also wait on the progress
  # loop above and never reach the databases. A trainer that resumes writes
  # a fresh log beside the earlier one, so the db command takes a pattern.
  echo 'PIDS=""'
  for s in $(seq "${SEED0}" "${SEED1}"); do
    echo "./train/Selatza.Train train --no-net ${POOL} ${REFFLAG} ${EXTRA} --rounds ${ROUNDS} --games 6 --seed ${s} --threads \$THREADS --out runs/${TAG}${s} --log-games runs/${TAG}${s}/games.szgl >> runs/${TAG}${s}.log 2>&1 & PIDS=\"\$PIDS \$!\""
  done
  echo 'wait $PIDS'
  echo 'DBS=""'
  for s in $(seq "${SEED0}" "${SEED1}"); do
    echo "./train/Selatza.Train db --log \"runs/${TAG}${s}/games*.szgl\" --db runs/${TAG}${s}/games.db > runs/${TAG}${s}.db.log 2>&1 & DBS=\"\$DBS \$!\""
  done
  echo 'wait $DBS'
  echo 'kill $PROGRESS 2>/dev/null'
  echo 'kill $CHECKPOINT 2>/dev/null'
  echo "gcloud storage cp -r runs/${TAG}* ${BUCKET}/runs-${TAG}/ > runs/upload.log 2>&1"
  echo 'touch runs/ALL_DONE'
  echo "gcloud storage cp runs/ALL_DONE ${BUCKET}/runs-${TAG}/ALL_DONE >/dev/null 2>&1"
} > "${STARTUP}"

# Spot capacity comes and goes by zone and by machine type, so both may be
# given as comma-separated lists, tried in order until one is available.
CREATED=""
for M in ${MACHINE//,/ }; do
  for Z in ${ZONE//,/ }; do
    echo "creating ${VM} (${M}, spot, ${Z}), ${SEEDS} seeds, ${ROUNDS} rounds"
    if gcloud compute instances create "${VM}" --zone "${Z}" --machine-type "${M}" \
      --provisioning-model=SPOT --instance-termination-action=STOP \
      --max-run-duration="${MAX_RUN}" \
      --scopes=https://www.googleapis.com/auth/cloud-platform \
      --metadata-from-file=startup-script="${STARTUP}" \
      --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=200GB \
      --boot-disk-type=pd-balanced >/dev/null 2>"${BUILD}/create.err"; then
      CREATED="yes"; MACHINE="${M}"; ZONE="${Z}"; break 2
    fi
    grep -m1 -E "code:|ERROR" "${BUILD}/create.err" | cut -c1-120 || true
  done
done
if [ -z "${CREATED}" ]; then echo "no capacity for any of ${MACHINE} in ${ZONE}"; exit 1; fi
echo "created ${VM} as ${MACHINE} in ${ZONE}"

echo "running; watching ${BUCKET}/runs-${TAG}/ every five minutes"
# A pre-empted machine is started again in its zone. When the zone has no
# capacity to start it three polls in a row, the machine is given up: the
# run's last checkpoint is in the bucket, and a caller that sees exit code 3
# can create a machine wherever there is one and resume from it.
FAILED=0
while true; do
  sleep 300
  if gcloud storage ls "${BUCKET}/runs-${TAG}/ALL_DONE" >/dev/null 2>&1; then break; fi
  STATUS=$(gcloud compute instances describe "${VM}" --zone "${ZONE}" --format="value(status)" 2>/dev/null || echo "GONE")
  if [ "${STATUS}" = "TERMINATED" ] || [ "${STATUS}" = "STOPPED" ]; then
    if gcloud compute instances start "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1; then
      echo "pre-empted; started ${VM} again, it resumes on boot"
      FAILED=0
    else
      FAILED=$((FAILED + 1))
      echo "pre-empted, and ${ZONE} has no capacity to start it again (${FAILED} of 3)"
      if [ "${FAILED}" -ge 3 ]; then
        echo "zone exhausted; the last checkpoint is in ${BUCKET}/runs-${TAG}/, relaunch elsewhere"
        exit 3
      fi
    fi
    continue
  fi
  FAILED=0
  gcloud storage cat "${BUCKET}/runs-${TAG}/progress.txt" 2>/dev/null | cut -c1-100 || true
done

echo "pulling the results from ${BUCKET} into runs/"
mkdir -p runs
gcloud storage cp -r "${BUCKET}/runs-${TAG}/${TAG}*" runs/ >/dev/null
ls -l runs/${TAG}*/games.db
echo "done: read runs/${TAG}${SEED0} .. runs/${TAG}${SEED1} with the meta-check skill"
