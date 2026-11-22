# Remote hosts

A **host** is a computer that runs Ramu's workspace server: your agents, terminals, Git and history live there. The desktop app runs one for you. Another computer, a server or your phone can connect to it, and one desktop can connect to many hosts. Read [Security](../security-model.md#remote-access) before opening a host to the network.

## Connect a phone

Select the phone button at the foot of the sidebar (or **Connect a phone** in the command palette, or the **Your phone** step of a new host's setup). Scan the QR code with the phone's own camera: it opens Ramu with the code filled in, or the App Store or Google Play first, and then Ramu. If other devices can't reach this host yet, **Allow devices on this network** does it in one step. Ramu doesn't encrypt that connection, so use it on a network or VPN you trust. The code works once and a new one replaces it every 10 minutes while it's on screen. The window says which device paired as soon as it does. The link behind the code goes to getramu.dev with the host's address and code after `#`, which a browser never sends to the site.

To connect from anywhere instead, sign in to the same [Ramu account](account.md#your-hosts) on both devices.

## From the desktop app

**Settings → Remote access** has two parts.

**Hosts you use** lists every host this computer works on. Devices signed in to the same [Ramu account](account.md#your-hosts) find your listed hosts without a code, as each host allows. **Add a host** offers hosts nearby first, then one field that takes a pairing link, an address and code, or an SSH host (`user@host` or a name from `~/.ssh/config`). Each host shows its status and route, **Open**, and under ⋯ its **Connection settings…**, **Pause connection** and **Forget…**. A paused host shows **Resume**. A host's row also has **Agents here can start threads on** that host, and names any permission this computer lacks there with one **Request** for all of it; **Connection settings…** lists each permission. On the phone, Settings → Remote access shows the same for the selected host.

To work both ways, choose **Let {host} connect here…** under a connected host's ⋯. Ramu makes a code on this computer and asks on that host. Once its owner taps **Connect**, each computer can open the other, and this one lists it under **Devices that can use this host**. Nobody types a code, and nothing connects until that owner accepts.

To have agents use another computer's screen, add that computer as a host and run the thread there; each host's agents use only its own screen.

**Let other devices use this host** decides who can reach this computer:

- **Allow other devices** opens the host to the network chosen under **How devices reach it**: **Network** (all networks, or one such as your VPN) and **Discoverable on this network**. The port is under **Advanced**.
- **From anywhere** turns on [Ramu Link](#ramu-link), or runs or names a [tunnel](#your-own-tunnel) to this host.
- **Pair a device…** opens the same window as the phone button: the QR code, a one-time code, a pairing link to send, and this host's addresses (**Use in QR code** picks the one the code carries). **Device access** picks **Full access** or **View threads and answer requests**. With **Discoverable on this network** on, a nearby device can also ask without a code. Ramu asks you to allow it (in the app, or as a notification when it's in the background or closed). Allow it only when both screens show the same six-digit number.
- Each device's permissions decide what it may use: computer use, the browser, terminals, settings changes and agents. Agents is offered only to computers: a phone or tablet connects to hosts and runs no agents of its own. Each is **Allowed**, **Ask first** (the device can request it) or **Blocked** (its requests are declined without asking). Each device shows what it runs on (an iPhone, an Android tablet, a Mac, an Ubuntu server…) once it has connected, and **Keep paired** sets how long that one device stays paired without use, or leaves it like the others. When a device asks for a permission it lacks, the request opens in Ramu on this host (or as a system notification when Ramu is in the background) with **Allow this time** (until that device disconnects), **Allow for 1 hour**, **Always allow**, **Deny** and **Don’t ask again**. A request allowed for a while shows in Settings as **Allowed until** its end, until you set a lasting state. Closing the request leaves it waiting here until it lapses, and the asking device, desktop or phone, shows the answer as soon as you give it.

With a second host, a switcher appears at the top of the sidebar. Each host keeps its own threads, browser and settings, and notifications open the right host. A host that is away (offline, still connecting or paused) still opens from what this computer last read of it: its projects and threads are listed, its recent threads show their last turns, and a message you write waits in the thread, as does a new thread, and is sent in order once the host is back. When it is back, the thread on screen says **Syncing messages…** at its end, on the desktop and the phone, until the host has caught it up; a quick catch-up shows nothing, and opening or switching threads reads quietly. A host that refused this computer does not open. **Apply settings to** in Settings edits one host or all of them. Beside each setting, the layers icon (shown on hover) lists its value on every selected host and whether that is the default. A setting whose hosts disagree says **Mixed** and offers to use one host's value everywhere; one a host does not know says **Not on** that host, because it runs an older Ramu, and offers **Restart service** when that host is this computer's background service.

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
| `ramu tunnel link [relay]\|quick\|tailscale\|ngrok [domain]\|off` | Reach this host from anywhere through [Ramu Link](#ramu-link) or a [tunnel](#your-own-tunnel) Ramu runs; `ramu tunnel release` gives the Ramu Link slot back |
| `ramu status`, `stop`, `restart` | Check, stop or restart it |
| `ramu up` | Let devices on your private network reach this host, keep it running as a service and pair a device; `--private-network`, `--no-private-network` and `--yes` make it scriptable |
| `ramu pair [--role viewer]` | Print a one-time pairing code and this host's addresses |
| `ramu pair --approve <request>`, `--deny <request>` | Answer a nearby device's request; the server prints each one with its number |
| `ramu devices` | List, revoke and grant permissions to paired devices |
| `ramu hosts add <address> <code>` | Let this host's agents start threads on another host |
| `ramu thread start\|status\|message\|list` | Start and follow threads from a terminal |
| `ramu tools [install\|remove\|dismiss <name>]` | Review plugins, skills and MCP servers your other hosts sent here ([On your other hosts](plugins.md#on-your-other-hosts)) |
| `ramu account login\|status\|logout` | Sign this host in to the optional [Ramu account](account.md) with a code confirmed in any browser |
| `ramu tools sign-in <server>` | Sign this host in to an MCP server that uses OAuth, with the sign-in page opened on any device, such as your phone |
| `ramu browser status\|setup\|stop` | Manage the host's browser |

A bare port (`--listen 7788`) listens on this computer only. Any other address needs HTTPS (`--tls-cert`, `--tls-key`) or `--private-network` for a VPN or LAN you trust. By default the server shares its data folder with the desktop app, so both see the same threads.

### Any network

| Network | How |
| --- | --- |
| Tailscale, NetBird, ZeroTier, WireGuard | Listen on the VPN address, then `ramu pair` |
| LAN | The same, if you trust everyone on it |
| SSH tunnel | Keep the loopback listener and `ssh -L 7788:127.0.0.1:7788 host` |
| Anywhere | [Your own tunnel](#your-own-tunnel), or HTTPS in front, or a certificate for Ramu |

A private network (Tailscale, NetBird, ZeroTier or WireGuard) is the simplest choice: free for personal use, encrypted end to end, and no domain needed. Tailscale offers Funnel. NetBird is open source down to its coordination server, so you can run all of it yourself.

### Ramu Link

Ramu Link gives a host a free `https://ramu-….akalstack.com` address that stays the same and works from any network, with nothing to install but what Ramu runs for you. Choose **Ramu Link** under **Settings → Remote access → From anywhere → Reach from anywhere**, or run `ramu tunnel link` on a headless host. It needs the [Ramu account](account.md) on that host and `cloudflared` (Settings shows how to install it).

- **One computer per account.** A second computer on the same account says which one holds the link; **Give the slot back** there (or `ramu tunnel release`) frees it.
- **While it's on:** the address shows under the choice, with this month's traffic and how many devices are connected through it. Pairing links and the addresses paired devices learn put it first. At home, devices still use the network or VPN address when it answers.
- **Limits:** 5 devices connected through the link at once (devices on your network, VPN or SSH don't count) and 10 GB a month. Past the limit the link pauses until the 1st of the next month; your network, VPN and other tunnels keep working.
- **Unused links are freed.** A link no paired device has reached for 28 days goes to the next computer waiting; Settings shows the date. A restarted host reconnects straight away, and a host that's off keeps its address.
- **It needs `cloudflared`** on the host. When it's missing, Settings says so with the command to install it, and starts the link by itself once it's installed. Ramu finds tools in Homebrew's and your own bin folders as well as the PATH, so one installed while Ramu runs is picked up without a restart. The same goes for `tailscale` and `ngrok`.
- **When it's full,** Settings says so before you save, and saving puts the computer on the waitlist: it switches to Ramu Link on its own when a slot frees. Meanwhile Settings lists what this computer can use instead, best first: Tailscale when installed, [your own relay](#your-own-relay), the quick tunnel when `cloudflared` is here, ngrok when installed, or installing Tailscale. Each has **Use this**. The same happens when the link is paused for traffic or held by another computer.

Ramu's relay only hands out the tunnel. Pairing, device tokens and the host's identity stay on the host, and every call still needs a paired device's token. Cloudflare decrypts the traffic at its edge, as with any tunnel below.

A phone with the **settings** permission can turn Ramu Link on from its first-run setup ([mobile app](../../apps/mobile/README.md#connect-a-phone)).

#### Your own relay

The relay is `apps/link` in this repository. Deploy it to your own free Cloudflare account ([how](../../apps/link/README.md#run-your-own)), then enter its address under **Your own relay** (shown with **Set up** when Ramu Link is full) or run `ramu tunnel link https://your-relay`. Your relay has its own slots, so it never waits for Ramu's.

### Your own tunnel

A tunnel gives the host an `https://` address that works from any network, including devices that are not on your VPN. **Settings → Remote access → From anywhere → Reach from anywhere** (or `ramu tunnel` on a headless host) offers:

| Choice | What Ramu does | You need |
| --- | --- | --- |
| **Quick tunnel (Cloudflare)** | Runs `cloudflared` and uses the `trycloudflare.com` address it gets | `cloudflared` installed; no account. The address changes each time Ramu starts, so it suits trying things out |
| **Tailscale Funnel** | Runs `tailscale funnel` and uses the machine's `.ts.net` address | Tailscale signed in, with Funnel allowed for the machine |
| **ngrok** | Runs `ngrok http`, with your static domain if you give one | An ngrok account (`ngrok config add-authtoken` once) |
| **My own tunnel address** | Uses the address you paste | A tunnel you run, such as a named Cloudflare Tunnel pointed at `http://localhost:7788` |

Choosing a tunnel turns on **Allow other devices**, for this computer only, if it's off. Ramu keeps the tool running while it listens and restarts it if it stops. When the tool is missing, Settings shows how to install it (on a Mac, the Homebrew command). The address appears under the choice once the tunnel is up; pairing links, the addresses paired devices learn and webhook schedules put it first. On a headless host, `ramu tunnel` alone shows its state, and `ramu serve --public-url <https://…>` names a tunnel you run yourself.

Every call through the tunnel still needs a paired device's token, and failed attempts are limited per visitor using the address the tunnel reports. The tunnel's provider decrypts HTTPS at its edge, so it can read what passes through; use a private network when that matters.

### As a service

```ini
[Service]
ExecStart=/usr/bin/node /opt/ramu/apps/server/dist/cli.js serve --listen 127.0.0.1:7788
Restart=on-failure

[Install]
WantedBy=default.target
```

The desktop app installs its own background service with **Settings → Background & updates → Start at login**: a LaunchAgent on macOS, a systemd user service on Linux. **Keep host awake** stops the host suspending from idle while the service runs (`caffeinate` on macOS, a `systemd-inhibit` sleep lock on Linux); **Plugged in only** lets a laptop sleep on battery.

### Keeping hosts up to date

**Settings → Remote access** shows each connected host's Ramu version and provider CLIs, with **Update Ramu** and **Update providers** when something is newer; **Update all hosts** does every host at once, this computer last. The phone's host list has the same actions. Viewer devices see none of this.

- **A host with Ramu's desktop app open** downloads the release and its app installs it, then restarts and reconnects. It installs only signed builds. A build that isn't signed says so and points to the release on GitHub.
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

**Run** on a shell code block in a reply (`bash`, `sh`, `zsh`, `console` and the like) types that command into the thread's workspace shell that is not running anything, or opens a new one in the workspace folder, and shows it: the terminal panel on the desktop, the terminal screen on the phone. A `console` block runs only its lines after a `$ ` prompt, not the output shown between them. It needs the **terminals** permission on a paired device, and a viewer pairing does not get it.
