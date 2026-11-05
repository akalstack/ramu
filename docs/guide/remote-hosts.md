# Remote hosts

A **host** is a computer that runs Ramu's workspace server: your agents, terminals, Git and history live there. The desktop app runs one for you. Another computer, a server or your phone can connect to it, and one desktop can connect to many hosts. Read [Security](../../SECURITY.md#remote-access) before opening a host to the network.

## From the desktop app

**Settings → Remote access** has two parts.

**Hosts you use** lists every host this computer works on. **Add a host** offers hosts nearby first, then one field that takes a pairing link, an address and code, or an SSH host (`user@host` or a name from `~/.ssh/config`). Each host shows its status and route, **Open**, and under ⋯ its **Connection settings…**, **Pause connection** and **Forget…**. A paused host shows **Resume**. A host's row also has **Agents here can start threads on** that host, and names any permission this computer lacks there with one **Request** for all of it; **Connection settings…** lists each permission. On the phone, Settings → Remote access shows the same for the selected host.

To work both ways, choose **Let {host} connect here…** under a connected host's ⋯. Ramu makes a code on this computer and asks on that host; once its owner taps **Connect**, each computer can open the other, and this one lists it under **Devices that can use this host**. Nobody types a code, and nothing connects until that owner accepts.

To have agents use another computer's screen, add that computer as a host and run the thread there; each host's agents use only its own screen.

**Let other devices use this host** decides who can reach this computer:

- **Local network or VPN** opens the host on a network you choose (all networks, or one such as your VPN). The network and **Discoverable** choices appear once it is on; the port is under **Advanced**.
- **How devices reach it** holds the network, **Discoverable** and the **Tunnel address**, which names [your own tunnel](#your-own-tunnel) to this host.
- **Pair a device** shows a one-time code and this host's addresses. With **Discoverable** on, a nearby device can also ask without a code: Ramu asks you to allow it (in the app, or as a notification when it is in the background or closed). Allow it only when both screens show the same six-digit number.
- **Device permissions** decide what each device may use: computer use, the browser, terminals, settings changes and agents. Grant this time, for an hour, a day or always. Each device shows what it runs on (an iPhone, an Android tablet, a Mac, an Ubuntu server…) once it has connected, and **Keep paired** sets how long that one device stays paired without use, or leaves it like the others. When a device asks for a permission it lacks, the request opens in Ramu on this host (or as a system notification when Ramu is in the background) with the same choices; closing it leaves the request waiting here until it lapses.

With a second host, a switcher appears at the top of the sidebar. Each host keeps its own threads, browser and settings, and notifications open the right host. **Apply settings to** in Settings edits one host or all of them. Beside each setting, the layers icon (shown on hover) lists its value on every selected host and whether that is the default. A setting whose hosts disagree says **Mixed** and offers to use one host's value everywhere; one a host does not know says **Not on** that host, because it runs an older Ramu, and offers **Restart service** when that host is this computer's background service.

A device pairs once and keeps one token, role and set of permissions on every route. It learns the host's other addresses (its tunnel address, VPN, LAN) and tries them when the saved one stops answering; each must prove it is the same host first.

## Headless server

```sh
pnpm build
pnpm server serve --listen 0.0.0.0:7788 --private-network
ramu pair
```

| Command | What it does |
| --- | --- |
| `ramu [serve]` | Run the server in the foreground; `--public-url` names [your own tunnel](#your-own-tunnel) |
| `ramu status`, `stop`, `restart` | Check, stop or restart it |
| `ramu up` | Let devices on your private network reach this host, keep it running as a service and pair a device; `--private-network`, `--no-private-network` and `--yes` make it scriptable |
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
| Anywhere | [Your own tunnel](#your-own-tunnel), or HTTPS in front, or a certificate for Ramu |

A private network (Tailscale, NetBird, ZeroTier or WireGuard) is the simplest choice: it is free for personal use, encrypted end to end, and needs no domain. Tailscale has the most polish and offers Funnel; NetBird is open source down to its coordination server, so you can run all of it yourself.

### Your own tunnel

A tunnel gives the host an `https://` address that works from any network, including devices that are not on your VPN. You run the tunnel; Ramu only needs its address.

1. Keep Ramu listening on this computer: `ramu serve --listen 7788`, or turn on **Allow other devices** in Settings.
2. Point a tunnel at `http://localhost:7788`:

   | Tunnel | How | Notes |
   | --- | --- | --- |
   | Cloudflare Tunnel | `cloudflared tunnel create ramu`, route a hostname such as `ramu.example.com` to it, then `cloudflared tunnel run --url http://localhost:7788 ramu` | Free; needs a domain on Cloudflare |
   | Tailscale Funnel | `tailscale funnel 7788` | Free; no domain, the address ends in `.ts.net` |
   | ngrok | `ngrok http 7788 --url <your free static domain>` | Free static domain |

   A Cloudflare quick tunnel (`trycloudflare.com`) gets a new address on every restart, so paired devices lose the host; use a named tunnel.
3. Give Ramu the address: **Settings → Remote access → How devices reach it → Tunnel address**, or `ramu serve --public-url https://ramu.example.com`.
4. Pair a device. The pairing link, the address list paired devices learn and webhook schedules all put the tunnel address first.

Every call through the tunnel still needs a paired device's token, and failed attempts are limited per visitor using the address the tunnel reports. The tunnel's provider decrypts HTTPS at its edge, so it can read what passes through; use a private network when that matters.

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

Terminals live on the host, so every device shows the same shells: what you type on one appears on the other. A terminal opened on the phone does not open a tab on the desktop by itself; the desktop's Terminal button gets a dot, and the shell joins the panel the next time you open it (straight away if the panel is already open).
