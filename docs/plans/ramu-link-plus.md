# Ramu Link Plus: a hosted relay that pays for itself

Unfinished. Tracked from the [roadmap](../roadmap.md#implementation).

## The need

Ramu is free and MIT licensed, and stays that way. The hosted Ramu Link service is the one part that costs money every month: Cloudflare bills the relay while a device streams through it. Someone has to pay that bill, and the person maintaining Ramu needs income to keep working on it.

The plan charges only for what costs money to run, and leaves everything else free:

- **Nothing in the app is locked.** Agents, providers, threads, Git, terminals, browser, computer use, schedules, the phone app and direct connections work the same on every plan.
- **Reaching a host from anywhere stays free.** The free plan covers a person with up to 3 machines who checks in from a phone.
- **People who need more pay a small, plain price.** Plus raises the limits and adds the hosted features that store data. It does not require buying an unrelated product.
- **Open-source developers lose nothing.** Self-hosting `apps/link` stays documented and gets every feature with no limit. Maintainers and students can ask for Plus for free.
- **Fewer ways in, each one better.** Cloudflare Tunnel is removed: Ramu Link reaches the host from anywhere with end-to-end encryption and no public address, and direct routes cover the rest.

## Plans

| | **Free** | **Plus** | **Self-hosted Link** |
| --- | --- | --- | --- |
| Price | $0 | $5/month or $48/year | $0 (your own Cloudflare account) |
| Price in Indonesia | Rp0 | Rp49.000/month or Rp449.000/year | Rp0 |
| The whole app, every agent and provider | ✓ | ✓ | ✓ |
| Direct routes: LAN, VPN (Tailscale and others), SSH | ✓ | ✓ | ✓ |
| Pairing, device permissions, revoking devices | ✓ | ✓ | ✓ |
| End-to-end encrypted relay | ✓ | ✓ | ✓ |
| Linked hosts | 3 | 20 | Unlimited |
| Phones and browsers | Unlimited | Unlimited | Unlimited |
| Relayed hours per month | 60 | Unlimited, fair use | Unlimited |
| Phone notifications through the relay (later option in the roadmap) | ✓ | ✓ | ✓ |
| Hold webhooks for 24 hours while a host is offline | | ✓ | ✓ |
| Share a host with another account as a viewer | | ✓ | ✓ |
| Priority replies on GitHub issues, supporter badge | | ✓ | |

- **Relayed hours** count only the time the relay is awake carrying a stream. An idle connected host or device costs nothing and counts nothing. Direct routes never count.
- **Reaching a limit never cuts work off.** At 60 hours a free account's devices keep their direct routes; Link answers with a clear message and **Get Plus**, and the count resets on the first of the month (UTC). At the host limit, linking another host explains how to unlink one or upgrade.
- **A lapsed Plus account keeps its data.** Hosts beyond 3 stay listed but stop accepting relayed streams until the person unlinks some or renews; nothing is deleted.
- **Free Plus** for open-source maintainers and students, granted by hand from a GitHub issue template. No automated verification.
- **Self-hosted** services keep `HOST_LIMIT=0` and no metering; every Plus feature reads its entitlement from the service it runs on, and a self-hosted service grants all of them.

## Costs and margin

Cloudflare Workers Paid ($5/month) includes 1 million Durable Object requests and 400,000 GB-s each month; beyond that, $0.15 per million requests (incoming WebSocket messages count 1 in 20) and $12.50 per million GB-s. Bandwidth is free. Hibernation means an idle host is not billed.

| Use | Cloudflare cost per month |
| --- | --- |
| Idle host, idle devices | ~$0 |
| A free account using all 60 hours | ~$0.37 at most |
| A heavy Plus account, 4 hours a day | ~$0.80 |

Payments through a merchant of record cost about 5% + $0.50 each.

| Sale | Fee | Received | After a heavy account's relay cost |
| --- | --- | --- | --- |
| $5/month | ~$0.75 | ~$4.25 | ~$3.45 (69%) |
| $48/year | ~$2.90 | ~$45.10 | ~$35.50 (74%) |
| Rp49.000/month | ~$0.65 | ~$2.35 | ~$1.55 |
| Rp449.000/year | ~$1.85 | ~$25 | ~$15 |

The yearly plan is shown first everywhere, and first of all in Indonesia, where the fixed fee takes a fifth of a monthly payment. One Plus account covers about 11 free accounts that use all 60 hours. Prices are revisited after three months of measured usage (step 1), not before.

## Payments

Ramu Link stores **what an account has and until when**, never how it paid. Every payment route writes the same entitlement.

1. **At launch: Paddle as merchant of record, for everyone.** Paddle accepts sellers in Indonesia, collects VAT and sales tax in each buyer's country (12% in Indonesia), and allows a per-country price, which sets the rupiah prices. Its webhooks (subscription created, renewed, past due, cancelled, refunded) update the entitlement. Polar is the fallback: it pays out to Indonesia through Stripe Connect Express but needs a regular bank account (not Wise or Payoneer).
2. **When Indonesian sales justify it: QRIS and e-wallets through Midtrans or Xendit.** Most buyers in Indonesia have no credit card. Sell **Ramu Plus 1 tahun** as a one-time Rp449.000 payment rather than a subscription, because QRIS has no reliable automatic renewal; remind the person 14 and 3 days before it ends. On these payments Ramu is the seller, not a merchant of record, so tax reporting is the maintainer's; get an accountant's answer before turning it on.

Before either goes live: confirm the payout currency and bank for the chosen provider, and the maintainer's own income tax.

## Delivery order

1. **Measure.** The relay records relayed seconds and frames per account per day in D1, written when a stream closes or the Durable Object hibernates, never per frame. `GET /api/usage` returns the month so far. Runs on self-hosted services too, where it only informs. Ship and watch for a month before any limit is enforced.
2. **Remove Cloudflare Tunnel.** Delete `apps/server/src/remote/tunnel.ts` and its test, the `ramu tunnel` command and `ramu up --tunnel`, the tunnel section of `ReachThisHost.tsx` and the onboarding step, tunnel addresses in the host's routes, `networkLabel.ts` and `types/remote.ts` entries, and their Indonesian strings. A host that had a tunnel on starts without it and shows once: **Cloudflare Tunnel was removed; turn on Ramu Link to reach this host from anywhere**, with the button that does. Docs keep "put HTTPS in front" for a public name.
3. **Hosted service.** Deploy `apps/link` under a project domain with real Google and GitHub OAuth apps, set `DEFAULT_LINK_SERVICE`, and move **Use my own service** under an advanced disclosure in Remote access. Privacy notice and terms on the service's page. `LINK_HOST_LIMIT` becomes 3 for the free plan.
4. **Entitlements.** An `entitlement` table (account, plan, source, expires at, updated at) written only by payment webhooks and by an admin grant for free Plus. `hostLimit` and the relay read the account's plan instead of one `HOST_LIMIT`; a self-hosted service without payment secrets grants Plus to every account. The 60-hour limit turns on.
5. **Plus in the app.** Settings → Remote access → Ramu Link shows the plan, hosts used (3 of 3), hours used this month, and **Get Plus**, which opens checkout in the browser and refreshes when it returns. The phone shows the same and links out, so store rules about in-app purchases do not apply to it. Account deletion cancels the subscription first.
6. **Paddle checkout and webhooks**, with rupiah prices for Indonesia and the yearly plan first.
7. **Plus features**, each its own item: webhook holding (D1 with a 24-hour expiry, encrypted to the host), host sharing as a viewer.
8. **QRIS** through Midtrans or Xendit, when step 6 shows enough Indonesian buyers.

## Extend, do not duplicate

- `apps/link/src/hosts.ts` (`hostLimit`, `registerHost`) for plan-aware limits; `apps/link/src/relay.ts` for metering, using the hibernation it already has.
- `packages/shared/src/link/protocol.ts` for `DEFAULT_LINK_SERVICE`, the plan names and limits shared by the service and clients.
- `apps/server/src/remote/link/service.ts` and the Ramu Link section of `ReachThisHost.tsx` for plan and usage display; the phone's Ramu Link tab for the same.
- Better Auth's user table for the account; no second account system.

## Acceptance

- A free account with 3 hosts links a fourth: the message names the limit and both ways out. After upgrading, the fourth links without signing in again.
- A free account passes 60 relayed hours: Link streams refuse with the message, the same device still reaches the host over the LAN, and Link works again on the 1st.
- A Plus subscription cancelled in Paddle: hosts beyond 3 stop taking relayed streams at period end, nothing is deleted, and renewing restores them.
- A refund and a failed renewal each update the entitlement within a minute of the webhook.
- A buyer in Indonesia sees Rp449.000/year first at checkout and pays with a local card.
- A self-hosted service with no payment secrets: every account has Plus features, no limits and no **Get Plus**.
- A desktop that had a quick tunnel on updates, sees the one-time notice, turns on Ramu Link from it and pairs a phone.
- A month of measured usage on the hosted service, compared against Cloudflare's bill, within 10%.
- Every new string translated to Indonesian; desktop smoke passes.

## Later options

- A team plan: per-seat price, hosts shared across a team, one bill.
- A relay region closer to the person when measurements show latency matters.
