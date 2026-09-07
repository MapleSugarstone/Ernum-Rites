#!/usr/bin/env bash
# Runs paired head-to-heads on a Google Cloud spot VM and pulls the logs back.
#
# Needs the same setup as gcp-meta.sh: the Cloud SDK signed in, the project
# set, and the project's transfer bucket gs://<project id>-meta.
#
# Usage:
#   scripts/gcp-versus.sh <tag> <games> <machine list> <zone list> <arm> [<arm> ...]
# Each <arm> is one quoted string of arguments for `Selatza.Sim versus` after
# --games and --threads, for example "--decks candy --seed 22 --set WorstCase=1".
# Every arm runs at once with the cores split between them. The logs come back
# as runs/versus-<tag>/arm-<n>.log, one per arm in the order given, and the
# first line of each names the arm.
#
# The machine and zone may be comma-separated lists tried in order, the same
# as gcp-meta.sh. The VM stops itself after two hours whatever happens, and
# this script deletes it when the logs are in.
set -euo pipefail

TAG=${1:?usage: gcp-versus.sh <tag> <games> <machine list> <zone list> <arm> [<arm> ...]}
GAMES=${2:?games}
MACHINE=${3:?machine list}
ZONE=${4:?zone list}
shift 4
if [ $# -lt 1 ]; then echo "at least one arm is needed"; exit 1; fi
ARMS=("$@")
VM="versus-${TAG}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
BUCKET="gs://${PROJECT}-meta"
BUILD=$(mktemp -d)
OUT="runs/versus-${TAG}"

cleanup() {
  echo "deleting ${VM}"
  gcloud compute instances delete "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "publishing the simulator for linux-x64"
dotnet publish csharp/Selatza.Sim -c Release -r linux-x64 --self-contained true \
  -o "${BUILD}/sim" -v q --nologo

echo "staging the build in ${BUCKET}"
gcloud storage rm -r "${BUCKET}/sim-${TAG}" >/dev/null 2>&1 || true
gcloud storage rm -r "${BUCKET}/versus-${TAG}" >/dev/null 2>&1 || true
gcloud storage cp -r "${BUILD}/sim" "${BUCKET}/sim-${TAG}/" >/dev/null
# A deck folder an arm names with dir:<folder> travels with the build and
# lands at the same relative path on the machine.
FOLDERS=""
for arm in "${ARMS[@]}"; do
  for f in $(echo "${arm}" | grep -o "dir:[^ ]*" | cut -c5-); do
    case " ${FOLDERS} " in *" ${f} "*) ;; *) FOLDERS="${FOLDERS} ${f}" ;; esac
  done
done
for f in ${FOLDERS}; do
  echo "staging ${f}"
  gcloud storage cp -r "${f}" "${BUCKET}/sim-${TAG}/decks/" >/dev/null
done

STARTUP="${BUILD}/startup.sh"
{
  echo '#!/bin/bash'
  echo 'set -u'
  echo 'cd /root'
  echo 'mkdir -p runs'
  echo "gcloud storage cp -r ${BUCKET}/sim-${TAG}/sim /root/ >/dev/null 2>&1"
  echo 'chmod +x /root/sim/Selatza.Sim'
  for f in ${FOLDERS}; do
    echo "mkdir -p /root/$(dirname "${f}")"
    echo "gcloud storage cp -r ${BUCKET}/sim-${TAG}/decks/$(basename "${f}") /root/$(dirname "${f}")/ >/dev/null 2>&1"
  done
  echo "THREADS=\$(( \$(nproc) / ${#ARMS[@]} ))"
  echo '[ "$THREADS" -lt 1 ] && THREADS=1'
  echo 'PIDS=""'
  n=0
  for arm in "${ARMS[@]}"; do
    n=$((n + 1))
    echo "echo \"arm ${n}: ${arm}\" > runs/arm-${n}.log"
    echo "./sim/Selatza.Sim versus --games ${GAMES} --threads \$THREADS ${arm} >> runs/arm-${n}.log 2>&1 & PIDS=\"\$PIDS \$!\""
  done
  echo 'wait $PIDS'
  echo "gcloud storage cp runs/arm-*.log ${BUCKET}/versus-${TAG}/ > runs/upload.log 2>&1"
  echo 'touch runs/ALL_DONE'
  echo "gcloud storage cp runs/ALL_DONE ${BUCKET}/versus-${TAG}/ALL_DONE >/dev/null 2>&1"
} > "${STARTUP}"

# A pre-empted spot machine is deleted by its own termination action, and a
# head-to-head is short enough to run again from the start, so a machine that
# goes missing before its logs come back is replaced, up to three machines in
# all, trying the machine and zone lists from the top each time.
MACHINES="${MACHINE}"
ZONES="${ZONE}"
DONE=""
for ATTEMPT in 1 2 3; do
# The third machine is not a spot one: two spot machines lost in a row means
# the zone is reclaiming them faster than a head-to-head runs.
if [ "${ATTEMPT}" -ge 3 ]; then MODEL="STANDARD"; else MODEL="SPOT"; fi
CREATED=""
for M in ${MACHINES//,/ }; do
  for Z in ${ZONES//,/ }; do
    echo "creating ${VM} (${M}, ${MODEL}, ${Z}), ${#ARMS[@]} arms of ${GAMES} games"
    if gcloud compute instances create "${VM}" --zone "${Z}" --machine-type "${M}" \
      --provisioning-model="${MODEL}" --instance-termination-action=DELETE \
      --max-run-duration=2h \
      --scopes=https://www.googleapis.com/auth/cloud-platform \
      --metadata-from-file=startup-script="${STARTUP}" \
      --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=50GB \
      --boot-disk-type=pd-balanced >/dev/null 2>"${BUILD}/create.err"; then
      CREATED="yes"; MACHINE="${M}"; ZONE="${Z}"; break 2
    fi
    (grep -m1 "code:" "${BUILD}/create.err" || grep -m1 ERROR "${BUILD}/create.err") | cut -c1-120 || true
  done
done
if [ -z "${CREATED}" ]; then echo "no capacity for any of ${MACHINES} in ${ZONES}"; exit 1; fi
echo "created ${VM} as ${MACHINE} in ${ZONE}; watching ${BUCKET}/versus-${TAG}/ every minute"

# A describe can fail for a moment, so a machine is only given up on when
# it has been missing or stopped three minutes in a row.
MISSING=0
while true; do
  sleep 60
  if gcloud storage ls "${BUCKET}/versus-${TAG}/ALL_DONE" >/dev/null 2>&1; then DONE="yes"; break; fi
  STATUS=$(gcloud compute instances describe "${VM}" --zone "${ZONE}" --format="value(status)" 2>/dev/null || echo "GONE")
  if [ "${STATUS}" = "RUNNING" ] || [ "${STATUS}" = "PROVISIONING" ] || [ "${STATUS}" = "STAGING" ] || [ -z "${STATUS}" ]; then
    MISSING=0
    continue
  fi
  MISSING=$((MISSING + 1))
  echo "${VM} reads ${STATUS} (${MISSING} of 3)"
  if [ "${MISSING}" -ge 3 ]; then
    echo "${VM} is ${STATUS} before the logs came back (machine ${ATTEMPT} of 3)"
    gcloud compute instances delete "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1 || true
    break
  fi
done
if [ -n "${DONE}" ]; then break; fi
done
if [ -z "${DONE}" ]; then echo "three machines lost before the logs came back; run again"; exit 1; fi

mkdir -p "${OUT}"
gcloud storage cp "${BUCKET}/versus-${TAG}/arm-*.log" "${OUT}/" >/dev/null
for f in "${OUT}"/arm-*.log; do
  echo "== $(basename "$f")"
  cat "$f"
done
