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

ENVIRONMENT="${1:?usage: deploy.sh <environment> <target> <image>}"
TARGET="${2:?usage: deploy.sh <environment> <target> <image>}"
IMAGE="${3:?usage: deploy.sh <environment> <target> <image>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"
VAR_FILE="envs/${TARGET}-${ENVIRONMENT}.tfvars"

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
terraform workspace select -or-create "${ENVIRONMENT}" >/dev/null 2>&1

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
    -var-file="${VAR_FILE}" -var="image=$1" >/dev/null
}

step "Applying infrastructure for ${ENVIRONMENT} (${TARGET})"
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
  port="$(awk '/^  port:/ {print $2}' "${REPO_ROOT}/apps/hello-world/service.yaml")"

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

if [[ "${TARGET}" == "local" ]]; then
  step "Registering targets (emulator does not do this itself)"
  sleep 2
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

smoke() {
  local body
  body="$(curl -fsS -m 10 "${SERVICE_URL%/}/api/greeting" 2>/dev/null)" || return 1
  grep -q '"message":"hello world"' <<<"${body}" || return 1
  if [[ -n "${EXPECT_COMMIT:-}" ]]; then
    grep -q "\"commit\":\"${EXPECT_COMMIT}\"" <<<"${body}" || {
      log "deployed commit does not match ${EXPECT_COMMIT}"
      return 1
    }
  fi
  printf '  %s\n' "${body}"
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
