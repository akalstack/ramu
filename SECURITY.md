# Security

Security fixes target the latest release.

Use **Security → Report a vulnerability** on GitHub for private reports. If unavailable, open an issue requesting a private contact without posting exploit details or secrets.

Include the version, OS, reproduction steps, and impact. Remove credentials and private code from attachments.

Agents run with your user permissions and can read files, edit code, and execute commands. Providers receive the context sent to them, including attached files and unsaved editor content. Closing the window leaves background agents and schedules running; stop them in Ramu when needed.

## Remote access

A device paired with full access can read workspace data, run agents and terminals, edit files, and use the host's provider credentials. Pair only devices you trust. A viewer can read conversations and answer approval/question requests; approving a request can authorize the agent to execute it. Viewer access is therefore intended for trusted reviewers, not public sharing. The desktop composer disables sending on a viewer host and explains why; this is a convenience, and the host still refuses every disallowed request.

Expose the server only on a trusted LAN/VPN or through authenticated HTTPS/tunnelling. Ramu has no relay or end-to-end encryption. HTTP sends bearer credentials and workspace data without application-level encryption. Native mobile certificate pinning is still unfinished; use a trusted HTTPS certificate or your own authenticated VPN.

Create a full-access pairing with `ramu pair`, or a viewer pairing with `ramu pair --role viewer`. The role is bound to the single-use code by the host. List devices with `ramu devices`; revoke a lost device in Settings → Remote access or with `ramu devices revoke <id>`. Use `all` to revoke every paired device. Revocation also closes its event streams.

Device credentials expire after 90 days of inactivity by default. Authenticated activity extends their expiry. Paired desktop and mobile clients also rotate the secret about monthly: `POST /renew` with the current token returns a fresh one, the client saves it before use, and the host retires the old token two minutes after the new token's first use (an unused renewed token is dropped after seven days, and a lost response just means asking again). Hosts that predate renewal keep the original token. Set `RAMU_DEVICE_TOKEN_DAYS` to positive days or explicitly to `never` on the server to choose a different policy. Existing records use their last recorded activity for migration, so inactive old devices may need pairing again. The CLI and host Settings show expiry.

Legacy shared bearer authentication is disabled unless `RAMU_ALLOW_LEGACY_TOKEN=1` is set. Prefer per-device pairing so access can be individually revoked. Browser access is disabled by default; set `RAMU_BROWSER_ORIGINS` to a comma-separated list of exact trusted HTTP(S) origins to enable it. Origin checks supplement bearer authentication.
