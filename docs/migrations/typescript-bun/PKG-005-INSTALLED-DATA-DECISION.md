# PKG-005 Installed Data Paths Decision

## Decision

The packaged Electron application receives its user-data root from Electron's
`--user-data-dir` location. The Main process keeps the following runtime data
under that root:

| Data | Path | Owner |
| --- | --- | --- |
| Bun compiled backend database, WAL, and SHM | `backend/bun-compiled/` | Bun backend |
| Electron application log | `logs/advx.log` | `electron-log` |
| Local crash dumps | `crash-dumps/` | Electron crash reporter |
| Content-trace metadata and trace | `diagnostics/content-traces/` | Electron Main |
| Audience workspace and generated persona documents | root file and `audience-modes/` | Electron Main |

Application resources remain read-only under `resources/`. The backend receives
the explicit `userData/backend/bun-compiled` directory and never uses its
working directory or the installed resource tree for SQLite, logs, traces,
dumps, profiles, or configuration.

## Acceptance Boundary

The PKG-005 checker builds a real Windows x64 unpacked package, launches the
packaged executable with a clean user-data path containing spaces and non-ASCII
characters, starts the supervised Bun backend, and enables the bounded local
content trace. It verifies the database/WAL/SHM created during backend startup,
logs, crash-dump directory, diagnostics,
workspace persistence, and generated persona files in the declared locations;
it checks resource hashes before and after runtime; and it confirms that an
unpacked-root replacement (upgrade simulation) reloads the saved audience
workspace from the same user-data directory.

This is installed-path and upgrade-simulation evidence on Windows x64. It does
not claim NSIS installer/uninstaller retention, signing, macOS, Windows arm64,
or production update behavior; those remain later Phase 08 tasks.
