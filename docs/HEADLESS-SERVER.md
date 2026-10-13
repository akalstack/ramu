# Headless server

The workspace server (`apps/server`) is the background service that owns agents, terminals, schedules, Git and the database. It runs without Electron, so a computer can host Ramu with no window open, and the desktop app is one of its clients.

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
| `ramu stop` / `ramu restart` | Stop (chats are not resumed) or restart (unfinished chats resume). |
| `ramu token [--rotate]` | Print the access token; `--rotate` revokes every paired client immediately. |

Options: `--data-dir`, `--listen [host:]port`, `--worktrees`, `--allow-plaintext-remote`. Environment equivalents: `RAMU_USER_DATA`, `RAMU_LISTEN`, `RAMU_WORKTREES`, `RAMU_ALLOW_PLAINTEXT_REMOTE`, `RAMU_SOCKET`, `RAMU_TOKEN_FILE`.

The default data directory is the desktop app's (`~/Library/Application Support/Ramu`, `~/.config/Ramu`, `%APPDATA%\Ramu`), so the headless server and the desktop app share chats, settings and the database. Only one server runs per data directory. If the desktop app starts and finds a running server, it attaches to it instead of starting another.

## Local and remote access

- **Local socket** (always on): a unix socket with mode `0600`. The desktop app uses it, and only socket clients can answer native dialogs such as the folder picker.
- **Network** (opt-in with `--listen`): HTTP with a bearer token stored in `<data-dir>/remote-token` (mode `0600`). Repeated bad tokens from one address are rate limited. `GET /health` needs no token.

A bare port such as `--listen 7788` binds `127.0.0.1` only. Binding any other address is refused unless you pass `--allow-plaintext-remote`, because the connection is not encrypted. Reach a loopback listener from another machine through SSH (`ssh -L 7788:127.0.0.1:7788 host`), Tailscale, or a TLS-terminating proxy.

**Anyone with the token can do what the desktop app can do, including running terminal commands and agents with your provider credentials.** Treat it like an SSH key.

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

The desktop app does not yet pick a remote server in its UI, there is no device pairing or per-device revocation (one shared token), and there is no end-to-end encryption or relay. Those would build on this server and protocol.
