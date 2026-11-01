# Security

Security fixes target the latest release.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on GitHub for a private report. If that is unavailable, open an issue asking for a private contact, without exploit details or secrets.

Include the version, OS, reproduction steps and impact. Remove credentials and private code from attachments.

## What Ramu can do

Agents run with your user permissions: they can read files, edit code and run commands. Providers receive the context you send them, including attached files and unsaved editor content. Closing the window leaves background agents and schedules running; stop them in Ramu when needed.

## Remote access

A device paired with **full access** can read workspace data, run agents and terminals, edit files and use the host's provider credentials. Pair only devices you trust.

A **viewer** can read conversations and answer approval and question requests. Approving a request can authorize the agent to act on it, so use viewers for trusted reviewers, not public sharing. The host enforces the viewer role with a method allowlist (`viewerMayInvoke`, `packages/shared/src/viewerAccess.ts`); new methods are denied to viewers by default. Disabled controls in the apps are a convenience, not the boundary.

- **Pairing:** `ramu pair` creates a full-access code and `ramu pair --role viewer` a viewer code. The role belongs to the single-use code; a device cannot ask for more. Failed attempts are rate limited per peer with exponential backoff.
- **Device permissions:** a full-access device also needs a permission for each of computer use, the browser, terminals and changing settings (reading status and settings stays open). New devices get the host's defaults (all four unless changed in Settings → Remote access); a viewer gets none, and a device paired before permissions keeps all four until one is changed. The host grants, extends or removes each one per device: **This time** (until that device's last connection closes), **For 1 hour**, **For 1 day** or **Always**. A device can request a missing permission; only a person at the host can allow it (Settings → Remote access or `ramu devices allow`). **Never** removes it and declines that device's further requests for it until the host allows it again itself. The server refuses the call otherwise, whatever the client shows.
- **Pairing by request:** while a pairing offer is open, a nearby device can ask instead of typing the code. The device commits to an X25519 key before the host sends its own, then reveals it; both derive a six-digit number and the device token from the exchange, so the token never crosses the network and a relay cannot make the numbers agree except by a one-in-a-million chance per attempt that a person must also approve. A request appears at the host only after a valid reveal, and only a person at the host (the desktop app or `ramu pair` in its terminal) can allow it, which spends the open offer with its role. Requests are refused without an open offer, limited to one per address and four in total, expire after two minutes, and failures count toward the same back-off. While an offer is open the host also advertises itself nearby, even when Discoverable is off.
- **Host pairings:** a person at host A can add host B for agents (`ramu hosts add <address> <code>` with a code from `ramu pair` on B, or Settings → Remote access → Hosts for agents). A pairs with B as a `host` device that B limits to four calls: start a thread, check or message threads that pairing started, and list projects. It holds no device permissions and receives no events, so it cannot read files, Git, terminals, settings, the browser or any transcript. Every thread it starts gets at most B's **Most access for its threads** for that pairing (default Allow edits), B's own depth limit (two levels of agent-started threads) and an hourly limit of 8 threads and 20 messages; B checks all of these itself, whatever A sends. A asks the person before every start on another host and never sends uncommitted changes. A keeps the token in the OS credential store and renews it before it expires; **Forget** on A stops using it, and revoking the device on B ends it immediately. Hosts never sync settings or credentials.
- **Devices:** `ramu devices` lists them and `ramu devices revoke <id>` (or `all`) revokes, as does Settings → Remote access. Revocation is immediate and closes open event streams.
- **Credentials:** a device token expires after 90 days of inactivity (set `RAMU_DEVICE_TOKEN_DAYS` to a number of days or `never`). Paired clients renew the token about monthly with `POST /renew`; the host retires the old token two minutes after the new one is first used.
- **Legacy bearer token:** disabled unless `RAMU_ALLOW_LEGACY_TOKEN=1`. Prefer per-device pairing so access can be revoked individually.
- **Browsers:** cross-origin browser access is off. `RAMU_BROWSER_ORIGINS` takes a comma-separated list of exact trusted HTTP(S) origins; origin checks supplement bearer authentication.
- **Network:** expose the server only on a trusted LAN or VPN, or behind authenticated HTTPS. Ramu has no relay and no end-to-end encryption; plain HTTP sends bearer tokens and workspace data unencrypted. The mobile app does not pin certificates, so use a trusted HTTPS certificate or your own authenticated VPN.

See [Headless server](docs/HEADLESS-SERVER.md) for running a host.

## Isolated content

- **Theme preview:** the Code/Diff preview in the theme editor runs bundled Monaco code on its own `ramu-theme:` origin. It serves only the preview entry and bundled assets, cannot read workspace files, call the native bridge or reach the parent window, and accepts only validated palette and view messages.
- **Interactive content:** agent-generated documents run in a separate `ramu-content:` origin with a restrictive content policy and cannot use the theme origin or any host API. See [Interactive content](docs/INTERACTIVE-CONTENT.md).
