# Remote hosts

A **host** is a computer that runs Ramu's workspace server: your agents, terminals, Git and history live there. The desktop app runs one for you. Another computer, a server or your phone can connect to it, and one desktop can connect to many hosts. Read [Security](../../SECURITY.md#remote-access) before opening a host to the network.

## From the desktop app

**Settings → Remote access**:

- **Let other devices connect** opens the host on a network you choose (all networks, or one such as your VPN) and a port.
- **Pair a device** shows a one-time code and this host's addresses. Nearby devices can also ask to pair; allow one only when both screens show the same six-digit number.
- **Device permissions** decide what each device may use: computer use, the browser, terminals, settings changes and agents. Grant this time, for an hour, a day or always.
- **Hosts** adds another host by choosing it nearby, or by address and code. Each host card has a switch that turns its connection off and on without forgetting it.

With a second host, a switcher appears at the top of the sidebar. Each host keeps its own threads, browser and settings, and notifications open the right host. **Apply settings to** in Settings edits one host or all of them.

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
| `ramu pair [--role viewer]` | Print a one-time pairing code and this host's addresses |
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
| Public name | Put HTTPS in front, or give Ramu a certificate |

A full-access device can do anything the desktop can, including run terminals and agents with your provider accounts. Treat each one like an SSH key.

### As a service

```ini
[Service]
ExecStart=/usr/bin/node /opt/ramu/apps/server/dist/cli.js serve --listen 127.0.0.1:7788
Restart=on-failure

[Install]
WantedBy=default.target
```

On macOS the desktop app installs its own background service.

## Threads from a terminal

Claude Code, Codex or a script on the host can place work where you'll see it:

```sh
ramu thread start --project api --as codex "Fix the failing date test"
ramu thread status <id> --wait --json
```

These threads run at **Allow edits**, show **Started from a terminal by ‹name›**, and work only through the host's own local socket.

## Phone

See the [mobile guide](../../apps/mobile/README.md) to pair the iOS or Android app.
