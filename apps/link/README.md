# Ramu Link relay

The Worker behind `ramu-link.akalstack.com`. It gives a signed-in Ramu host a free `https://ramu-<slug>.akalstack.com` address by
creating a remotely managed Cloudflare Tunnel that reaches only that host's loopback listener. The relay hands out
tunnels and nothing else: pairing, device tokens and host-identity checks stay on the host, and the host's traffic goes
through its tunnel, never through this Worker.

## How it works

- **One slot per account.** A Ramu account session (checked with the account service, cached for five minutes by its
  hash) gets one slot for one host. A second host on the same account is told which host holds it.
- **Tunnels and DNS records exist only while hosts are online.** Cloudflare allows 1,000 tunnels per account, idle
  ones included, so a host's tunnel and its CNAME are deleted on a clean shutdown or after 10 minutes down, and made
  again under the same address when the host returns.
- **Capacity counts hosts online at once.** An account keeps its address while its host is off, and that takes no room,
  so the relay holds far more addresses than its capacity of hosts online.
- **A waitlist when full.** When the relay already has as many hosts online as its capacity, a host waits its turn,
  first come, first served, whether it is new or coming back under its address, and comes online when it asks again
  after room frees. A host offered room that does not come back within a day loses its place.
- **Idle addresses are released.** A host reports when a paired device reaches it through the link. With no such use
  for 21 days the slot is marked warned, and on day 28 it is released.
- **Monthly traffic.** Once a day the relay adds each address's traffic from Cloudflare's analytics and suspends a link
  over 10 GB until the first of the next month (UTC). If the analytics are unavailable the count is skipped.
- **A five-minute sweep** (a Cron Trigger) reads every tunnel's status in one list call, so hosts send no heartbeats. It
  only touches tunnels named `ramu-link-…`, and each run is bounded in pages, deletions and time.

Limits shared with the apps are in [`packages/shared/src/ramuLink.ts`](../../packages/shared/src/ramuLink.ts).

## API

All bodies are JSON of at most 4 KB. Host requests carry `Authorization: Bearer <Ramu account session>`.

| Request | Answer |
| --- | --- |
| `GET /v1/pool` | `{ capacity, used, waiting }`, where `used` is hosts online; cached for a minute |
| `POST /v1/links` with `{ hostId, name, port, https }` | `active` (200) with `hostname`, `token`, `releasesAt` and `usage`; `waitlisted` (200) with `position`; `taken` (409); `suspended` (403) with `until`; `unavailable` (400, 401, 429 or 503) with a `reason` |
| `DELETE /v1/links/:hostId/online` | 204: the tunnel and its DNS record are deleted, the slot and address kept |
| `DELETE /v1/links/:hostId` | 204: the slot is released, or the host leaves the waitlist |
| `POST /v1/links/:hostId/seen` | 204: a paired device used the link; counted at most once an hour |

`POST /v1/links` is safe to repeat: it makes the tunnel and DNS record only when missing, and updates the tunnel's
ingress when the host's port changes.

## Run your own

The same Worker runs on a free Cloudflare account, so a host can use Ramu Link without taking a slot on Ramu's relay.

1. Add a domain to your Cloudflare account. Hosts get `ramu-<slug>.<your domain>`.
2. Create an API token with **Account → Cloudflare Tunnel → Edit** and **Zone → DNS → Edit** plus **Zone → Analytics → Read** for that zone.
3. In `wrangler.jsonc`, set `ZONE` to your domain and replace the `routes` entry with your own hostname for the relay
   (or remove it, set `workers_dev` to `true` and use the `workers.dev` address). Lower `CAPACITY` if you want fewer slots.
4. Set the secrets and deploy:

   ```sh
   npx wrangler secret put CF_API_TOKEN
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_ZONE_ID
   pnpm --filter @ramu/link run deploy
   ```

5. On a host: `ramu tunnel link --relay https://<your relay address>`.

Your relay still checks sessions with the Ramu account service, so hosts using it sign in to a Ramu account as usual.

## Develop

```sh
pnpm --filter @ramu/link test
pnpm --filter @ramu/link typecheck
```
