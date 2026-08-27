#!/usr/bin/env bash
#
# Evaluate the Terraform plan against the platform's policies.
#
#   policy-check.sh <environment> [target]
#
# Runs against the *plan*, not the source. A rule that reads .tf files cannot
# see values that come from variables, locals, data sources or modules, so it
# can pass while the resource actually being created violates it.
set -euo pipefail

ENVIRONMENT="${1:?usage: policy-check.sh <environment> [target]}"
TARGET="${2:-local}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPA="${OPA:-${REPO_ROOT}/.tools/opa}"
command -v "${OPA}" >/dev/null 2>&1 || OPA="opa"

# GNU mktemp requires the XXXXXX placeholder; BSD mktemp does not. Omitting it
# works on macOS and fails on a Linux CI runner, which is a fun way to lose
# twenty minutes.
PLAN_BIN="$(mktemp -t tarmac-plan.XXXXXX)"
PLAN_JSON="$(mktemp -t tarmac-plan-json.XXXXXX)"
trap 'rm -f "${PLAN_BIN}" "${PLAN_JSON}"' EXIT

cd "${REPO_ROOT}/infra"

echo "==> Planning ${ENVIRONMENT} (${TARGET})"
terraform init -input=false -no-color >/dev/null
terraform workspace select -or-create "${ENVIRONMENT}" >/dev/null 2>&1
terraform plan -input=false -no-color -lock=false \
  -out="${PLAN_BIN}" \
  -var-file="envs/${TARGET}-${ENVIRONMENT}.tfvars" \
  -var="image=${IMAGE:-registry/hello-world@sha256:0000000000000000000000000000000000000000000000000000000000000000}" \
  >/dev/null
terraform show -json "${PLAN_BIN}" >"${PLAN_JSON}"

echo "==> Evaluating policy"
FINDINGS="$("${OPA}" eval --format raw --data "${REPO_ROOT}/platform/policy" \
  --input "${PLAN_JSON}" 'data.tarmac.policy.deny')"

COUNT="$(jq 'length' <<<"${FINDINGS}")"

if [[ "${COUNT}" -eq 0 ]]; then
  echo "PASS: no policy violations"
  exit 0
fi

echo
echo "FAIL: ${COUNT} policy violation(s)"
echo
jq -r '.[] | "  [\(.rule)] \(.resource)\n    \(.msg)\n"' <<<"${FINDINGS}"

# Machine-readable output for the pull request comment.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "findings<<EOF"
    echo "${FINDINGS}"
    echo "EOF"
  } >>"${GITHUB_OUTPUT}"
fi

exit 1
