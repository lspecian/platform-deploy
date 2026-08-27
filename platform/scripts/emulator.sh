#!/usr/bin/env bash
#
# Start or stop the local cloud emulators.
#
# One instance per environment, on its own port, with its own account ID.
#
# A single instance with three accounts would be tidier, but the emulator's
# load balancer data plane resolves an unauthenticated HTTP request to its
# *default* account and region — so a load balancer created under any other
# account exists, reports healthy, and is unroutable. Separate instances keep
# environments genuinely isolated and ingress working.
# See docs/adr/0002-emulator-constraints.md.
set -euo pipefail

REGION="eu-central-1"

# environment:port:account
ENVIRONMENTS=(
  "dev:4566:000000000001"
  "staging:4567:000000000002"
  "prod:4568:000000000003"
)

log() { printf '  %s\n' "$*"; }

start() {
  for spec in "${ENVIRONMENTS[@]}"; do
    IFS=: read -r env port account <<<"${spec}"
    local name="tarmac-${env}"

    if [[ -n "$(docker ps -q --filter "name=^${name}$" 2>/dev/null)" ]]; then
      log "${env} already running on :${port}"
      continue
    fi

    docker rm -f "${name}" >/dev/null 2>&1 || true
    docker run -d --name "${name}" \
      -p "${port}:4566" \
      -e "MINISTACK_ACCOUNT_ID=${account}" \
      -e "MINISTACK_REGION=${REGION}" \
      -v /var/run/docker.sock:/var/run/docker.sock \
      ministackorg/ministack >/dev/null

    log "${env} starting on :${port} (account ${account})"
  done

  for spec in "${ENVIRONMENTS[@]}"; do
    IFS=: read -r env port _ <<<"${spec}"
    for _ in $(seq 1 60); do
      if curl -fsS -m 2 "http://localhost:${port}/_ministack/health" >/dev/null 2>&1; then
        log "${env} ready"
        break
      fi
      sleep 0.5
    done
  done
}

stop() {
  for spec in "${ENVIRONMENTS[@]}"; do
    IFS=: read -r env _ _ <<<"${spec}"
    docker rm -f "tarmac-${env}" >/dev/null 2>&1 && log "${env} stopped" || true
  done
  # Tasks the emulator started outlive it; without this they linger holding ports.
  local orphans
  orphans="$(docker ps -aq --filter 'name=ministack-ecs' 2>/dev/null || true)"
  [[ -n "${orphans}" ]] && docker rm -f ${orphans} >/dev/null 2>&1 && log "removed orphaned task containers"
  return 0
}

status() {
  printf '%-10s %-8s %-14s %s\n' ENVIRONMENT PORT ACCOUNT STATUS
  for spec in "${ENVIRONMENTS[@]}"; do
    IFS=: read -r env port account <<<"${spec}"
    local state="stopped"
    curl -fsS -m 2 "http://localhost:${port}/_ministack/health" >/dev/null 2>&1 && state="ready"
    printf '%-10s %-8s %-14s %s\n' "${env}" "${port}" "${account}" "${state}"
  done
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "usage: emulator.sh [start|stop|status]" >&2
    exit 1
    ;;
esac
