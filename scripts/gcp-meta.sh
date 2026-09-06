#!/usr/bin/env bash
# Runs a meta check on a Google Cloud spot VM and pulls the results back.
#
# Needs the Cloud SDK installed and signed in on this machine first:
#   gcloud auth login
#   gcloud config set project <project id>
#
# Usage:
#   scripts/gcp-meta.sh <tag> [seeds] [rounds] [machine type] [zone]
# Defaults: 2 seeds, 200 rounds, c3-standard-88, us-central1-a.
#
# What it does, in order: publishes the trainer self-contained for Linux so the
# VM needs no runtime, creates a spot VM, uploads the build, starts every seed
# at once with the machine's cores split between them, waits, builds the
# SQLite databases the meta check is read from, copies runs/<tag>*/ back into
# this repository's runs/ folder, and deletes the VM whatever happened. Read the
# results with the meta-check skill as usual.
#
# A spot VM can be pre-empted. The trainer resumes from its snapshot when the
# same --out is reused, so rerunning this script with the same tag after a
# pre-emption continues rather than restarts; delete runs/<tag>* first to start
# over.
set -euo pipefail

TAG=${1:?usage: gcp-meta.sh <tag> [seeds] [rounds] [machine] [zone]}
SEEDS=${2:-2}
ROUNDS=${3:-200}
MACHINE=${4:-c3-standard-88}
ZONE=${5:-us-central1-a}
VM="meta-${TAG}"
BUILD=$(mktemp -d)

cleanup() {
  echo "deleting ${VM}"
  gcloud compute instances delete "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "publishing the trainer for linux-x64"
dotnet publish csharp/Selatza.Train -c Release -r linux-x64 --self-contained true \
  -o "${BUILD}/train" -v q --nologo

echo "creating ${VM} (${MACHINE}, spot, ${ZONE})"
gcloud compute instances create "${VM}" --zone "${ZONE}" --machine-type "${MACHINE}" \
  --provisioning-model=SPOT --instance-termination-action=DELETE \
  --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=200GB \
  --boot-disk-type=pd-balanced >/dev/null

# The first ssh can take a minute to accept a key.
for i in $(seq 1 12); do
  if gcloud compute ssh "${VM}" --zone "${ZONE}" --command "true" >/dev/null 2>&1; then break; fi
  sleep 10
done

echo "uploading the build"
gcloud compute scp --zone "${ZONE}" --recurse "${BUILD}/train" "${VM}:~/train" >/dev/null
# Uploading an existing runs/<tag>* lets the trainer resume after a pre-emption.
if ls runs/${TAG}[0-9]* >/dev/null 2>&1; then
  gcloud compute ssh "${VM}" --zone "${ZONE}" --command "mkdir -p ~/runs" >/dev/null
  gcloud compute scp --zone "${ZONE}" --recurse runs/${TAG}[0-9]* "${VM}:~/runs/" >/dev/null
fi

CORES=$(gcloud compute ssh "${VM}" --zone "${ZONE}" --command "nproc" 2>/dev/null | tr -d '[:space:]')
THREADS=$(( CORES / SEEDS ))
if [ "${THREADS}" -lt 1 ]; then THREADS=1; fi
echo "${CORES} cores, ${SEEDS} seeds at ${THREADS} threads each, ${ROUNDS} rounds"

# Started detached so a dropped ssh session does not end the run. Each seed
# writes a done marker; the databases follow once every seed has one.
RUN='cd ~ && chmod +x train/Selatza.Train && mkdir -p runs && rm -f runs/ALL_DONE && ('
for s in $(seq 1 "${SEEDS}"); do
  RUN+="./train/Selatza.Train train --no-net --every-leader --leader-pool meta --rounds ${ROUNDS} --games 6 --seed ${s} --threads ${THREADS} --out runs/${TAG}${s} --log-games runs/${TAG}${s}/games.szgl > runs/${TAG}${s}.log 2>&1 & "
done
RUN+='wait; '
for s in $(seq 1 "${SEEDS}"); do
  RUN+="./train/Selatza.Train db --log runs/${TAG}${s}/games.szgl --db runs/${TAG}${s}/games.db > runs/${TAG}${s}.db.log 2>&1 & "
done
RUN+='wait; touch runs/ALL_DONE) > runs/driver.log 2>&1 &'
gcloud compute ssh "${VM}" --zone "${ZONE}" --command "nohup bash -c '${RUN}' >/dev/null 2>&1 &"

echo "running; polling every five minutes"
while true; do
  sleep 300
  if gcloud compute ssh "${VM}" --zone "${ZONE}" --command "test -f ~/runs/ALL_DONE" >/dev/null 2>&1; then break; fi
  gcloud compute ssh "${VM}" --zone "${ZONE}" --command "tail -n 1 ~/runs/${TAG}1.log" 2>/dev/null | cut -c1-100 || true
done

echo "pulling the results into runs/"
mkdir -p runs
gcloud compute scp --zone "${ZONE}" --recurse "${VM}:~/runs/${TAG}*" runs/ >/dev/null
ls -l runs/${TAG}*/games.db
echo "done: read runs/${TAG}1 .. runs/${TAG}${SEEDS} with the meta-check skill"
