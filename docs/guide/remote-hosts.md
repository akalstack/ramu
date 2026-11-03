# Remote hosts

A **host** is a computer that runs Ramu's workspace server: your agents, terminals, Git and history live there. The desktop app runs one for you. Another computer, a server or your phone can connect to it, and one desktop can connect to many hosts. Read [Security](../../SECURITY.md#remote-access) before opening a host to the network.

## From the desktop app

**Settings → Remote access**:

- **Let other devices connect** opens the host on a network you choose (all networks, or one such as your VPN) and a port.
- **Ramu Link** reaches the host from anywhere without a VPN or open ports. Sign in with Google or GitHub; devices signed in to the same account list the host under **Add a host → Ramu Link** (on a phone, the pairing screen's Ramu Link tab) and pair after both screens show the same six-digit number. Streams are end-to-end encrypted, so the relay cannot read them. See [Ramu Link](#ramu-link).
- **Cloudflare Tunnel** gives the host a public HTTPS address: **Temporary address** needs no account, **My own tunnel** uses a token and hostname from your Cloudflare dashboard. Ramu runs a pinned, checksum-verified `cloudflared`.
- **Pair a device** shows a one-time code and this host's addresses. With **Discoverable** on, a nearby device can also ask without a code: Ramu asks you to allow it (in the app, or as a notification when it is in the background or closed). Allow it only when both screens show the same six-digit number.
- **Device permissions** decide what each device may use: computer use, the browser, terminals, settings changes and agents. Grant this time, for an hour, a day or always. A device that offers this host its screen for agents is allowed or refused in the same place. When a device asks for a permission it lacks, the request opens in Ramu on this host (or as a system notification when Ramu is in the background) with the same choices; closing it leaves the request waiting here until it lapses.
- **Hosts** adds another host by choosing it nearby, or by address and code. Each host card has a switch that turns its connection off and on without forgetting it, and **Permissions** holds both directions: what this computer may do on that host, and whether that host may use this computer's screen. On the phone, Settings → Remote access shows the same for the selected host.

With a second host, a switcher appears at the top of the sidebar. Each host keeps its own threads, browser and settings, and notifications open the right host. **Apply settings to** in Settings edits one host or all of them.

A device pairs once and keeps one token, role and set of permissions on every route. It learns the host's other addresses (LAN, VPN, tunnel, Link), tries direct ones first, falls back to Link, and moves back to a direct route as soon as one answers.

## Headless server

```sh
pnpm build
pnpm server serve --listen 0.0.0.0:7788 --private-network
ramu pair
```

| Command | What it does |
| --- | --- |
| `ramu [serve]` | Run the server in the foreground |
| `ramu status`, `stop`, `restart` | Check, stop or restart it |
| `ramu up` | Choose how devices reach this host (Ramu Link, Cloudflare Tunnel, private network), keep it running as a service and pair a device; `--link`, `--tunnel`, `--private-network`, their `--no-` forms and `--yes` make it scriptable |
| `ramu link login\|logout\|on\|off\|status`, `ramu link service <url>` | Sign this host in to Ramu Link (prints a code and a link to approve on any device) or manage it |
| `ramu tunnel quick\|named <hostname>\|off\|status` | Manage the Cloudflare Tunnel; a named tunnel's token is read from `RAMU_TUNNEL_TOKEN` or asked for |
| `ramu pair [--role viewer]` | Print a one-time pairing code and this host's addresses |
| `ramu pair --approve <request>`, `--deny <request>` | Answer a nearby device's request; the server prints each one with its number |
| `ramu devices` | List, revoke and grant permissions to paired devices |
| `ramu hosts add <address> <code>` | Let this host's agents start threads on another host |
| `ramu thread start\|status\|message\|list` | Start and follow threads from a terminal |
| `ramu browser status\|setup\|stop` | Manage the host's browser |

A bare port (`--listen 7788`) listens on this computer only. Any other address needs HTTPS (`--tls-cert`, `--tls-key`) or `--private-network` for a VPN or LAN you trust. By default the server shares its data folder with the desktop app, so both see the same threads.

### Any network

| Network | How |
| --- | --- |
| Tailscale, NetBird, ZeroTier, WireGuard | Listen on the VPN address, then `ramu pair` |
| LAN | The same, if you trust everyone on it |
| SSH tunnel | Keep the loopback listener and `ssh -L 7788:127.0.0.1:7788 host` |
| Public name | Put HTTPS in front, give Ramu a certificate, or `ramu tunnel named <hostname>` |
| Anywhere, no setup | `ramu link login` (Ramu Link) or `ramu tunnel quick` |

A full-access device can do anything the desktop can, including run terminals and agents with your provider accounts. Treat each one like an SSH key.

### Ramu Link

Ramu Link is a small service on Cloudflare Workers (`apps/link`): Better Auth for Google and GitHub sign-in, a list of the hosts each account links (5 per account), and a relay that joins a device's stream to its host. No hosted deployment exists yet, so point Ramu at your own: deploy it with [apps/link/README.md](../../apps/link/README.md), then set the service under Settings → Remote access → Ramu Link, or `RAMU_LINK_URL` on a headless host. Every client signs in with a short code approved in a browser, so it works over SSH and on a phone without a callback port.

### As a service

```ini
[Service]
ExecStart=/usr/bin/node /opt/ramu/apps/server/dist/cli.js serve --listen 127.0.0.1:7788
Restart=on-failure

[Install]
WantedBy=default.target
```

On macOS the desktop app installs its own background service.

### Keeping hosts up to date

**Settings → Remote access** shows each connected host's Ramu version and provider CLIs, with **Update Ramu** and **Update providers** when something is newer; **Update all hosts** does every host at once, this computer last. The phone's host list has the same actions. Viewer devices see none of this.

- **A host with Ramu's desktop app open** downloads the release and its app installs it, then restarts and reconnects. It installs only signed builds; until releases are signed, it says so and links the release.
- **A headless host running from a checkout** (as above) moves to the release tag, runs `pnpm install` and `pnpm build`, and restarts if a service manager will start it again (systemd, launchd, or `RAMU_SUPERVISED=1`); otherwise it asks you to restart the service. A checkout with local changes is left alone, and a failed build is put back on the version that ran.
- A release that failed to install on a host is not retried from another device; retry it on the host.

## Threads from a terminal

Claude Code, Codex or a script on the host can place work where you'll see it:

```sh
ramu thread start --project api --as codex "Fix the failing date test"
ramu thread status <id> --wait --json
```

These threads run at **Allow edits**, show **Started from a terminal by ‹name›**, and work only through the host's own local socket.

## Phone

See the [mobile guide](../../apps/mobile/README.md) to pair the iOS or Android app.
