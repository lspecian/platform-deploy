#!/usr/bin/env bash
#
# Roll back to the previously deployed image.
#
#   rollback.sh <environment> [target]
#
# Terraform state records what is deployed now; the artifact registry records
# what came before. This reads the previous image from the state's history and
# re-applies it, then verifies the service answers.
set -euo pipefail

ENVIRONMENT="${1:?usage: rollback.sh <environment> [target]}"
TARGET="${2:-local}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}/infra"

terraform init -input=false -no-color >/dev/null
terraform workspace select "${ENVIRONMENT}" >/dev/null 2>&1 || {
  echo "FAIL: ${ENVIRONMENT} has never been deployed" >&2
  exit 1
}

CURRENT="$(terraform output -json 2>/dev/null | jq -r '.image.value // empty')"
[[ -n "${CURRENT}" ]] || { echo "FAIL: nothing is deployed to ${ENVIRONMENT}" >&2; exit 1; }

# The previous image is whichever tagged build preceded the current one. Tags
# here are commit shas, so git ordering is deployment ordering.
CURRENT_TAG="${CURRENT##*:}"
PREVIOUS_TAG="$(git -C "${REPO_ROOT}" log --format=%h "${CURRENT_TAG}~1" -1 2>/dev/null || true)"

if [[ -z "${PREVIOUS_TAG}" ]]; then
  echo "FAIL: cannot determine the version before ${CURRENT_TAG}" >&2
  echo "  deploy a specific image instead: tarmac deploy with an explicit tag" >&2
  exit 1
fi

PREVIOUS="${CURRENT%:*}:${PREVIOUS_TAG}"
echo "Rolling ${ENVIRONMENT} back from ${CURRENT_TAG} to ${PREVIOUS_TAG}"

# Reuse the deploy path so a rollback is smoke-tested exactly like a deploy.
# A rollback that is not verified is just a second deploy that might also fail.
exec "${REPO_ROOT}/platform/scripts/deploy.sh" "${ENVIRONMENT}" "${TARGET}" "${PREVIOUS}"
