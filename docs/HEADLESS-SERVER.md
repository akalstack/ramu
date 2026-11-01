# Headless server and remote hosts

The workspace server (`apps/server`) owns agents, terminals, schedules, Git and the database. It runs without Electron, so a computer can host Ramu with no window open; the desktop app and the [mobile app](../apps/mobile/README.md) are clients. Read [Security](../SECURITY.md) before exposing one.

## Run it

```sh
pnpm build
pnpm server serve        # node apps/server/dist/cli.js serve
```

The package also installs `ramu` and `ramu-server`.

| Command | Purpose |
| --- | --- |
| `ramu [serve]` | Run in the foreground (`start` also works). |
| `ramu status` | Print pid, version, protocol and listen address. Exits 3 when not running. |
| `ramu stop` / `ramu restart` | Stop (threads are not resumed) or restart (unfinished threads resume). |
| `ramu pair [--url <address>] [--role viewer]` | Print a one-time pairing code and the addresses another device can use. |
| `ramu devices` / `ramu devices revoke <id\|all>` | List paired devices or revoke one (or all) immediately. |
| `ramu devices allow <id> <permission> [once\|hour\|day\|always]` / `deny` / `never` | Grant or remove computer, browser, terminal or settings for one device; `ramu devices` lists what each holds and pending requests. |
| `ramu hosts` / `ramu hosts add <address> <code> [--name <name>]` / `ramu hosts forget <id\|name>` | Hosts this host's agents may start threads on; adding one pairs this host there as a limited host device ([Agents and routing](AGENT-ROUTING.md#threads-on-another-host)). |
| `ramu devices access <id> <edits\|auto\|full>` | The most access threads a paired host starts here may have (default edits). |
| `ramu token [--rotate]` | Print the legacy shared token; `--rotate` revokes it and every paired device. |
| `ramu browser status\|threads\|setup\|stop` | Host browser readiness, thread IDs, Chromium preflight, or cancel work and close host tabs. |

Options: `--data-dir`, `--listen [host:]port`, `--discoverable`, `--worktrees`, `--private-network` (alias `--allow-plaintext-remote`), `--tls-cert`, `--tls-key`. Environment equivalents: `RAMU_USER_DATA`, `RAMU_LISTEN`, `RAMU_DISCOVERABLE`, `RAMU_WORKTREES`, `RAMU_ALLOW_PLAINTEXT_REMOTE`, `RAMU_TLS_CERT`, `RAMU_TLS_KEY`, `RAMU_SOCKET`, `RAMU_TOKEN_FILE`, `RAMU_DEVICES_FILE`.

The default data directory is the desktop app's (`~/Library/Application Support/Ramu`, `~/.config/Ramu`, `%APPDATA%\Ramu`), so the headless server and the desktop share threads, settings and database. One server runs per data directory; a desktop that finds one running attaches to it.

## Access

- **Local socket** (always on): a Unix socket with mode `0600`. The desktop uses it, and only socket clients can answer native dialogs such as the folder picker.
- **Network** (opt-in with `--listen`): HTTP(S) with a per-device bearer token. `GET /health` needs no token; everything else, calls and events included, runs over one WebSocket ([Architecture](ARCHITECTURE.md#transport)).

A bare port (`--listen 7788`) binds `127.0.0.1` only. Binding any other address is refused unless traffic is encrypted or you declare the network trusted:

- `--tls-cert <file> --tls-key <file>` serves HTTPS on any address. Use a certificate from your VPN, a private CA, or a TLS-terminating proxy in front of a loopback listener.
- `--private-network` accepts plain HTTP when every device that can reach the address is on a network you trust (a VPN or LAN).

If the address is not available yet (a VPN that comes up after the service), the server keeps serving local clients and retries the listener with backoff.

### Pair a device

`ramu pair` prints a code such as `K7QM2-X9RTD`, valid once for 10 minutes, and every address of this host (one line per interface, so LAN, Tailscale or NetBird addresses all appear). `--url` prints a name instead, such as a MagicDNS hostname or proxy address. The other device trades the code for its own token:

```sh
curl -s -X POST <address>/pair -H 'Content-Type: application/json' -d '{"code":"K7QM2-X9RTD","name":"My laptop"}'
# {"deviceId":"99b9962f","token":"…"}
```

It then sends `Authorization: Bearer <token>`; `packages/client-runtime` provides `runtimePair()`. Instead of the code, a device can choose this host under **Nearby hosts**: while the offer is open the host advertises itself and `ramu pair` waits in the terminal, showing each request's name, address and six-digit number and asking `Allow? [y/N]`. Allow only when the device shows the same number ([Security](../SECURITY.md)). The host stores only a hash of the token, so a lost token means pairing again. Revoking from Settings closes active streams immediately; the CLI closes them at the next heartbeat (within 20 seconds). Only someone at the host can create or revoke a device.

### Works with any network

| Network | How |
| --- | --- |
| Tailscale, NetBird, ZeroTier, WireGuard | Bind the VPN address (or `0.0.0.0` with `--private-network`), then `ramu pair`; `--url` can use the VPN's DNS name. |
| LAN | Same, if you trust everyone on it. |
| SSH tunnel | Keep the loopback listener, run `ssh -L 7788:127.0.0.1:7788 host`, and pair against `http://127.0.0.1:7788`. |
| Reverse proxy or public name | Terminate TLS in the proxy or give Ramu `--tls-cert`/`--tls-key`, and pass `--url https://…`. |

`--private-network` with `0.0.0.0` listens on every interface, not only the VPN. Prefer binding the VPN address and keep a firewall in front of anything else. **A full-access device can do whatever the desktop can, including running terminals and agents with your provider credentials.** Treat each like an SSH key.

### Discovery and availability

- **Discoverable** (off by default; needs network access on): the host advertises its name, a random identifier, protocol version, transport and port over mDNS (`_ramu._tcp`) on the interfaces its listener serves, and nothing else. Finding a host grants nothing; pairing still needs a code. The identifier lives in `<data-dir>/discovery.json`. Headless hosts use `--discoverable`.
- **Announcements:** the desktop listens on a small UDP port and tells the host where; when the host's listener starts or its interfaces change it sends a short signed packet asking paired devices to reconnect. Packets are signed with a key derived from the device token, replays and expired packets are ignored, and recipients are stored in `<data-dir>/presence.json` without tokens. Firewalls, NAT, older hosts or clock skew over two minutes can block delivery; use **Retry** or the five-minute fallback.
- **Browse roots:** the mobile app can browse the host's folders to add projects. Roots default to the home folder and existing projects; set `RAMU_BROWSE_ROOTS` to restrict them.

## From the desktop app

**Settings → Remote access** does the same without a terminal.

- **Let other devices connect:** choose the network (all, or one address such as the VPN's) and a port. It applies at once and is saved in `<data-dir>/network.json`; Ramu asks before listening beyond this host without TLS. A server started with `--listen` shows that setting and leaves it alone.
- **Pair a device:** shows a one-time code and this host's addresses (Docker and VM networks tucked away), lists nearby devices asking to pair with the number each shows (**Allow** only a match), sets what new devices may use (computer use, browser, terminals, settings), answers permission requests (this time, 1 hour, 1 day, always, deny, or never to stop further requests), changes each device's permissions, notices when the device pairs, and lists devices with last-seen time and Revoke.
- **Hosts:** to add one, use **Nearby hosts** (this computer listens for discoverable hosts only while the panel is open and focused, for at most two minutes; choosing one asks that host to pair; allow it there when both show the same number, or enter its code if it predates this), or enter an address, pairing code and optional name. **Enter an address** and **Use SSH** stay available when discovery is empty, blocked or denied. Tokens stay in the main process, encrypted with the system keychain when available.
- **Host cards** show address, status, activity and whether the workspace is open. **Connection settings** renames the host, copies its address, sets the reconnect policy, or turns off **Keep connected** (pause without removing credentials). **Open**, **Retry**, **Resume** and **Forget** do what they say. Names and policies belong to this device.
- **Switch hosts:** with a second host, a switcher appears at the top of the sidebar showing status, working threads and threads waiting for input. Each host keeps its own workspace, browser storage and open threads. Notifications name the host and open its thread. A revoked connection shows **Pair again** and stops retrying. A workspace on another host shows **Remote · host name** in the top bar.
- **Reconnect:** after a failure Ramu retries after 1, 2 and 4 seconds, then waits. The default policy, **When the network or host returns**, reconnects on a network change, wake, signed announcement or **Retry**; **Also check every five minutes** adds a fallback. With no usable interface the host shows **Waiting for network**. Paused connections ignore wake signals and rejected tokens never retry. Switching workspaces does not start or stop a connection.

While viewing another host, threads, files, terminals and settings come from it. Add projects and use native file dialogs on the host that has the files; background service controls and network access are managed there too. Files deleted in Explorer and untracked files discarded in Source Control are deleted permanently on the owning host.

### Many hosts

Connections are independent of workspace views: all enabled hosts keep event streams and notifications in the main process. At most eight handshakes (two per address) start at once and sixteen remote calls (four per address) run at once. Up to four remote views stay warm; clean hidden views are released after memory pressure or ten minutes idle, after saving layout and drafts. Views with unsaved files, open terminals, attachments, unfinished forms, pending uploads or failed persistence are kept even beyond four. Hidden views pause layout, transcript delivery and polling; hidden terminal output is buffered with a bound and shows a truncation marker if exceeded.

Tests cover 100 loopback sockets delivering 10,000 events (`packages/client-runtime/test/scale.test.ts`) and a 100-host status burst (`apps/desktop/test/computers.scale.test.ts`). Warm-view eviction has no end-to-end test; check it by hand when changing it.

### Editing settings on several hosts

The **Apply settings to** selector in the Settings header edits **All hosts** or one host. Controls show **Mixed** when hosts differ, offer values valid on every selected host, and **Use this value for all** applies the displayed value. A save patches only changed settings, checks for concurrent edits and reports failures per host; successful hosts stay saved. Provider sign-in, service management, pairing and other machine actions need a single host selected.

## Protocol

`packages/contracts` defines the wire format. `GET /socket` upgrades to the one WebSocket that carries every call and event; a network host authenticates the upgrade by its `Authorization` header (never the URL), and the local service accepts the same socket on its Unix socket. Frames: `invoke` (optional `operationKey` so a retried mutation runs once), `subscribe`, `ack` (terminal flow control) and `ping`; the host answers `ready`, `result`, `error` and `event`. HTTP remains for `POST /pair`, `POST /renew`, `GET /health`, `GET /session` (does this token work, and as which role) and host-proof checks. `background.status` returns `protocol` and `capabilities` so independently updated clients can check compatibility. `RuntimeSocket` in `packages/client-runtime` is the client used by the desktop, the CLI and the phone; a failed connection is reported as what it is (refused token, no socket on the host, nothing listening) rather than retried over another transport.

## Run it as a service

systemd (Linux user service):

```ini
[Service]
ExecStart=/usr/bin/node /opt/ramu/apps/server/dist/cli.js serve --listen 127.0.0.1:7788
Restart=on-failure
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

`ramu stop` exits successfully, so `Restart=on-failure` respects an intentional stop. On macOS the desktop app installs its own launchd agent (Settings → background service).

Not built: a TLS setup screen (use `--tls-cert`/`--tls-key`), end-to-end encryption independent of the network, and a relay for hosts on no shared network.

## Host browser

Browser in a thread works from any paired owner device. With no desktop app open on the host (a headless server), the browser is host Chromium, running like terminals with no extra setup. First use downloads a compatible Chromium and checks its sandbox (`ramu browser setup` is an optional preflight); set `RAMU_BROWSER_EXECUTABLE` to use an installed one. Missing dependencies or sandbox support are reported and Ramu never adds `--no-sandbox`. Website profiles stay on this host, separate from the desktop's, and a running turn keeps its runtime.

Viewers see bounded JPEG frames over authenticated calls and never receive cookies or a debug endpoint; background viewers stop capturing. Five seconds without a heartbeat pauses human control without handing it to the agent, and the host can take control to recover a lost device. Viewer-role devices cannot use it; profile administration and the runtime switch stay on the host. `ramu browser stop` cancels work, closes tabs and revokes grants; persistent profiles remain, Temporary ones are removed with their tabs, and completed downloads expire after an hour. See [UI](UI.md#integrated-browser) for ownership and transfers.
