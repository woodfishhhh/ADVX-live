# Repository scripts

Current repository automation is TypeScript executed by Bun. Node is allowed
only for Electron/Playwright tooling. The supported release host is Windows
x64; scripts that intentionally support another host must still declare and
test that boundary rather than silently skipping work.

## sb6657 style corpus

Fetch the public read-only barrage corpus into ignored local data, then derive an aggregate-only profile:

```powershell
bun scripts/fetch-sb6657-corpus.ts --page-size 500 --delay 0.35
bun scripts/profile-sb6657-corpus.ts
```

The fetcher deliberately omits `dpahjdoiaw` and `siteToken`. Never commit `.advx-data/sb6657/corpus.jsonl`; only the reviewed aggregate profile belongs in source control.

## room-6657 generation skill

Compile the reviewed project Skill into the backend runtime artifact:

```powershell
bun scripts/sync-room-6657-skill.ts
bun scripts/sync-room-6657-skill.ts --check
```

Download the locked Microsoft SkillOpt checkout and run the isolated, review-gated optimization loop:

```powershell
bun scripts/run-room-6657-skillopt.ts bootstrap
bun scripts/run-room-6657-skillopt.ts dry-run --backend mock
bun scripts/run-room-6657-skillopt.ts run --backend codex
bun scripts/run-room-6657-skillopt.ts status
bun scripts/run-room-6657-skillopt.ts evaluate --backend codex --skill <candidate>
bun scripts/run-room-6657-skillopt.ts approve --staging <path> --reason <text>
bun scripts/run-room-6657-skillopt.ts adopt --staging <path>
```

Real model calls use a temporary minimal workspace, a sanitized environment,
and a temporary Codex home containing only copied authentication. Real runs
stage proposals only. Evaluation, approval, adoption, and rollback are bound to
the exact candidate and require an explicit staging directory.
Use `reject --staging <path> --reason <text>` when a scored candidate violates a
Persona or product contract; the project wrapper will then refuse to adopt it.
