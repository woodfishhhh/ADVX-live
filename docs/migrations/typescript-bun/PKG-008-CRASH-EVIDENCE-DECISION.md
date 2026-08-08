# PKG-008 Local Crash Evidence Decision

## Boundary

Electron `crashReporter` is started before the first renderer is created and is
configured for local dump generation only. `uploadToServer` is `false` and the
submit URL is empty. No upload, telemetry, or consent prompt is added by this
task. Enabling remote submission requires a separate human decision.

The global annotations are intentionally limited to application/runtime
versions and a generated session ID: `app_version`, `electron_version`,
`chrome_version`, `node_version`, `bun_version`, and `session_id`. Provider
credentials, environment variables, prompts, messages, paths containing user
content, and other raw user data are not copied into crash annotations.

## Local Artifact And Manifest

Dumps are written below the Electron user-data `crash-dumps` directory. The
PKG-008 smoke deliberately crashes the control renderer and records a bounded
dump artifact. Its diagnostics manifest records only a relative path, byte
count, SHA-256, and `embedded: false`; the minidump bytes are not embedded in
the manifest or uploaded.

The smoke accepts a single-run dump of at most 64 MiB and a total crash-dump
directory of at most 64 MiB. This bound is evidence-run policy, not a promise
that every future Electron crash format has the same size.

## Retention And Deletion

Crash dumps are local diagnostic files and are retained only in the user's
Electron data directory. Normal application-data removal, uninstall cleanup,
or explicit support cleanup may delete the `crash-dumps` directory. The
PKG-008 evidence runner uses an isolated temporary user-data directory and
deletes it with the rest of its artifact workspace after evidence collection.
No automatic remote retention or server-side deletion exists because upload is
disabled.
