#!/usr/bin/env bash
# Runs a meta check on a Google Cloud spot VM and pulls the results back.
#
# Needs the Cloud SDK installed and signed in on this machine first:
#   gcloud auth login
#   gcloud config set project <project id>
#   gcloud storage buckets create gs://<project id>-meta --location=<region>
#
# Usage:
#   scripts/gcp-meta.sh <tag> [seeds] [rounds] [machine type] [zone] [max run] [first seed]
# Defaults: 2 seeds, 200 rounds, c3-standard-88, us-central1-a, a 10 hour cap
# after which the VM stops itself, and seed 1.
#
# What it does, in order: publishes the trainer self-contained for Linux so the
# VM needs no runtime, puts the build in the project's transfer bucket, creates
# a spot VM that fetches it, starts every seed at once with the machine's cores
# split between them, waits, builds the SQLite databases the meta check is read
# from, has the VM upload runs/<tag>*/ to the bucket, copies them into this
# repository's runs/ folder, and deletes the VM whatever happened. Bulk data
# goes through the bucket because the copies the SDK makes over ssh from
# Windows drop large transfers. Read the results with the meta-check skill.
#
# A spot VM can be pre-empted. It stops rather than deletes itself, the poll
# loop starts it again and relaunches the trainer, which resumes every seed
# from its snapshot. Rerunning this script with the same tag also resumes;
# delete runs/<tag>* first to start over.
set -euo pipefail

TAG=${1:?usage: gcp-meta.sh <tag> [seeds] [rounds] [machine] [zone] [max run] [first seed]}
SEEDS=${2:-2}
ROUNDS=${3:-200}
MACHINE=${4:-c3-standard-88}
ZONE=${5:-us-central1-a}
MAX_RUN=${6:-10h}
SEED0=${7:-1}
VM="meta-${TAG}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
BUCKET="gs://${PROJECT}-meta"
BUILD=$(mktemp -d)

cleanup() {
  echo "deleting ${VM}"
  gcloud compute instances delete "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

ssh_vm() {
  gcloud compute ssh "${VM}" --zone "${ZONE}" --quiet --command "$1"
}

echo "publishing the trainer for linux-x64"
dotnet publish csharp/Selatza.Train -c Release -r linux-x64 --self-contained true \
  -o "${BUILD}/train" -v q --nologo

echo "staging the build in ${BUCKET}"
gcloud storage rm -r "${BUCKET}/train-${TAG}" >/dev/null 2>&1 || true
gcloud storage cp -r "${BUILD}/train" "${BUCKET}/train-${TAG}/" >/dev/null
# An existing runs/<tag>* goes up too, so the trainer can resume after a
# pre-emption that lost the machine, or a rerun of this script.
if ls runs/${TAG}[0-9]* >/dev/null 2>&1; then
  gcloud storage cp -r runs/${TAG}[0-9]* "${BUCKET}/runs-${TAG}/" >/dev/null
fi

echo "creating ${VM} (${MACHINE}, spot, ${ZONE})"
gcloud compute instances create "${VM}" --zone "${ZONE}" --machine-type "${MACHINE}" \
  --provisioning-model=SPOT --instance-termination-action=STOP \
  --max-run-duration="${MAX_RUN}" \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=200GB \
  --boot-disk-type=pd-balanced >/dev/null

wait_ssh() {
  for i in $(seq 1 18); do
    if ssh_vm "true" >/dev/null 2>&1; then return 0; fi
    sleep 10
  done
  return 1
}
wait_ssh

echo "fetching the build on the machine"
ssh_vm "mkdir -p ~/runs && gcloud storage cp -r ${BUCKET}/train-${TAG}/train ~/ >/dev/null 2>&1 && chmod +x ~/train/Selatza.Train && (gcloud storage cp -r ${BUCKET}/runs-${TAG}/* ~/runs/ >/dev/null 2>&1 || true)"

CORES=$(ssh_vm "nproc" 2>/dev/null | tr -d '[:space:]')
THREADS=$(( CORES / SEEDS ))
if [ "${THREADS}" -lt 1 ]; then THREADS=1; fi
echo "${CORES} cores, ${SEEDS} seeds at ${THREADS} threads each, ${ROUNDS} rounds"

# Started detached so a dropped ssh session does not end the run. The
# databases follow once every seed has finished, then everything goes to the
# bucket and a marker says so.
RUN='cd ~ && rm -f runs/ALL_DONE && ('
for s in $(seq "${SEED0}" $(( SEED0 + SEEDS - 1 ))); do
  RUN+="./train/Selatza.Train train --no-net --every-leader --leader-pool meta --rounds ${ROUNDS} --games 6 --seed ${s} --threads ${THREADS} --out runs/${TAG}${s} --log-games runs/${TAG}${s}/games.szgl > runs/${TAG}${s}.log 2>&1 & "
done
RUN+='wait; '
for s in $(seq "${SEED0}" $(( SEED0 + SEEDS - 1 ))); do
  RUN+="./train/Selatza.Train db --log runs/${TAG}${s}/games.szgl --db runs/${TAG}${s}/games.db > runs/${TAG}${s}.db.log 2>&1 & "
done
RUN+="wait; gcloud storage cp -r runs/${TAG}* ${BUCKET}/runs-${TAG}/ > runs/upload.log 2>&1; touch runs/ALL_DONE) > runs/driver.log 2>&1 &"

launch() {
  ssh_vm "nohup bash -c '${RUN}' >/dev/null 2>&1 &"
}
launch

echo "running; polling every five minutes"
while true; do
  sleep 300
  STATUS=$(gcloud compute instances describe "${VM}" --zone "${ZONE}" --format="value(status)" 2>/dev/null || echo "GONE")
  if [ "${STATUS}" = "TERMINATED" ] || [ "${STATUS}" = "STOPPED" ]; then
    echo "pre-empted; starting ${VM} again and resuming"
    gcloud compute instances start "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1 || true
    wait_ssh || true
    launch
    continue
  fi
  if ssh_vm "test -f ~/runs/ALL_DONE" >/dev/null 2>&1; then break; fi
  ssh_vm "tail -n 1 ~/runs/${TAG}${SEED0}.log" 2>/dev/null | cut -c1-100 || true
done

echo "pulling the results from ${BUCKET} into runs/"
mkdir -p runs
gcloud storage cp -r "${BUCKET}/runs-${TAG}/*" runs/ >/dev/null
ls -l runs/${TAG}*/games.db
echo "done: read runs/${TAG}${SEED0} .. runs/${TAG}$(( SEED0 + SEEDS - 1 )) with the meta-check skill"
