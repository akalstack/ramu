# Diagnostics

**Settings → About → Keep local crash reports** is off by default (on the phone, under the host's **Background** settings). With it on, Ramu keeps a small amount of metadata about errors and crashes, plus Electron crash dumps, on this computer only. Nothing is uploaded. Restart Ramu after turning it on or off.

**Copy sanitized diagnostics** exports the metadata as JSON: platform, time, a category, an error type and a common error code. It never contains messages, file names, prompts, code or credentials. Crash dumps can hold process memory, so they are left out. **Clear diagnostics** removes the metadata.

## Logs

Two plain-text logs stay on the computer, in Ramu's folder (`~/Library/Application Support/Ramu` on macOS, `~/.config/Ramu` on Linux):

- `background.log`: what the background service prints while it runs, such as the address it listens on and devices connecting. A pause of the service of five seconds or more is noted with the calls that were running, and so is a connection it ended, with the reason.
- `desktop-errors.log`: each call from the desktop window that failed, with its time, method, host and error. The same failure repeated within a few seconds is counted on one line. A pause of the app itself of five seconds or more is noted too. It never records what a call carried, and it moves to `desktop-errors.log.1` once it passes 2 MB.

A service started with `ramu up` writes to the system log instead: `journalctl --user -u ramu` on Linux, Console on macOS.
