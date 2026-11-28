# Remote hosts

A **host** is a computer that runs Ramu's workspace server: your agents, terminals, Git and history live there. The desktop app runs one for you. Another computer, a server or your phone can connect to it, and one desktop can connect to many hosts. Read [Security](../security-model.md#remote-access) before opening a host to the network.

## Connect a phone

Select the phone button at the foot of the sidebar (or **Connect a phone** in the command palette, or the **Your phone** step of a new host's setup). The window shows a large QR code with the one-time pairing code and when a new one replaces it. Scan the QR code with the phone's own camera: it opens Ramu with the code filled in, or the App Store or Google Play first, and then Ramu. Beside the code, **Full access** or **View only** picks what the device may do (view only reads threads and answers requests). **Copy link** and **Copy code** copy the pairing link to send to your phone and the code to type. With **Discoverable on this network** on, the window also says you can pick this host under **Nearby hosts** on the phone. If other devices can't reach this host yet, **Allow devices on this network** does it in one step. Ramu doesn't encrypt that connection, so use it on a network or VPN you trust. The code works once and a new one replaces it every 10 minutes while it's on screen. The window says which device paired as soon as it does. The link behind the code goes to getramu.dev with the host's address and code after `#`, which a browser never sends to the site.

To connect from anywhere instead, sign in to the same [Ramu account](account.md#your-hosts) on both devices.

## From the desktop app

**Settings → Devices & access** is one page, in the order you set a host up. **Reachable from** and **Devices on your Ramu account** show when Settings is on the host this window runs on; on another host they are set on that host. **Connect a device** and **Devices** show for another host too when this computer may [manage its devices](#manage-devices-from-another-device).

**Reachable from** is one choice:

- **This computer:** only this computer uses the host. Paired devices can't connect.
- **This network:** phones and computers on your network or VPN connect once paired. Ramu doesn't encrypt that connection, so it asks first, and you should use it on a network or VPN you trust.
- **Anywhere:** the same, plus [Ramu Link](#ramu-link), so paired devices connect from any network. Ramu Link needs the [Ramu account](account.md) on this host. When it is signed out, full, paused or missing `cloudflared`, the line under the choice says why, with **Sign in**, the install command or the other ways to reach the host.

Choosing **This network** or **Anywhere** also turns on **Stay reachable after a restart** (the background service starts at login and keeps running when Ramu closes) and **Keep host awake**, so your devices reach the host after a restart. **Advanced** under the choice holds the rest, already set for it: **Network** (all networks, or one such as your VPN), **Discoverable on this network**, **Port**, **Reach from anywhere** with the other [tunnels](#your-own-tunnel) (quick tunnel, Tailscale Funnel, ngrok, your own tunnel address, [your own relay](#your-own-relay)), and the **Stay reachable after a restart** and **Keep host awake** switches to turn either off again. A host started with `--listen` shows the choice it was started with and can't change it here.

**Connect a device…** opens the same window as the phone button. One line names the address the code carries and its network ("Phones reach this host through Ramu Link"). **Change** lists this host's other addresses, each named by its network or tunnel, to choose for the QR code or copy; Docker, VM and other virtual networks wait behind **Show more**. When the code carries another address and the host runs a tunnel, the tunnel's https address rides along as a backup: a phone or computer that can't reach the first address (a local one scanned away from home) pairs through the tunnel instead. Only a tunnel's https address is added, since the code is sent to each address tried and only a certificate proves an address is this host's. With **Discoverable on this network** on, a nearby device can also ask without a code. Ramu asks you to allow it (in the app, or as a notification when it's in the background or closed). Allow it only when both screens show the same six-digit number.

**Devices** lists the phones and computers paired with this host, each with what it runs on (an iPhone, an Android tablet, a Mac, an Ubuntu server…) once it has connected, its access and when it was last seen. **Remove others** removes every one of them at once; this computer and linked hosts keep working. Opening a device shows when it was paired and when it expires, **Rename…** (with **Use "…"** to go back to the name it paired with) and **Remove**. A full-access device can do everything here except start threads for another computer's agents, and one that was cut back shows **Limited** beside its name. **Limit this device…** under it holds what few people change:

- Its permissions: computer use, the browser, terminals, settings changes and agents. Agents is offered only to computers: a phone or tablet connects to hosts and runs no agents of its own. Each is **Allowed**, **Ask first** (the device can request it) or **Blocked** (its requests are declined without asking). A view-only device has none.
- **Keep paired:** how long that one device stays paired without use, or the same as the others.

**Changes from other devices** under the list names what a phone or computer changed here lately ("Ahmad’s iPhone removed MacBook Air", "… connected a new device: Pixel 9") and when.

When a device asks for a permission it lacks, the request shows at the top of **Devices** and opens in Ramu on this host (or as a system notification when Ramu is in the background) with **Allow this time** (until that device disconnects), **Allow for 1 hour**, **Always allow**, **Deny** and **Don’t ask again**. A request allowed for a while shows as **Allowed until** its end, until you set a lasting state. Closing the request leaves it waiting here until it lapses, and the asking device, desktop or phone, shows the answer as soon as you give it. **Advanced** under the list sets how long devices stay paired without use. A host that chose its own set of permissions for new devices keeps it there (**New devices: …**); every other host pairs new devices with full access.

### Set up another host from your device

A phone or computer with **full access** and the host's **settings changes** permission sets up that host's providers and connections without walking to it: API keys and environment variables, media keys, shared MCP servers and their sign-ins, plugins, Git hosting accounts, the host's browser and its profiles, and computer use. These carry sign-ins and keys, so the connection must also be encrypted: HTTPS, Ramu Link or another tunnel, or Tailscale. A host reached over plain HTTP, even on a network you trust, refuses them and says why. A key sent is stored on the host and never shown again.

A few steps stay on the host because they need someone at it: installing computer use and turning on work through a locked screen (macOS asks for the administrator password there), and importing another browser's profiles (the system asks for its keychain).

### Manage devices from another device

A phone or computer with **full access** and the host's **settings changes** permission manages that host's devices without walking to it: on the desktop, **Settings → Devices & access** with another host selected; on the phone, **Settings → Paired computers → Devices**. It lists the devices with their access and when each was last seen, renames and removes one, removes the others (every paired phone and computer but itself; linked hosts and the host's own desktop keep working), shows a code to connect a new device with **Full access** or **View only**, and answers nearby devices asking to pair. Removing itself disconnects it; it must pair again to come back. Each device's permissions, how long devices stay paired and how the host is reached stay on the host.

Without the permission, the page says so with **Request access**; a host set to **Ask first** gets the request like any other. A view-only device can't manage devices. Every change shows on the host as a notification and under **Changes from other devices**, and a headless host prints it.

**Devices on your Ramu account** decides whether your phone and computers signed in to this host's [Ramu account](account.md#your-hosts) connect without a code. **Connect devices on my Ramu account** lets them in with full access; **Ask me first** has you allow each here, matching the six-digit number, and choose its access. With **Ask me first** off, **Connect them view-only** under **Advanced** connects them view-only instead. Turned off, they pair with a code like any device.

**Linked hosts** lists the hosts whose agents work together. **Agents here can start threads on** each connected host asks that host for its **Agents** permission and links them once it is granted; **Agents on all hosts** does it for every connected host. Hosts added with `ramu hosts add` are listed with **Forget**. On this host, **Hosts whose agents start threads here** lists each other host's agents with **Most access for its threads**, and **Remove** (or **Turn off** for a paired computer granted **Agents**).

**Hosts you use** lists every host this computer works on. Devices signed in to the same [Ramu account](account.md#your-hosts) find your listed hosts without a code, as each host allows; a listed host this computer doesn't use yet shows under **On your Ramu account** with **Connect** or **Add this host**. **Add a host** offers hosts nearby first, then one field that takes a pairing link, an address and code, or an SSH host (`user@host` or a name from `~/.ssh/config`). Each host shows its status and route, **Open**, and under ⋯ **Rename…**, **Connection settings…**, **Pause connection** and **Forget…**. **Rename…** names another host on this computer only, with **Use "…"** to go back to the name the host gives itself. This computer's own ⋯ has **Rename this host…**, the name every phone and computer that pairs with it, finds it nearby or sees it on your Ramu account shows (by default the computer's own name, which on a cloud machine can be a long internal address); **Use "…"** goes back to that. A paused host shows **Resume**. A host's row names any permission this computer lacks there with one **Request** for all of it; **Connection settings…** lists each permission. On the phone, **Settings → Paired computers** shows the same for the selected host, and its **Names** renames a host on that phone and the phone as the host lists it, each with a way back.

To work both ways, choose **Let {host} connect here…** under a connected host's ⋯. Ramu makes a code on this computer and asks on that host. Once its owner taps **Connect**, each computer can open the other, and this one lists it under **Devices**. Nobody types a code, and nothing connects until that owner accepts.

To have agents use another computer's screen, add that computer as a host and run the thread there; each host's agents use only its own screen.

With a second host, a switcher appears at the top of the sidebar. Each host keeps its own threads, browser and settings, and notifications open the right host. With **All hosts** chosen there, a repository checked out on two or more hosts shows once under **On several hosts**, matched by its remote: each of its threads names its host, and opening the project or starting a thread goes to the host worked on last. **A project on several hosts → Separate by host** in the switcher keeps it under each host instead; this computer remembers the choice. A host that is away (offline, still connecting or paused) still opens from what this computer last read of it: its projects and threads are listed, and its recent threads show their last turns. You can keep working there, and so can the desktop for its own host while that host's service restarts:

- **A message in a thread** waits on this device under the thread's queue with **Sends when … is back**. **Edit** puts it back in the message box and **Remove** drops it. Messages go in the order you wrote them, and always as queued messages, so a late arrival never steers a running turn. Review comments need the host, so a message carrying them waits in the box instead.
- **A message that failed to send** while the host was reachable stays in its thread with **Retry**, **Edit** and **Remove**, and is still there after you close the thread or restart the app.
- **A new thread** (from Home or a project's New thread) waits too, listed at the top of that host's threads in the sidebar with **Starts when … is back**, and in New thread on that host as its first message, with **Edit** and **Remove**. Its row menu also offers **Start on … instead** for another connected host. When the project was Auto, the host picks it once it is back. Attachments and creating a project need the host.
- **Once the host is back** waiting threads start one at a time, oldest first, each announced with **Open**, and waiting messages follow in order. A send that fails shows why, with **Retry**. One cut off by closing the app is marked failed rather than sent again, because the host may already have it. What waits is kept on this device, so it survives quitting Ramu and is sent the next time the host is reachable, without opening the thread.

A host that just came back reads **Syncing…** in the switcher (**Syncing** on the phone's host list) until this device has read again what changed while it was away, then **Connected**.

When it is back, the thread on screen says **Syncing messages…** at its end, on the desktop and the phone, until the host has caught it up; a quick catch-up shows nothing, and opening or switching threads reads quietly. A host that refused this computer does not open. **Apply settings to** in Settings edits one host or all of them. Beside each setting, the layers icon (shown on hover) lists its value on every selected host and whether that is the default. A setting whose hosts disagree says **Mixed** and offers to use one host's value everywhere; one a host does not know says **Not on** that host, because it runs an older Ramu, and offers **Restart service** when that host is this computer's background service.

A device pairs once and keeps one token, role and set of permissions on every route. It learns the host's other addresses (its tunnel address, VPN, LAN) and tries them when the saved one stops answering; each must prove it is the same host first.

## Headless server

With Node.js 26, run it straight from npm:

```sh
npx --allow-scripts=node-pty,esbuild @akalstack/ramu serve --listen 0.0.0.0:7788 --private-network
npx @akalstack/ramu pair
```

To keep it running as a service, install it first, since npx's cache can be cleared at any time: `npm install --global --allow-scripts=node-pty,esbuild @akalstack/ramu`, then `ramu up`. `--allow-scripts` lets those two packages finish installing on npm versions that hold install scripts back; on Linux, `node-pty` compiles there, so it also needs Python 3, `make` and a C++ compiler (`build-essential` on Debian and Ubuntu). Each published release reaches npm with the same version. To update, run the same install with `@latest`.

From a checkout instead:

```sh
pnpm build
pnpm server serve --listen 0.0.0.0:7788 --private-network
ramu pair
```

On a computer with the desktop app, you don't need a checkout for these commands: **Install** next to **Terminal command** in **Settings → Background**, or on the last setup step, puts `ramu` in `~/.local/bin` and adds that folder to your shell's PATH (zsh, bash or fish) when it isn't there yet. The command runs the CLI inside the app with the app's own runtime, so it needs no Node.js and always matches the app and its background service. `ramu up` from it relies on the app's service instead of installing another. It follows the app when you move it, and **Remove** deletes only a `ramu` that Ramu wrote. An AppImage, or a Mac app opened straight from Downloads, can't offer it because its path changes each launch.

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

Ramu Link gives a host a free `https://ramu-….akalstack.com` address that stays the same and works from any network, with nothing to install but what Ramu runs for you. Choose **Anywhere** under **Settings → Devices & access → Reachable from**, or run `ramu tunnel link` on a headless host. It needs the [Ramu account](account.md) on that host and `cloudflared` (Settings shows how to install it).

- **Three computers per account,** each with its own address. Your phones and other devices that connect don't count. A fourth computer lists the three that hold one, each with **Give back and use here**: that computer keeps working on your network and VPN, and this one takes the link. **Give the slot back** on a computer (or `ramu tunnel release`) frees its own.
- **While it's on:** the address shows under the choice, with this month's traffic and how many devices are connected through it. Pairing links and the addresses paired devices learn put it first. At home, devices still use the network or VPN address when it answers.
- **Limits:** 10 GB a month per link; any number of devices may connect through it. Past the limit the link pauses until the 1st of the next month; your network, VPN and other tunnels keep working.
- **Unused links are freed.** A link no paired device has reached for 28 days is released; Settings shows the date. A restarted host reconnects straight away, and a host that's off keeps its address. Ramu Link's room counts computers online at once, so a host that's off takes none; one that comes back while it's full waits in line like a new one, under the same address.
- **It needs `cloudflared`** on the host. When it's missing, Settings says so with the command to install it, and starts the link by itself once it's installed. Ramu finds tools in Homebrew's and your own bin folders as well as the PATH, so one installed while Ramu runs is picked up without a restart. The same goes for `tailscale` and `ngrok`.
- **When it's full,** Settings says so before you save, and saving puts the computer on the waitlist: it switches to Ramu Link on its own once room frees. Meanwhile Settings lists what this computer can use instead, best first: Tailscale when installed, [your own relay](#your-own-relay), the quick tunnel when `cloudflared` is here, ngrok when installed, or installing Tailscale. Each has **Use this**. The same happens when the link is paused for traffic or held by another computer.

Ramu's relay only hands out the tunnel. Pairing, device tokens and the host's identity stay on the host, and every call still needs a paired device's token. Cloudflare decrypts the traffic at its edge, as with any tunnel below.

A phone with the **settings** permission can turn Ramu Link on from its first-run setup ([mobile app](../../apps/mobile/README.md#connect-a-phone)).

#### Your own relay

The relay is `apps/link` in this repository. Deploy it to your own free Cloudflare account ([how](../../apps/link/README.md#run-your-own)), then enter its address under **Your own relay** (shown with **Set up** when Ramu Link is full) or run `ramu tunnel link https://your-relay`. Your relay has its own slots, so it never waits for Ramu's.

### Your own tunnel

A tunnel gives the host an `https://` address that works from any network, including devices that are not on your VPN. **Reach from anywhere** under **Settings → Devices & access → Reachable from → Advanced** (or `ramu tunnel` on a headless host) offers:

| Choice | What Ramu does | You need |
| --- | --- | --- |
| **Quick tunnel (Cloudflare)** | Runs `cloudflared` and uses the `trycloudflare.com` address it gets | `cloudflared` installed; no account. The address changes each time Ramu starts, so it suits trying things out |
| **Tailscale Funnel** | Runs `tailscale funnel` and uses the machine's `.ts.net` address | Tailscale signed in, with Funnel allowed for the machine |
| **ngrok** | Runs `ngrok http`, with your static domain if you give one | An ngrok account (`ngrok config add-authtoken` once) |
| **My own tunnel address** | Uses the address you paste | A tunnel you run, such as a named Cloudflare Tunnel pointed at `http://localhost:7788` |

Choosing a tunnel while the host is reachable from **This computer** opens it to the tunnel only, not your network. Ramu keeps the tool running while it listens and restarts it if it stops. When the tool is missing, Settings shows how to install it (on a Mac, the Homebrew command). The address appears under the choice once the tunnel is up; pairing links, the addresses paired devices learn and webhook schedules put it first. On a headless host, `ramu tunnel` alone shows its state, and `ramu serve --public-url <https://…>` names a tunnel you run yourself.

Every call through the tunnel still needs a paired device's token, and failed attempts are limited per visitor using the address the tunnel reports. The tunnel's provider decrypts HTTPS at its edge, so it can read what passes through; use a private network when that matters.

### As a service

```ini
[Service]
ExecStart=/usr/bin/node /opt/ramu/apps/server/dist/cli.js serve --listen 127.0.0.1:7788
Restart=on-failure

[Install]
WantedBy=default.target
```

The desktop app installs its own background service with **Settings → Background → Start at login**: a LaunchAgent on macOS, a systemd user service on Linux. It is off until you choose it; choosing **This network** or **Anywhere** in **Devices & access** turns it on as **Stay reachable after a restart**, together with **Keep host awake** while plugged in. **Keep host awake** stops the host suspending from idle while the service runs (`caffeinate` on macOS, a `systemd-inhibit` sleep lock on Linux); **Plugged in, or while agents work** keeps a laptop awake on battery only while agents work, and a minute after (so a queue of runs is not cut by sleep), and lets it sleep otherwise; **Always** keeps it awake on battery too. The display still dims and turns off as usual. **Restart service** in the same place restarts it and reconnects the window as soon as it is back; `ramu stop` stops it.

### Keeping hosts up to date

**Hosts you use** in **Settings → Devices & access** shows each connected host's Ramu version and provider CLIs, with **Update Ramu** and **Update providers** when something is newer; **Update all hosts** does every host at once, this computer last. The phone's host list has the same actions. Viewer devices see none of this.

- **A host with Ramu's desktop app open** downloads the release and its app installs it, then restarts and reconnects. It installs only signed builds. A build that isn't signed says so and points to the release on GitHub.
- **A host installed from npm** says which `npm install --global` command brings it the release; run it there and restart the service.
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

In the phone's thread list, **All hosts** shows one project group for a repository checked out on several hosts, matched by its remote. Each thread in it names its host, and the group's menu and **New thread** act on the host you last worked on there. A project without a remote stays under its own host. **A project on several hosts → Separate by host**, in the host picker, keeps one group per host instead; the phone remembers the choice.

Terminals live on the host, so every device shows the same shells: what you type on one appears on the other. A terminal opened on the phone does not open a tab on the desktop by itself; the desktop's Terminal button gets a dot, and the shell joins the panel the next time you open it (straight away if the panel is already open).

**Run** on a shell code block in a reply (`bash`, `sh`, `zsh`, `console` and the like) types that command into the thread's workspace shell that is not running anything, or opens a new one in the workspace folder, and shows it: the terminal panel on the desktop, the terminal screen on the phone. A `console` block runs only its lines after a `$ ` prompt, not the output shown between them. It needs the **terminals** permission on a paired device, and a viewer pairing does not get it.
