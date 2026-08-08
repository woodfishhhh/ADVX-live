# ADR-MIG-003: Keep The Diagnostics Bundle As The Trace UI Boundary

> Status: Accepted by `obs-006-checker-root-20260806-038`
>
> Date: 2026-08-06
>
> Owner: Phase 06 observability and replay

## Context

`OBS-006` requires a time-boxed comparison of at most one local
Phoenix/OpenInference path, one TypeScript-first Langfuse-compatible path, or
no additional UI. ADVX already has an ADVX-owned redacted JSONL stream,
OpenTelemetry context/export primitives, authenticated debug snapshots, and
headless diagnostics artifacts. The migration target is a Python-free normal
development path with local data ownership; a trace UI must not create a
second unbounded persistence or privacy surface.

## Bounded Comparison

| Option | Local-only operation | Runtime/service burden | OTel/OpenInference fit | Display quality | Packaging and data boundary |
| --- | --- | --- | --- | --- | --- |
| Phoenix/OpenInference sidecar | Possible only as an explicitly external sidecar or collector | High: adds a collector/UI lifecycle and may reintroduce Python or a container to normal development | Strong semantic fit; current OTel context/export boundary is reusable, but no Phoenix runtime is present | Strong prompt/tool/model inspection after mapping | High install and packaging cost; every exported field needs the existing redaction/deletion policy applied again |
| TypeScript-first Langfuse-compatible UI | Possible with a local server, but not with the current packages alone | Medium/high: adds a server, storage schema, UI, and lifecycle supervision | Compatible through OTel/JSONL adapters, but requires a new ingestion and display mapping | Potentially strong, but quality depends on implementing the mapping and local storage | New dependency and storage surface; deletion/redaction must be duplicated or re-proven |
| No additional UI | Yes; the Bun process and local diagnostics bundle remain sufficient | None beyond existing JSONL, OTel, debug snapshot, and headless artifacts | Preserved at the telemetry boundary; UI adoption can be revisited without changing trace contracts | Existing JSONL viewer/debug snapshot is bounded and adequate for this migration milestone | Lowest burden; ADVX redaction, retention, hashing, and deletion rules remain authoritative in one place |

## Decision

Choose **no additional trace UI for normal ADVX development or packaging**.
The existing diagnostics bundle, redacted JSONL stream, authenticated debug
snapshot, and OTel correlation fields are the authoritative observability
surface. Phoenix/OpenInference and Langfuse-compatible consumers remain
optional external analysis tools that may read a sanitized exported bundle;
neither becomes a runtime dependency, a normal-development process, or a
second persistence authority.

This is a scope decision, not a rejection of either ecosystem's protocols.
The current OTel context and exporter boundary remains compatible with a later
sanitized adapter. Reopening this decision requires a focused task with a
measured user need, a local lifecycle proof, an installation/packaging plan,
and deletion/redaction evidence. It must not add remote telemetry or raw
prompt, response, media, credential, or private-frame persistence.

## Consequences

- No Phoenix, Langfuse, collector, database, or UI dependency is added.
- The Python-free normal path remains intact, and optional external analysis
  cannot block product startup or shutdown.
- Prompt/tool/model display remains bounded by the existing redaction and
  artifact contracts rather than a new viewer-specific storage model.
- A future UI can consume sanitized artifacts or an OTel adapter, but that is
  deliberately outside `OBS-006` and does not change the Python parity oracle.

## Rollback

Rollback is a documentation-only decision reversal. A future task may select
one local UI after satisfying the reopening conditions; it must keep the
diagnostics bundle authoritative and must not silently add a remote service.
