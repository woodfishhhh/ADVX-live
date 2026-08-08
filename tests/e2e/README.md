# End-to-end tests

Cross-process scenarios exercise the real Electron-supervised Bun backend,
authenticated control plane, realtime transport, recorded Provider fixtures,
overlay rendering, shutdown, port release, and orphan cleanup.

Run the supported Windows x64 recorded matrix from the repository root:

```powershell
bun run test:tst-008
```

Fixtures must be synthetic, privacy-safe, and deterministic. Credentialed live
Provider evidence is a separate explicit job and must never be represented as
recorded or fake evidence.
