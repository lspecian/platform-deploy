# Requirements: Tarmac

**Defined:** 2026-08-27
**Core Value:** A developer changes one file and ships safely without knowing how any of it works — and cannot ship something unsafe even if they try.

## v1 Requirements

### Application

- [ ] **APP-01**: Developer runs the whole stack locally with one command and sees the greeting rendered in a browser
- [ ] **APP-02**: API exposes `/healthz` and `/readyz`, and `/readyz` reflects real dependency state rather than returning a constant
- [ ] **APP-03**: API emits structured JSON logs carrying a per-request correlation ID
- [ ] **APP-04**: Unit and integration tests run identically on a laptop and in CI
- [ ] **APP-05**: Container image runs as a non-root user with a read-only root filesystem from a digest-pinned base

### Contract

- [ ] **CTR-01**: A service is fully described by one `service.yaml` validated against a published JSON Schema
- [ ] **CTR-02**: Unknown or misspelled manifest fields are rejected, not silently ignored
- [ ] **CTR-03**: The same validation code runs in the CLI, the pre-commit hook and CI, so local and CI cannot disagree
- [ ] **CTR-04**: `service.yaml` drives Terraform inputs, so no application developer writes HCL

### Infrastructure

- [ ] **INF-01**: One Terraform module set provisions the service against both the local emulator and real AWS, selected by a variable
- [ ] **INF-02**: A deployed service is reachable through its load balancer on the local target
- [ ] **INF-03**: dev, staging and prod are isolated by account and by separate Terraform state
- [ ] **INF-04**: `make up` on a clean machine yields a reachable running service with no cloud account or API key
- [ ] **INF-05**: GitHub OIDC supplies AWS credentials; no static cloud key exists anywhere in the repository
- [ ] **INF-06**: `make destroy-aws` removes every AWS resource the road created

### Pipeline

- [ ] **PIP-01**: Application repositories inherit one reusable workflow instead of copying pipeline YAML
- [ ] **PIP-02**: A published matrix documents every gate as blocking or reporting, each with a written rationale
- [ ] **PIP-03**: Blocking gates run on every pull request: lint, typecheck, unit tests with a coverage floor, secret scanning, dependency vulnerabilities, static analysis, image scan, container hardening policy, manifest schema validation, and Terraform validate/plan/policy
- [ ] **PIP-04**: Reporting gates comment without blocking: cost delta, bundle size, coverage delta, SBOM diff
- [ ] **PIP-05**: A vulnerability waiver requires an owner and an expiry date, and an expired waiver fails the build
- [ ] **PIP-06**: Merge to main deploys to dev automatically; production requires explicit approval
- [ ] **PIP-07**: A deploy promotes an image by digest and never rebuilds between environments
- [ ] **PIP-08**: A failed post-deploy smoke test rolls the deployment back automatically

### Policy

- [ ] **POL-01**: Rego policies evaluate the Terraform plan rather than source, so computed values and module internals are covered
- [ ] **POL-02**: Policies enforce no public ingress except through the load balancer, no unencrypted storage, no plaintext secrets in task definitions, mandatory owner tags, and no wildcard IAM actions
- [ ] **POL-03**: Every policy has `opa test` unit tests covering both an allow case and a deny case

### Guardrail Verification

- [ ] **GAT-01**: A fixture containing a hardcoded credential is rejected by secret scanning
- [ ] **GAT-02**: A fixture depending on a package with a known critical CVE is rejected by dependency scanning
- [ ] **GAT-03**: A fixture whose container runs as root is rejected by container hardening policy
- [ ] **GAT-04**: A fixture with a security group open to `0.0.0.0/0` is rejected by Terraform policy
- [ ] **GAT-05**: A fixture whose manifest omits an owner is rejected by schema validation
- [ ] **GAT-06**: A fixture declaring unencrypted storage is rejected by Terraform policy
- [ ] **GAT-07**: A fixture carrying an expired vulnerability waiver is rejected by waiver policy
- [ ] **GAT-08**: The entire fixture suite runs in CI on every change to the platform, and a guardrail that stops rejecting fails the build

### Developer Surfaces

- [ ] **CLI-01**: `tarmac new` scaffolds a repository already wired to the road
- [ ] **CLI-02**: `tarmac validate` runs exactly the checks CI runs
- [ ] **CLI-03**: `tarmac dev` brings the whole stack up locally
- [ ] **CLI-04**: `tarmac deploy`, `status` and `rollback` drive and inspect a deployment
- [ ] **CLI-05**: `tarmac doctor` diagnoses a broken local setup and prints the fix rather than a stack trace
- [ ] **BOT-01**: One pull request comment, updated in place rather than appended, shows every gate result
- [ ] **BOT-02**: That comment explains the infrastructure diff in plain English and shows a cost delta

### Documentation

- [ ] **DOC-01**: README explains the road, the gates and the omissions in fifteen minutes
- [ ] **DOC-02**: ADRs record every significant decision, including the emulator spike findings
- [ ] **DOC-03**: A "what we left out and why" section lists every omission with its reason

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
| APP-01 | Phase 1 | Pending |
| APP-02 | Phase 1 | Pending |
| APP-03 | Phase 1 | Pending |
| APP-04 | Phase 1 | Pending |
| APP-05 | Phase 1 | Pending |
| CTR-01 | Phase 1 | Pending |
| CTR-02 | Phase 1 | Pending |
| CTR-03 | Phase 1 | Pending |
| CTR-04 | Phase 1 | Pending |
| INF-01 | Phase 1 | Pending |
| INF-02 | Phase 1 | Pending |
| INF-03 | Phase 1 | Pending |
| INF-04 | Phase 1 | Pending |
| INF-05 | Phase 3 | Pending |
| INF-06 | Phase 3 | Pending |
| PIP-01 | Phase 2 | Pending |
| PIP-02 | Phase 2 | Pending |
| PIP-03 | Phase 2 | Pending |
| PIP-04 | Phase 2 | Pending |
| PIP-05 | Phase 2 | Pending |
| PIP-06 | Phase 2 | Pending |
| PIP-07 | Phase 2 | Pending |
| PIP-08 | Phase 2 | Pending |
| POL-01 | Phase 2 | Pending |
| POL-02 | Phase 2 | Pending |
| POL-03 | Phase 2 | Pending |
| GAT-01 | Phase 3 | Pending |
| GAT-02 | Phase 3 | Pending |
| GAT-03 | Phase 3 | Pending |
| GAT-04 | Phase 3 | Pending |
| GAT-05 | Phase 3 | Pending |
| GAT-06 | Phase 3 | Pending |
| GAT-07 | Phase 3 | Pending |
| GAT-08 | Phase 3 | Pending |
| CLI-01 | Phase 3 | Pending |
| CLI-02 | Phase 3 | Pending |
| CLI-03 | Phase 3 | Pending |
| CLI-04 | Phase 3 | Pending |
| CLI-05 | Phase 3 | Pending |
| BOT-01 | Phase 3 | Pending |
| BOT-02 | Phase 3 | Pending |
| DOC-01 | Phase 3 | Pending |
| DOC-02 | Phase 3 | Pending |
| DOC-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-27*
*Last updated: 2026-08-27 after initial definition*
