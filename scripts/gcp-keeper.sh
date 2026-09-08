#!/usr/bin/env bash
# Keeps a meta check alive from outside any terminal or session. It attaches
# to the run's machine when one exists, starts it again when it has stopped
# (a pre-emption or the run cap), relaunches it elsewhere from the bucket
# checkpoint when its zone cannot start it or it is gone, and pulls the
# results when the done marker appears. One line per event, a heartbeat every
# thirty minutes, and it exits on its own at the hours cap.
#
# Usage:
#   scripts/gcp-keeper.sh <tag> [seeds] [rounds] [machines] [zones] [max run] [first seed] [hours cap]
# The first seven are the arguments of gcp-meta.sh; the cap defaults to 60
# hours. Launch it detached with scripts/gcp-keeper.cmd so it outlives the
# session that started it.
set -u
export PATH="$PATH:/c/Users/Krazv/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin"
cd "$(dirname "$0")/.." || exit 1

TAG=${1:?usage: gcp-keeper.sh <tag> [seeds] [rounds] [machines] [zones] [max run] [first seed] [hours cap]}
SEEDS=${2:-1}
ROUNDS=${3:-300}
MACHINES=${4:-c3-standard-176}
ZONES=${5:-us-central1-a}
MAX_RUN=${6:-14h}
SEED0=${7:-1}
CAP_H=${8:-60}
VM="meta-${TAG}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
BUCKET="gs://${PROJECT}-meta"
END=$(( $(date +%s) + CAP_H * 3600 ))

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
zone_of() { gcloud compute instances list --filter="name=${VM}" --format="value(zone.basename())" 2>/dev/null | head -n 1; }
progress() { gcloud storage cat "${BUCKET}/runs-${TAG}/progress.txt" 2>/dev/null | tr -d '\r' | cut -c1-100; }

pull() {
  say "done marker seen; pulling the results into runs/"
  mkdir -p runs
  gcloud storage cp -r "${BUCKET}/runs-${TAG}/${TAG}*" runs/ >/dev/null 2>&1
  ls -l runs/${TAG}*/games.db 2>/dev/null
  local z
  z=$(zone_of)
  [ -n "$z" ] && gcloud compute instances delete "${VM}" --zone "$z" --quiet >/dev/null 2>&1
  say "DONE: read runs/${TAG}${SEED0} with the meta-check skill"
}

say "keeper up for ${VM}: ${SEEDS} seed(s), ${ROUNDS} rounds, cap ${CAP_H}h"
FAILED=0
LAST_BEAT=0
while true; do
  if [ "$(date +%s)" -ge "$END" ]; then
    say "CAP: ${CAP_H} hours reached; the keeper exits and the machine is left as it is"
    exit 2
  fi
  if gcloud storage ls "${BUCKET}/runs-${TAG}/ALL_DONE" >/dev/null 2>&1; then
    pull
    exit 0
  fi
  ZONE=$(zone_of)
  if [ -z "${ZONE}" ]; then
    say "no machine ${VM}; relaunching from the bucket checkpoint"
    bash scripts/gcp-meta.sh "${TAG}" "${SEEDS}" "${ROUNDS}" "${MACHINES}" "${ZONES}" "${MAX_RUN}" "${SEED0}" 2>&1 \
      | grep --line-buffered -E "creating|created|no capacity|pre-empted|exhausted|pulling|done:|games.db" \
      | while read -r line; do say "meta: ${line}"; done
    CODE=${PIPESTATUS[0]}
    if [ "${CODE}" -eq 0 ]; then
      say "DONE: the relaunch finished and pulled runs/${TAG}${SEED0}; read it with the meta-check skill"
      exit 0
    fi
    say "relaunch ended with code ${CODE}; trying again in ten minutes"
    sleep 600
    continue
  fi
  STATUS=$(gcloud compute instances describe "${VM}" --zone "${ZONE}" --format="value(status)" 2>/dev/null || echo "GONE")
  case "${STATUS}" in
    RUNNING|PROVISIONING|STAGING|REPAIRING)
      FAILED=0
      NOW=$(date +%s)
      if [ $(( NOW - LAST_BEAT )) -ge 1800 ]; then
        say "alive: ${STATUS} in ${ZONE}; $(progress)"
        LAST_BEAT=${NOW}
      fi
      ;;
    TERMINATED|STOPPED|STOPPING|SUSPENDED)
      if gcloud compute instances start "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1; then
        say "machine was ${STATUS}; started it again in ${ZONE}, it resumes on boot"
        FAILED=0
      else
        FAILED=$(( FAILED + 1 ))
        say "machine is ${STATUS} and ${ZONE} cannot start it (${FAILED} of 3)"
        if [ "${FAILED}" -ge 3 ]; then
          say "zone exhausted; deleting ${VM} in ${ZONE} and relaunching elsewhere from the checkpoint"
          gcloud compute instances delete "${VM}" --zone "${ZONE}" --quiet >/dev/null 2>&1
          FAILED=0
          continue
        fi
      fi
      ;;
    *)
      say "machine status ${STATUS} in ${ZONE}"
      ;;
  esac
  sleep 300
done
