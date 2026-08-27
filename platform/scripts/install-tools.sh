#!/usr/bin/env bash
#
# Downloads the policy and scanning tools into .tools/ (gitignored).
#
# Into the repository rather than onto the system on purpose: a developer
# cloning this should not have to install five things globally, and pinning them
# here means everyone runs the same versions CI does. `tarmac doctor` points at
# this script when a tool is missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="${REPO_ROOT}/.tools"
mkdir -p "${TOOLS}"

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) echo "unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64) ARCH=amd64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

install_opa() {
  [[ -x "${TOOLS}/opa" ]] && { echo "  opa already present"; return; }
  local version
  version="$(curl -fsSL https://api.github.com/repos/open-policy-agent/opa/releases/latest | jq -r .tag_name)"
  curl -fsSL -o "${TOOLS}/opa" \
    "https://github.com/open-policy-agent/opa/releases/download/${version}/opa_${OS}_${ARCH}_static"
  chmod +x "${TOOLS}/opa"
  echo "  opa ${version}"
}

install_gitleaks() {
  [[ -x "${TOOLS}/gitleaks" ]] && { echo "  gitleaks already present"; return; }
  local version tarball_arch
  version="$(curl -fsSL https://api.github.com/repos/gitleaks/gitleaks/releases/latest | jq -r .tag_name)"
  # gitleaks names amd64 builds "x64" in its release assets.
  tarball_arch="${ARCH/amd64/x64}"
  curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/${version}/gitleaks_${version#v}_${OS}_${tarball_arch}.tar.gz" \
    | tar -xz -C "${TOOLS}" gitleaks
  chmod +x "${TOOLS}/gitleaks"
  echo "  gitleaks ${version}"
}

echo "Installing tools into .tools/"
install_opa
install_gitleaks
echo
echo "Add them to your PATH for this shell:"
echo "  export PATH=\"${TOOLS}:\$PATH\""
