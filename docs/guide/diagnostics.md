# Diagnostics

**Settings → About → Keep local crash reports** is off by default (on the phone, under the host's **Background** settings). With it on, Ramu keeps a small amount of metadata about errors and crashes, plus Electron crash dumps, on this computer only. Nothing is uploaded. Restart Ramu after turning it on or off.

**Copy sanitized diagnostics** exports the metadata as JSON: platform, time, a category, an error type and a common error code. It never contains messages, file names, prompts, code or credentials. Crash dumps can hold process memory, so they are left out. **Clear diagnostics** removes the metadata.
