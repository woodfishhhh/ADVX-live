# PKG-007 Electron Fuse And ASAR Integrity Decision

## Configuration

Electron-builder now flips the supported Electron V1 fuses during packaging:

- `runAsNode=false`;
- `enableCookieEncryption=true`;
- `enableNodeOptionsEnvironmentVariable=false`;
- `enableNodeCliInspectArguments=false`;
- `enableEmbeddedAsarIntegrityValidation=true`;
- `onlyLoadAppFromAsar=true`;
- `loadBrowserProcessSpecificV8Snapshot=false`;
- `grantFileProtocolExtraPrivileges=true` to preserve the existing `file://`
  renderer resource contract.

Electron `43.2.0` is above the Windows ASAR-integrity support floor. The
compiled Bun backend remains an `extraResources` executable outside `app.asar`
and is checked separately by the packaged startup probe.

## Verification Boundary

The focused checker builds the real Windows x64 package, reads the fuse wire,
launches the hardened package, verifies the preload/IPC and backend resource
paths, confirms renderer source isolation (`sandbox`, `contextIsolation`, and
`nodeIntegration=false`), and runs bounded tamper probes against a copied
`app.asar` and copied backend executable. Tampered copies must fail before a
healthy backend is reported; the original package is never modified.

The Python parity oracle and all unrelated migration tasks remain untouched.
