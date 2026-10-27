# Local diagnostics

**Settings → Background & updates → Keep local crash reports** is off by default. Reports stay on this computer; nothing is uploaded.

With the option on, the service records a bounded set of metadata for handled errors and process crashes. **Copy sanitized diagnostics** exports JSON containing the platform, architecture, timestamp, event category, a known error type and, where available, an allowlisted operating-system error code. Messages, stacks, filenames, credentials, prompts and source code are never recorded in this export. Up to 100 recent entries are retained; entries older than 30 days are pruned when recording. **Clear diagnostics** clears this metadata.

On the next desktop launch, Electron’s `crashReporter` starts with `uploadToServer: false`. Native dumps stay in Electron’s local crash-dump directory and are never included in copied diagnostics. Native dumps may contain process memory; they are separate from the sanitized metadata. Electron cannot stop its crash reporter after startup, so restart Ramu after enabling or disabling the option. Clearing the metadata does not delete native dump files.

Tests cover metadata redaction and bounds, and the desktop flow checks that opting in and restarting keeps Electron uploads disabled.
