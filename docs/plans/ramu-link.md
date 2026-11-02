# Ramu Link: reach your hosts from anywhere

Unfinished. Tracked from the [roadmap](../roadmap.md#implementation).

## The need

Someone starts an agent on their desktop, leaves, and wants to answer its question from their phone or a laptop on another network. Today that works only if they set up a VPN (Tailscale, WireGuard), sit on the same LAN, or put HTTPS with a public name in front of the host ([Remote hosts](../guide/remote-hosts.md#any-network)). Most people stop at that step. Every new device also needs a code typed or a number compared at the host, even when it belongs to the same person.

Ramu Link removes that setup:

- **No network setup.** Turn on **Ramu Link** at the host, sign in, and every device signed in to the same account can find it. No router ports, certificates, VPN or public address.
- **No codes to carry.** A new phone signed in with the same Google or GitHub account sees the host and asks to connect; the host shows one approval with the matching six-digit number.
- **One place to choose.** Settings → Remote access shows the three ways in side by side, with the current addresses and what each one protects, instead of command-line flags.
- **Nothing given up.** VPN, LAN and direct HTTPS keep working exactly as today, with no account. The host still enforces device tokens, roles and permissions; an account never grants workspace access by itself.

## Connection modes

Settings → Remote access → **How devices reach this host** (more than one can be on):

| Mode | For | Needs | Protection |
| --- | --- | --- | --- |
| **Private network** | Tailscale, NetBird, ZeroTier, WireGuard, a trusted LAN | Nothing new | The VPN's encryption; plain HTTP only on networks the person marks private |
| **Direct** | A host with a public name | A certificate (`--tls-cert`, `--tls-key`) or **Cloudflare Tunnel** (below) | HTTPS |
| **Ramu Link** | Everyone else | A free Ramu account (Google or GitHub) | Outbound-only relay, end-to-end encrypted between device and host |

Each mode shows its address, whether it is reachable now (checked from the host), and a **Pair a device** action that already knows which address to hand out. The phone and desktop try addresses in order of preference (private network, direct, Link) and fall back without a person choosing.

### Cloudflare Tunnel (Direct, no account with us)

For people who want their own public HTTPS address without opening ports. Ramu runs [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) as a child process pointing at the loopback listener:

- **Quick tunnel:** no Cloudflare account; Ramu starts `cloudflared tunnel --url http://127.0.0.1:<port>` and shows the `trycloudflare.com` address it prints. The address changes on every restart and has no uptime guarantee, so the UI labels it **Temporary** and paired devices re-learn it through Link or a new pairing.
- **Named tunnel:** the person pastes a tunnel token from their Cloudflare dashboard and keeps a stable hostname on their own domain. Optional Cloudflare Access in front stays their choice.

Ramu downloads a pinned `cloudflared` release with a checked hash into its data folder on first use (never a shell string), restarts it with the server, and reports its errors in Diagnostics. The server stays bound to loopback; `cloudflared` provides the TLS, so tokens never cross the network in plain text.

## Ramu Link

### Pieces

1. **Account service** (`apps/link`, new): [Better Auth](https://www.better-auth.com) on Cloudflare Workers with D1. Google and GitHub social sign-in only (no passwords to store or reset). The [device authorization](https://www.better-auth.com/docs/plugins/device-authorization) plugin signs in a headless host (`ramu link login` prints a code and URL). The account holds only: profile name and email, linked hosts (id, name, identity public key, last seen) and linked devices. No workspace data, settings, credentials or transcripts.
2. **Relay** (same Worker): one [Durable Object](https://developers.cloudflare.com/durable-objects/) per host. The host keeps one outbound WebSocket to its object; each device connects to the same object and the object forwards opaque encrypted frames between them. WebSocket hibernation and automatic ping responses keep idle hosts from consuming requests, which keeps a personal host inside Cloudflare's free plan.
3. **Host side** (`apps/server/src/remote/link/`): sign-in state, the outbound relay connection with back-off, the persistent host identity key, and a bridge that hands each relayed device stream to the existing socket handler as if it came from the network listener.
4. **Clients:** `packages/client-runtime` and the phone's `socketTransport.ts` get a Link transport beside the direct one; `RuntimeSocket` runs unchanged on top. Desktop and phone get **Sign in with Google / GitHub** in Remote access and on the phone's pairing screen, and a **Your hosts** list from the account.

### Trust model

- **End-to-end encryption.** Each host gets a persistent X25519 identity key (today only per-request keys exist in `pairingRequests.ts`). A device learns it at pairing and runs a Noise handshake (IK once the key is known, XX for first contact) inside the relay stream. The relay sees connection metadata and frame sizes, not content or bearer tokens.
- **The account finds hosts; the host decides.** Signing in lists your hosts and lets a device send a pairing request through the relay. The host shows it like a nearby request today (dialog, notification, or `ramu pair --approve`), with both screens showing the same six-digit number derived from the Noise handshake, so a compromised relay or account cannot pair silently.
- **Optional auto-approve.** **Approve my account's devices automatically** (off by default, choosing viewer or full access) trusts the Ramu Link service and the identity provider. The setting says so, and works only for devices signed in to the host's own account.
- **Existing rules unchanged.** Device tokens, roles, the viewer allowlist, device permissions, renewal and revocation stay in the host exactly as in [Security](../../SECURITY.md#remote-access). Signing out or unlinking a host closes its relay connection; revoking a device at the host still ends it immediately.
- **Limits.** The relay authenticates the host with a host-scoped token from the device flow and devices with session tokens, rate-limits connection attempts per account and IP, and caps frame size and concurrent devices per host.

### Protocol changes

Link carries one encrypted stream per device. `POST /pair`, `POST /renew` and `GET /session` exist only over HTTP today ([Architecture](../contributing/architecture.md#transport)), so they get socket frames usable before authentication on a Link stream; the direct HTTP endpoints stay. Contracts are versioned in `packages/contracts` and validated with zod on both ends.

## Delivery order

1. **Connection modes and Cloudflare Tunnel.** The Remote access section, reachability checks, address preference in clients, managed `cloudflared` (quick and named). No account. Useful on its own.
2. **Accounts.** `apps/link` with Better Auth, Google and GitHub, device flow, host and device lists, sign-in on desktop, phone and `ramu link login`. Privacy notice and account deletion that removes every linked host and device.
3. **Relay and end-to-end encryption.** Host identity keys, Durable Object relay, Noise handshake, Link transport in clients, pairing through the account.
4. **Docs.** [Remote hosts](../guide/remote-hosts.md) gets the three modes; [Security](../../SECURITY.md#remote-access) replaces "Ramu has no relay and no end-to-end encryption" with the Link trust model; the roadmap's relay and preference-sync decisions are updated.

## Extend, do not duplicate

- `remote/network.ts` (listener and the private-network rule), `remote/pairingRequests.ts` (X25519 commit-reveal and six-digit number), `remote/devices.ts` and `remote/access.ts` (tokens, roles, permissions), `remote/discovery.ts` (nearby hosts: the account list joins it in the same picker).
- `credentials/store.ts` for the account session, host link token and host identity private key; never plain files.
- `RuntimeSocket`, `hostSocket.ts` and the phone's `socketTransport.ts` for the client side; Link is another way to open the same socket.
- The existing pairing-request dialog and notification for account-based requests.

## Acceptance

- A person with a desktop host and a phone on mobile data, no VPN: turn on Ramu Link, sign in with GitHub on both, approve one request at the host, and answer an agent's question from the phone. Count the steps against setting up Tailscale today.
- A headless Linux host: `ramu link login` from SSH, then pair a phone through the account.
- Quick tunnel on a Mac, pair a phone over its HTTPS address; restart the host and see the phone recover.
- A modified relay that rewrites frames or offers its own key: the handshake fails or the six-digit numbers differ, and nothing pairs.
- Revoke the device at the host while it is connected through Link: the stream closes at once. Sign out of the account at the host: every Link stream closes and direct connections keep working.
- The host and phone keep drafts and queued messages across a relay restart, a host sleep and a switch from Wi-Fi to mobile data, using the connection outcomes in the roadmap's Transport item.
- One host with two devices idle for a day stays within the Workers free plan; record the measured requests and Durable Object usage.
- Every new string translated to Indonesian; desktop smoke passes; the phone checks are added to `apps/mobile/VERIFICATION.md`.

## Later options

- Push wake-ups through the relay so a phone without a direct path still gets notifications (design with the existing direct-host push).
- Sharing a host with another account as a viewer.
- Self-hosting the Link Worker on your own Cloudflare account, with the URL set in Settings.
- Passkeys as a third sign-in method.
