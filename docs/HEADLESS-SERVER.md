# Headless server

The workspace server (`apps/server`) is the background service that owns agents, terminals, schedules, Git and the database. It runs without Electron, so a host can host Ramu with no window open, and the desktop app is one of its clients.

## Run it

```sh
pnpm build
node apps/server/dist/cli.js serve        # or: pnpm server serve
```

Commands (also installed as `ramu` and `ramu-server` when the package is linked):

| Command | Purpose |
| --- | --- |
| `ramu [serve]` | Run in the foreground. `start` also works. |
| `ramu status` | Print pid, version, protocol and listen address. Exits 3 when not running. |
| `ramu stop` / `ramu restart` | Stop (threads are not resumed) or restart (unfinished threads resume). |
| `ramu pair [--url <address>]` | Print a one-time pairing code and the addresses the other device can use. |
| `ramu devices` / `ramu devices revoke <id\|all>` | List paired devices, or revoke one (or all) immediately. |
| `ramu token [--rotate]` | Print the shared access token; `--rotate` revokes it and every paired device. |

Options: `--data-dir`, `--listen [host:]port`, `--worktrees`, `--private-network` (alias `--allow-plaintext-remote`), `--tls-cert` and `--tls-key`. Environment equivalents: `RAMU_USER_DATA`, `RAMU_LISTEN`, `RAMU_WORKTREES`, `RAMU_ALLOW_PLAINTEXT_REMOTE`, `RAMU_TLS_CERT`, `RAMU_TLS_KEY`, `RAMU_SOCKET`, `RAMU_TOKEN_FILE`, `RAMU_DEVICES_FILE`.

The default data directory is the desktop app's (`~/Library/Application Support/Ramu`, `~/.config/Ramu`, `%APPDATA%\Ramu`), so the headless server and the desktop app share threads, settings and the database. Only one server runs per data directory. If the desktop app starts and finds a running server, it attaches to it instead of starting another.

## Local and remote access

- **Local socket** (always on): a unix socket with mode `0600`. The desktop app uses it, and only socket clients can answer native dialogs such as the folder picker.
- **Network** (opt-in with `--listen`): HTTP(S) with a bearer token. Each device has its own token (see below); the shared token in `<data-dir>/remote-token` (mode `0600`) still works. Repeated bad tokens or codes from one address are rate limited. `GET /health` needs no token.

A bare port such as `--listen 7788` binds `127.0.0.1` only. Binding any other address is refused unless the traffic is encrypted or you say the network is trusted, because Ramu cannot tell what kind of network an address is on:

- `--tls-cert <file> --tls-key <file>` serves HTTPS, so any address is allowed. Use a certificate from your VPN, a private CA, or a TLS-terminating proxy in front of a loopback listener.
- `--private-network` accepts plain HTTP when every device that can reach the address is on a network you trust. Use it for a VPN or a LAN.

If the address is not available yet (a VPN that comes up after the service), the server keeps running for local clients and retries the listener with backoff instead of exiting.

## From the desktop app

Settings → Remote access does the same without a terminal.

- **Let other devices connect:** switch network access on, choose which network to listen on (all of them, or one address such as your VPN's) and a port. It applies at once, with no restart, and is saved in `<data-dir>/network.json`. Ramu asks you to confirm before listening beyond this host without TLS. If the server was started with `--listen`, the screen shows that setting and leaves it alone.
- **Pair a device:** shows a one-time code and this host's addresses (Docker and VM networks are tucked away). The dialog notices when the other device pairs. Paired devices are listed with their last-seen time, and Revoke cuts one off immediately.
- **Hosts:** enter another host's address, pairing code and an optional name. The desktop app keeps the token in the main process (encrypted with the system keychain when there is one) and never shows it to the page. Enabled hosts stay connected together while the app runs. Each card shows its address, status, activity and whether its workspace is open. **Connection settings** lets you rename the saved host, copy its address, choose a reconnect policy, or turn off **Keep connected** to pause it without removing its credentials. **Resume** reconnects a paused host. Names and connection policies belong to this device. **Open** shows its workspace immediately; **Retry** reconnects an offline host, and **Forget** removes its saved connection and workspace storage. Forgetting the host you are viewing brings you back to this host.
- **Switch hosts:** after pairing a second host, a switcher appears at the top of the sidebar. Each host keeps its own workspace, browser storage and open threads as you switch. The menu shows connection status and counts of working threads and threads waiting for input. Notifications from another host include its name and open the thread on that host. A revoked connection shows **Pair again** and stops retrying; forget it and pair with a fresh code.
- **Workspace location:** a workspace hosted on another host shows **Remote · host name** in the top bar, including when the sidebar is hidden. The indicator remains if that host goes offline and shows its connection status; its tooltip explains where files, terminals and agents run. Local workspaces have no remote badge.
- **Offline hosts:** after an initial failure, Ramu tries again after 1, 2 and 4 seconds, then waits. The default **When the network or host returns** policy uses network changes, waking from sleep, signed host announcements, or **Retry**, with no periodic connection attempts. **Also check every five minutes** adds a quiet fallback if announcements cannot reach this device. Without a usable interface, requests pause and the host shows **Waiting for network**. Paused connections ignore all wake-up signals; rejected tokens never retry automatically. Retries stay silent, and activity polling pauses while disconnected. Switching workspaces does not start or stop a connection.

While viewing another host, threads, files, terminals and settings come from it. Add projects and use native file dialogs on the host hosting them; those dialogs are unavailable from a paired host's workspace. Background service controls and network access are managed on the hosting host. Files deleted in Explorer, and untracked files discarded in Source Control, are deleted permanently on the host that owns the workspace.

### Many saved hosts

Connections are independent of workspace views. All enabled hosts keep their event streams and notifications in the main process, even when their workspace is suspended or released. Network-interface detection and the announcement listener are shared. At most eight remote connection handshakes start at once (two per address), and remote RPCs are limited to sixteen at once (four per address). Activity counts use one request at a time per host, with a ten-second timeout and coalesced follow-up changes.

The desktop app caches saved records and decrypted credentials, and batches computer-status bursts into one snapshot for the visible workspace. Hidden workspaces pause layout, transcript delivery, activity polling and usage refreshes. Terminal output is buffered with a size limit; if that limit is exceeded, the terminal shows a truncation marker when you return. The shell keeps running on its host.

Up to four remote workspace views stay warm. Clean hidden views are released under cache pressure or after ten minutes idle, after checkpointing their workspace layout and composer drafts in this client’s isolated storage. Clean offline or paused views can be released as well. Reopening restores their isolated storage and workspace state without reconnecting the host. Views with unsaved files, open terminals, attachments, unfinished forms, pending uploads, pinned file context, failed persistence or an incomplete load stay protected. Protected workspaces can exceed the warm-view limit; Ramu preserves your work instead of forcing an eviction. The local workspace remains loaded.

Verification includes 100 simultaneous loopback event streams delivering 10,000 events, a simulated 100-computer status burst, and a real six-environment Electron flow covering eviction, draft restoration, hidden polling and unsaved-editor protection. These are local checks, not a guarantee for a particular VPN or machine's available memory.

The mobile companion in `apps/mobile` is not part of the alpha release; pairing is available from the desktop client and a programmatic API.

### Host availability announcements

The desktop app opens a small UDP listener while running and advertises its port over each authenticated event stream. The host remembers the source address and port for a paired device, then sends a short signed announcement when its network listener starts or its interfaces change. Announcements only request reconnection: Ramu still establishes and authenticates the regular HTTP(S) connection before reporting the host online. They do not execute commands or change settings.

Messages are signed using a key derived from the paired device token; invalid, expired and replayed packets are ignored. The host stores recipient addresses in `<data-dir>/presence.json`, not their raw tokens, and revoked devices receive no announcements. This works over reachable LAN/VPN paths, without a provider-specific integration or relay. Firewalls, NAT, older hosts, or clock differences over two minutes can prevent delivery. In those cases use **Retry**, a local network change, or opt into the five-minute fallback in the host's connection settings.


## Pair a device

```sh
ramu pair
```

prints a code such as `K7QM2-X9RTD` that works once and expires in 10 minutes, plus every address this host has (one line per network interface, so a LAN, Tailscale or NetBird address all show up). Use `--url` to print a name instead, such as a MagicDNS or `*.netbird.cloud` hostname or a proxy address.

The other device trades the code for its own token:

```sh
curl -s -X POST <address>/pair -H 'Content-Type: application/json' -d '{"code":"K7QM2-X9RTD","name":"My laptop"}'
# {"deviceId":"99b9962f","token":"…"}
```

It then sends `Authorization: Bearer <token>` on every request. `packages/client-runtime` has `runtimePair()` for this. Only a hash of the token is stored on the host, so it cannot be recovered there; pair again if it is lost. `ramu devices` lists devices and `ramu devices revoke <id>` blocks new requests immediately, without a restart. Revocation from Settings also closes active event streams immediately; CLI revocation closes them at the next heartbeat, within 20 seconds. A paired device can only be made by someone at this host: `/pair` is the one route that takes a code instead of a token, and device management is local to the host through the CLI or desktop Settings.

### Works with any network

Ramu does not look for a particular VPN. It listens where you tell it to and reports the addresses it has, so anything that gives this host a reachable address works:

| Network | How |
| --- | --- |
| Tailscale, NetBird, ZeroTier, WireGuard | Bind the VPN address or `0.0.0.0` with `--private-network`, then `ramu pair`. Pass `--url` to use the VPN's DNS name. These VPNs encrypt traffic between peers. |
| LAN | Same as above, if you trust everyone on it. |
| SSH tunnel | Keep the loopback listener and run `ssh -L 7788:127.0.0.1:7788 host`; pair against `http://127.0.0.1:7788`. |
| Reverse proxy or a public name | Terminate TLS in the proxy, or give Ramu `--tls-cert` and `--tls-key`, and pass `--url https://…`. |

`--private-network` with `0.0.0.0` listens on every interface, including ones that are not your VPN. Prefer binding the VPN address when it is stable, and keep a firewall in front of anything else.

**A paired device can do what the desktop app can do, including running terminal commands and agents with your provider credentials.** Treat each device like an SSH key and revoke the ones you no longer use.

## Protocol

`packages/contracts` defines the wire format: `POST /invoke` with `{ method, args }`, and `GET /events` as server-sent events. `background.status` returns `protocol` and `capabilities` so clients that update independently can check compatibility. `packages/client-runtime` is the Node client for both transports.

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

`ramu stop` exits successfully, so `Restart=on-failure` does not fight an intentional stop. On macOS the desktop app installs its own launchd agent (Settings → background service).

## Not built yet

There is no QR code or deep link for pairing, no remote folder browser for adding projects to a server from another host, no TLS setup screen (use `--tls-cert` and `--tls-key`), no end-to-end encryption independent of the network, and no relay for reaching a host that is on no shared network. Those would build on this server and protocol.

## Editing settings on multiple hosts

Use the **Apply settings to** selector in the Settings header. **All environments** edits matching settings on every connected host; choose a host to edit only that one. The selection stays active as you move between categories, including Appearance, Providers and model sets. Offline hosts keep their settings.

Each host reports its current settings and constraints. Controls offer common choices, show **Mixed** when values differ, and disable incompatible settings. Structured lists can be shared when their formats match. Model pickers use models and reasoning efforts available on every selected host. **Use this value for all** explicitly applies the displayed value or list when targets differ.

Saving patches only changed settings, checks for concurrent edits and changed options, and reports failures per host. Successful saves remain saved if another host fails. Reloading discards pending changes and reads current settings. Provider sign-in, service management, pairing and other machine actions require selecting a single host in the header.
