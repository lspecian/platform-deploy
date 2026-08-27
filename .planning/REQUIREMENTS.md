# Requirements: Tarmac

**Defined:** 2026-08-27
**Core Value:** A developer changes one file and ships safely without knowing how any of it works — and cannot ship something unsafe even if they try.

## v1 Requirements

### Application

- [x] **APP-01**: Developer runs the whole stack locally with one command and sees the greeting rendered in a browser
- [x] **APP-02**: API exposes `/healthz` and `/readyz`, and `/readyz` reflects real dependency state rather than returning a constant
- [x] **APP-03**: API emits structured JSON logs carrying a per-request correlation ID
- [x] **APP-04**: Unit and integration tests run identically on a laptop and in CI
- [x] **APP-05**: Container image runs as a non-root user with a read-only root filesystem from a digest-pinned base

### Contract

- [x] **CTR-01**: A service is fully described by one `service.yaml` validated against a published JSON Schema
- [x] **CTR-02**: Unknown or misspelled manifest fields are rejected, not silently ignored
- [x] **CTR-03**: The same validation code runs in the CLI, the pre-commit hook and CI, so local and CI cannot disagree
- [x] **CTR-04**: `service.yaml` drives Terraform inputs, so no application developer writes HCL

### Infrastructure

- [x] **INF-01**: One Terraform module set provisions the service against both the local emulator and real AWS, selected by a variable
- [x] **INF-02**: A deployed service is reachable through its load balancer on the local target
- [x] **INF-03**: dev, staging and prod are isolated by account and by separate Terraform state
- [x] **INF-04**: `make up` on a clean machine yields a reachable running service with no cloud account or API key
- [x] **INF-05**: GitHub OIDC supplies AWS credentials; no static cloud key exists anywhere in the repository
- [x] **INF-06**: `make destroy-aws` removes every AWS resource the road created

### Pipeline

- [x] **PIP-01**: Application repositories inherit one reusable workflow instead of copying pipeline YAML
- [x] **PIP-02**: A published matrix documents every gate as blocking or reporting, each with a written rationale
- [x] **PIP-03**: Blocking gates run on every pull request: lint, typecheck, unit tests with a coverage floor, secret scanning, dependency vulnerabilities, static analysis, image scan, container hardening policy, manifest schema validation, and Terraform validate/plan/policy
- [x] **PIP-04**: Reporting gates comment without blocking: cost delta, bundle size, coverage delta, SBOM diff
- [x] **PIP-05**: A vulnerability waiver requires an owner and an expiry date, and an expired waiver fails the build
- [x] **PIP-06**: Merge to main deploys to dev automatically; production requires explicit approval
- [x] **PIP-07**: A deploy promotes an image by digest and never rebuilds between environments
- [x] **PIP-08**: A failed post-deploy smoke test rolls the deployment back automatically

### Policy

- [x] **POL-01**: Rego policies evaluate the Terraform plan rather than source, so computed values and module internals are covered
- [x] **POL-02**: Policies enforce no public ingress except through the load balancer, no unencrypted storage, no plaintext secrets in task definitions, mandatory owner tags, and no wildcard IAM actions
- [x] **POL-03**: Every policy has `opa test` unit tests covering both an allow case and a deny case

### Guardrail Verification

- [x] **GAT-01**: A fixture containing a hardcoded credential is rejected by secret scanning
- [x] **GAT-02**: A fixture depending on a package with a known critical CVE is rejected by dependency scanning
- [x] **GAT-03**: A fixture whose container runs as root is rejected by container hardening policy
- [x] **GAT-04**: A fixture with a security group open to `0.0.0.0/0` is rejected by Terraform policy
- [x] **GAT-05**: A fixture whose manifest omits an owner is rejected by schema validation
- [x] **GAT-06**: A fixture declaring unencrypted storage is rejected by Terraform policy
- [x] **GAT-07**: A fixture carrying an expired vulnerability waiver is rejected by waiver policy
- [x] **GAT-08**: The entire fixture suite runs in CI on every change to the platform, and a guardrail that stops rejecting fails the build

### Developer Surfaces

- [x] **CLI-01**: `tarmac new` scaffolds a repository already wired to the road
- [x] **CLI-02**: `tarmac validate` runs exactly the checks CI runs
- [x] **CLI-03**: `tarmac dev` brings the whole stack up locally
- [x] **CLI-04**: `tarmac deploy`, `status` and `rollback` drive and inspect a deployment
- [x] **CLI-05**: `tarmac doctor` diagnoses a broken local setup and prints the fix rather than a stack trace
- [x] **BOT-01**: One pull request comment, updated in place rather than appended, shows every gate result
- [x] **BOT-02**: That comment explains the infrastructure diff in plain English and shows a cost delta

### Documentation

- [x] **DOC-01**: README explains the road, the gates and the omissions in fifteen minutes
- [x] **DOC-02**: ADRs record every significant decision, including the emulator spike findings
- [x] **DOC-03**: A "what we left out and why" section lists every omission with its reason

## v2 Requirements

None. Anything not in v1 is out of scope with a stated reason.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Canary / weighted traffic shifting | Not requested; works on only one of the two targets. Deploy → smoke → rollback is a complete deployment story |
| Database and migrations | A real database plus migration tooling plus a destructive-migration policy does not fit a one-day budget |
| Kubernetes | The emulator supports it, but a container service shows the same platform concerns with far less surface |
| Multi-region and disaster recovery | Exercises cloud topology rather than the road |
| Service mesh, tracing backend, log aggregation UI | The app emits correct telemetry; running the receiving infrastructure is a separate project |
| Service catalogue / web portal | The CLI and the pull request are the surfaces; a portal is right at fifty services, not one |
| Autoscaling | Configurable but not load-tested; claiming tested autoscaling without a load test would be dishonest |
| Image signing and provenance attestation | An SBOM is produced; signing against an emulated registry proves nothing about a real supply chain |
| A second sample service | Reusability is better shown by the scaffolding template generating one on demand |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| APP-01 | Phase 1 | Complete |
| APP-02 | Phase 1 | Complete |
| APP-03 | Phase 1 | Complete |
| APP-04 | Phase 1 | Complete |
| APP-05 | Phase 1 | Complete |
| CTR-01 | Phase 1 | Complete |
| CTR-02 | Phase 1 | Complete |
| CTR-03 | Phase 1 | Complete |
| CTR-04 | Phase 1 | Complete |
| INF-01 | Phase 1 | Complete |
| INF-02 | Phase 1 | Complete |
| INF-03 | Phase 1 | Complete |
| INF-04 | Phase 1 | Complete |
| INF-05 | Phase 3 | Complete |
| INF-06 | Phase 3 | Complete |
| PIP-01 | Phase 2 | Complete |
| PIP-02 | Phase 2 | Complete |
| PIP-03 | Phase 2 | Complete |
| PIP-04 | Phase 2 | Complete |
| PIP-05 | Phase 2 | Complete |
| PIP-06 | Phase 2 | Complete |
| PIP-07 | Phase 2 | Complete |
| PIP-08 | Phase 2 | Complete |
| POL-01 | Phase 2 | Complete |
| POL-02 | Phase 2 | Complete |
| POL-03 | Phase 2 | Complete |
| GAT-01 | Phase 3 | Complete |
| GAT-02 | Phase 3 | Complete |
| GAT-03 | Phase 3 | Complete |
| GAT-04 | Phase 3 | Complete |
| GAT-05 | Phase 3 | Complete |
| GAT-06 | Phase 3 | Complete |
| GAT-07 | Phase 3 | Complete |
| GAT-08 | Phase 3 | Complete |
| CLI-01 | Phase 3 | Complete |
| CLI-02 | Phase 3 | Complete |
| CLI-03 | Phase 3 | Complete |
| CLI-04 | Phase 3 | Complete |
| CLI-05 | Phase 3 | Complete |
| BOT-01 | Phase 3 | Complete |
| BOT-02 | Phase 3 | Complete |
| DOC-01 | Phase 3 | Complete |
| DOC-02 | Phase 3 | Complete |
| DOC-03 | Phase 3 | Complete |

**Status:** all 44 v1 requirements delivered.

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-27*
*Last updated: 2026-08-27 after initial definition*
