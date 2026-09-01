#!/usr/bin/env bash
#
# Deploy a service through the paved road.
#
#   deploy.sh <environment> <target> <image>
#
# Applies infrastructure, makes the new tasks reachable, smoke-tests the result,
# and rolls back automatically if the smoke test fails. A deploy that cannot
# prove it worked is a deploy that has to be rolled back.
set -euo pipefail

USAGE="usage: deploy.sh <environment> <target> <image> [manifest-path]"
ENVIRONMENT="${1:?${USAGE}}"
TARGET="${2:?${USAGE}}"
IMAGE="${3:?${USAGE}}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"
VAR_FILE="envs/${TARGET}-${ENVIRONMENT}.tfvars"

MANIFEST="${4:-${REPO_ROOT}/apps/hello-world/service.yaml}"
[[ -f "${MANIFEST}" ]] || { printf "\nFAIL: no manifest at %s\n" "${MANIFEST}" >&2; exit 1; }
MANIFEST="$(cd "$(dirname "${MANIFEST}")" && pwd)/$(basename "${MANIFEST}")"

# The service name comes from the manifest, never from a flag. The manifest is
# the contract; a name passed separately is a second source of truth that will
# eventually disagree with it.
SERVICE="$(awk '/^name:/ {print $2; exit}' "${MANIFEST}")"
[[ -n "${SERVICE}" ]] || { printf "\nFAIL: %s has no top-level name\n" "${MANIFEST}" >&2; exit 1; }

# State is keyed on service *and* environment.
#
# Keyed on environment alone, a second service deploying to dev would land in
# the first one's state and take over its resources. That is the difference
# between a platform and a demo of one: the failure does not appear until the
# second team arrives, and by then it destroys something.
WORKSPACE="${SERVICE}-${ENVIRONMENT}"

SMOKE_RETRIES="${SMOKE_RETRIES:-20}"
SMOKE_INTERVAL="${SMOKE_INTERVAL:-2}"

log()  { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFAIL: %s\n' "$*" >&2; exit 1; }

cd "${INFRA_DIR}"
[[ -f "${VAR_FILE}" ]] || fail "no such environment: ${VAR_FILE}"

# ---------------------------------------------------------------------------
# Record what is currently deployed, so a failed smoke test has something to
# roll back to. On a first deploy there is no previous image and rollback is
# not possible — the script says so rather than pretending otherwise.
# ---------------------------------------------------------------------------
terraform init -input=false -no-color >/dev/null
terraform workspace select -or-create "${WORKSPACE}" >/dev/null 2>&1

# -json rather than -raw: on a fresh workspace `terraform output -raw` prints a
# "no outputs found" warning to stdout, which would otherwise be mistaken for an
# image reference and then "rolled back" to.
PREVIOUS_IMAGE="$(terraform output -json 2>/dev/null | jq -r '.image.value // empty' 2>/dev/null || true)"
if [[ -n "${PREVIOUS_IMAGE}" ]]; then
  log "currently deployed: ${PREVIOUS_IMAGE}"
else
  log "no previous deployment (rollback will not be available)"
fi

apply() {
  terraform apply -input=false -auto-approve -no-color \
    -var-file="${VAR_FILE}" \
    -var="image=$1" \
    -var="manifest_path=${MANIFEST}" >/dev/null
}

# ---------------------------------------------------------------------------
# Check the image exists before doing anything else.
#
# Without this the deploy proceeds, the emulator fails to pull, and the script
# reports "no running tasks found to register" — which describes a symptom four
# steps removed from the cause. The real reason sits in the emulator's own log,
# where nobody thinks to look. Failing here costs one docker call and turns a
# confusing dead end into one line naming the missing image.
# ---------------------------------------------------------------------------
if [[ "${TARGET}" == "local" ]] && ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  fail "image ${IMAGE} does not exist locally.

  The emulator pulls from the host Docker daemon, so the image has to be built
  first:

    make build

  If you meant to deploy a different version, pass it explicitly:

    platform/scripts/deploy.sh ${ENVIRONMENT} ${TARGET} <image>"
fi

step "Deploying ${SERVICE} to ${ENVIRONMENT} (${TARGET})"
log "image: ${IMAGE}"
apply "${IMAGE}"

SERVICE_URL="$(terraform output -raw service_url)"
TARGET_GROUP="$(terraform output -raw target_group_arn)"
CLUSTER="$(terraform output -raw cluster_name)"

# ---------------------------------------------------------------------------
# Make the new tasks reachable.
#
# On real AWS, ECS registers task addresses into the target group by itself.
# The emulator does not model awsvpc networking, so tasks report no network
# interface and nothing ever registers. The road hides that difference here
# rather than making every service deal with it.
# See docs/adr/0002-emulator-constraints.md.
# ---------------------------------------------------------------------------
register_targets_locally() {
  local endpoint port ip registered=0
  endpoint="$(grep -oE 'https?://[^"]+' "${VAR_FILE}" | head -1)"
  port="$(awk '/^  port:/ {print $2; exit}' "${MANIFEST}")"

  export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
  export AWS_DEFAULT_REGION="$(awk -F'"' '/^region/ {print $2}' "${VAR_FILE}")"
  export AWS_ENDPOINT_URL="${endpoint}"

  # Deregister whatever is currently in the group first.
  #
  # register-targets is additive, so without this the group accumulates the IPs
  # of every task that has ever been deployed — including stopped ones and, if
  # anything ever registers across environments, another environment's tasks.
  # The load balancer would then round-robin between the new version and
  # whatever ghosts remain, which looks exactly like a flaky deploy.
  #
  # Real ECS deregisters as tasks stop. The emulator does not, so the road does.
  local existing
  existing="$(aws elbv2 describe-target-health --target-group-arn "${TARGET_GROUP}" \
    --query 'TargetHealthDescriptions[].Target.Id' --output text 2>/dev/null || true)"
  for old_target in ${existing}; do
    [[ -n "${old_target}" && "${old_target}" != "None" ]] || continue
    aws elbv2 deregister-targets --target-group-arn "${TARGET_GROUP}" \
      --targets "Id=${old_target},Port=${port}" >/dev/null 2>&1 || true
  done

  # Ask *this* environment's emulator which tasks it is running, and map each
  # to its container through the runtime id. Matching on container name alone
  # would sweep up every other environment's tasks — they all share the host's
  # Docker daemon and the same name prefix.
  local task_arns runtime_ids
  task_arns="$(aws ecs list-tasks --cluster "${CLUSTER}" --query 'taskArns' --output text 2>/dev/null || true)"
  [[ -n "${task_arns}" && "${task_arns}" != "None" ]] || fail "no running tasks in ${CLUSTER}"

  runtime_ids="$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks ${task_arns} \
    --query 'tasks[].containers[].runtimeId' --output text 2>/dev/null || true)"

  for runtime_id in ${runtime_ids}; do
    [[ -n "${runtime_id}" && "${runtime_id}" != "None" ]] || continue
    ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${runtime_id}" 2>/dev/null || true)"
    [[ -n "${ip}" ]] || continue
    aws elbv2 register-targets \
      --target-group-arn "${TARGET_GROUP}" \
      --targets "Id=${ip},Port=${port}" >/dev/null 2>&1 && registered=$((registered + 1))
  done

  log "registered ${registered} target(s) in ${CLUSTER}"
  [[ "${registered}" -gt 0 ]] || fail "no running tasks found to register"
}

# ---------------------------------------------------------------------------
# Clear phantom tasks.
#
# When a container fails to start, the emulator still records the task as
# RUNNING with a runtime id that matches no container. That phantom satisfies
# the service's desired count, so no replacement is ever started and every
# subsequent deploy silently does nothing — the service looks healthy and is
# serving the previous version, or nothing at all.
#
# Real ECS reconciles this: a task whose container died is STOPPED, and the
# service starts a replacement. The emulator does not, so the road does.
# ---------------------------------------------------------------------------
stop_phantom_tasks() {
  local stopped=0 task runtime_id
  for task in $(aws ecs list-tasks --cluster "${CLUSTER}" --query 'taskArns[]' --output text 2>/dev/null); do
    [[ -n "${task}" && "${task}" != "None" ]] || continue
    runtime_id="$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${task}" \
      --query 'tasks[0].containers[0].runtimeId' --output text 2>/dev/null || true)"
    if [[ -z "${runtime_id}" ]] || [[ "${runtime_id}" == "None" ]] \
       || ! docker inspect "${runtime_id}" >/dev/null 2>&1; then
      aws ecs stop-task --cluster "${CLUSTER}" --task "${task}" \
        --reason "no container behind this task" >/dev/null 2>&1 && stopped=$((stopped + 1))
    fi
  done
  [[ "${stopped}" -gt 0 ]] && log "cleared ${stopped} phantom task(s)"
  return 0
}

if [[ "${TARGET}" == "local" ]]; then
  step "Registering targets (emulator does not do this itself)"
  export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
  export AWS_DEFAULT_REGION="$(awk -F'"' '/^region/ {print $2}' "${VAR_FILE}")"
  export AWS_ENDPOINT_URL="$(grep -oE 'https?://[^"]+' "${VAR_FILE}" | head -1)"
  stop_phantom_tasks
  # Re-apply so the service notices it is short a task and starts a real one.
  apply "${IMAGE}"
  sleep 3
  register_targets_locally
fi

# ---------------------------------------------------------------------------
# Smoke test.
#
# Asserts the deployed artifact is the one we just shipped, not merely that
# *something* answers. A health check that passes against the previous version
# would make a failed deploy look successful.
# ---------------------------------------------------------------------------
step "Smoke testing ${SERVICE_URL}"

# The readiness path comes from the manifest, because it is the service's to
# choose. The platform asserts two things only: the service reports itself
# ready, and the build answering is the build we just deployed.
READINESS_PATH="$(awk '/^    readiness:/ {print $2; exit}' "${MANIFEST}")"
READINESS_PATH="${READINESS_PATH:-/readyz}"

smoke() {
  local body

  # Readiness, not a greeting. An earlier version asserted the reference
  # service's exact response body, which meant every other service failed its
  # own smoke test — the platform had baked in one service's payload.
  curl -fsS -m 10 -o /dev/null "${SERVICE_URL%/}${READINESS_PATH}" 2>/dev/null || return 1

  if [[ -n "${EXPECT_COMMIT:-}" ]]; then
    # The assertion that makes this a real check. Without it a smoke test passes
    # against the *previous* version when the new one never starts, turning a
    # failed deploy into a green one.
    body="$(curl -fsS -m 10 "${SERVICE_URL%/}/api/greeting" 2>/dev/null)" || return 1
    grep -q "\"commit\":\"${EXPECT_COMMIT}\"" <<<"${body}" || {
      log "deployed commit does not match ${EXPECT_COMMIT}"
      return 1
    }
    printf '  %s\n' "${body}"
  fi
  return 0
}

for attempt in $(seq 1 "${SMOKE_RETRIES}"); do
  if smoke; then
    step "Deploy succeeded"
    log "url: ${SERVICE_URL}"
    exit 0
  fi
  log "attempt ${attempt}/${SMOKE_RETRIES} not ready yet"
  sleep "${SMOKE_INTERVAL}"
done

# ---------------------------------------------------------------------------
# Rollback.
# ---------------------------------------------------------------------------
step "Smoke test failed after ${SMOKE_RETRIES} attempts"

if [[ -z "${PREVIOUS_IMAGE}" || "${PREVIOUS_IMAGE}" == "${IMAGE}" ]]; then
  fail "no previous image to roll back to — environment is left as-is for inspection"
fi

log "rolling back to ${PREVIOUS_IMAGE}"
apply "${PREVIOUS_IMAGE}"
[[ "${TARGET}" == "local" ]] && register_targets_locally

if EXPECT_COMMIT="" smoke >/dev/null 2>&1; then
  fail "rolled back to ${PREVIOUS_IMAGE} — previous version is serving again"
fi
fail "rollback to ${PREVIOUS_IMAGE} did not restore service — needs a human"
