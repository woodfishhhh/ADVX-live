# CUT-004 Final External Evidence Matrix

## Scope

This matrix closes only the release-critical evidence required by `CUT-004`.
It does not expand the accepted Foundation, phase-gate, or hostile-test suites.
The current release scope remains Windows x64 only, and the Python backend
remains the parity oracle.

## Evidence Policy

| Concern | Current evidence |
| --- | --- |
| LLM Provider | Fresh credentialed StepFun request and cancellation plus focused current error-normalization tests |
| ASR Provider | Fresh credentialed StepFun microphone and system-audio calls over the product SSE adapter |
| Windows | Fresh installed Windows x64 end-to-end, restart, uninstall, and orphan audit |
| macOS | Authorized `PKG-011` Windows-only accepted limitation |
| Legacy data | Accepted `CUT-003` migration, online backup, restore, and Python restart rehearsal |
| Security | Fresh secret scan, Bun audit, exact license inventory, lifecycle-policy review, and CycloneDX SBOM |
| Product | Accepted `CUT-002` deterministic recorded scenario matrix |

Credentialed evidence records the UTC date, Provider destination and model
identity, current Git HEAD, and exact Provider source hashes. Credentials and
raw private content are never written. The live proof uses synthetic PCM and a
one-pixel PNG. A Provider source change invalidates the live receipt and
requires a fresh credentialed run rather than a documentation-only waiver.

## Execution Boundary

The focused checker requires `CUT004_LIVE_CONSENT=1` and a process-provided
`STEPFUN_API_KEY`. It runs only the current Provider proof, the focused Provider
error-normalization tests, the existing installed Windows checker, the existing
security checker, and validation of the accepted `CUT-002`, `CUT-003`, and
`PKG-011` artifacts.

It does not commit, push, publish, sign, deploy, enable updates, add a platform
claim, read user data, or remove the Python parity oracle.
