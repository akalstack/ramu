# Ramu Link service

Google and GitHub sign-in, the list of hosts each account links, the relay that joins a device's stream to its host, and each account's plan. It runs on Cloudflare Workers with D1 and one Durable Object per host, all within the Workers free plan for personal use.

The relay forwards sealed frames only: every stream is end-to-end encrypted between the device and the host (`packages/shared/src/link`). See [Security](../../SECURITY.md#remote-access) for the trust model and [Remote hosts](../../docs/guide/remote-hosts.md#ramu-link) for using it.

## Deploy

1. Create the database and put its id in `wrangler.jsonc`:

   ```sh
   pnpm --filter @ramu/link exec wrangler d1 create ramu-link
   pnpm --filter @ramu/link exec wrangler d1 migrations apply ramu-link --remote
   ```

2. Create OAuth apps. The callback URLs are `https://<your-domain>/api/auth/callback/google` and `https://<your-domain>/api/auth/callback/github`. Offering only one provider is fine.

3. Set the secrets:

   ```sh
   cd apps/link
   pnpm exec wrangler secret put BETTER_AUTH_URL       # https://<your-domain>
   pnpm exec wrangler secret put BETTER_AUTH_SECRET    # openssl rand -base64 32
   pnpm exec wrangler secret put GITHUB_CLIENT_ID
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. `pnpm --filter @ramu/link deploy`, then point Ramu at it: Settings → Remote access → Ramu Link → **Use my own service**, or `RAMU_LINK_URL=https://<your-domain>` for a headless host.

A service set up this way sells nothing: every account has every Plus feature, relayed time is measured but never limited, and `HOST_LIMIT` in `wrangler.jsonc` caps hosts per account (`0`, the default, for no limit). The privacy notice and terms are at `/privacy` and `/terms`; they describe the hosted service, so edit `src/page.ts` if yours differs.

## Plans and usage

The relay counts relayed time for each host's owner: the seconds the relay is awake carrying a stream, and the frames it carried, per UTC day in the `usage` table. Counts are written a few seconds after traffic starts and when a stream closes, never per frame. `GET /v1/usage` returns the month so far for the signed-in account; `GET /v1/me` includes the plan, hosts used and hours used.

When the service sells Plus, an account without Plus is on Free: 3 hosts and 60 relayed hours a month (UTC). Plus allows 20 hosts and unlimited relayed hours, and sharing a host with another account. Limits never cut off an open stream: past 60 hours, new streams are refused with close code 4402 until the 1st; hosts beyond the plan's limit (the most recently linked) stay listed and refuse new streams. The limits are in `LINK_PLANS` in `packages/shared/src/link/protocol.ts`.

## Selling Plus with Paddle

Paddle is the merchant of record: it charges, collects tax in the buyer's country and pays out. The service stores only what an account has and until when (the `entitlement` table), written by Paddle's webhooks.

1. In Paddle, create a product with a yearly and a monthly price ($48/year and $5/month), each with a price override for Indonesia (Rp869.000 and Rp89.000).
2. Set the default payment link to `https://<your-domain>/checkout` and approve that domain.
3. Add a notification destination for `https://<your-domain>/v1/paddle/webhook` with the `subscription.*` and `adjustment.*` events.
4. Set the secrets; Plus goes on sale, and the limits apply, only once all five are set:

   ```sh
   pnpm exec wrangler secret put PADDLE_API_KEY
   pnpm exec wrangler secret put PADDLE_WEBHOOK_SECRET   # the destination's secret key
   pnpm exec wrangler secret put PADDLE_CLIENT_TOKEN     # a client-side token, for the checkout page
   pnpm exec wrangler secret put PADDLE_PRICE_YEAR       # pri_…
   pnpm exec wrangler secret put PADDLE_PRICE_MONTH      # pri_…
   ```

Set `PADDLE_ENV` to `sandbox` in `wrangler.jsonc` to try it against Paddle's sandbox first.

**Get Plus** in Ramu calls `POST /v1/checkout`, which creates a Paddle transaction tagged with the account and opens it on `/checkout`. Webhooks then keep the entitlement current: an active subscription gives Plus until its period ends (plus a day of grace for a late renewal), a scheduled cancellation keeps Plus until it takes effect, and a failed renewal, pause, cancellation or approved refund ends it. Deleting an account cancels its subscription first, and keeps the account if Paddle cannot be reached.

## Local development

```sh
pnpm --filter @ramu/link exec wrangler d1 migrations apply ramu-link --local
printf 'BETTER_AUTH_URL=http://localhost:8787\nBETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long\n' > apps/link/.dev.vars
pnpm --filter @ramu/link dev
```

Then set the service to `http://localhost:8787` on this computer; plain HTTP is accepted only for `localhost`.

## License

[AGPL-3.0](LICENSE). You can run, change and host your own copy; if you offer a modified copy as a service, make its source available to the people who use it. The rest of Ramu is [MIT](../../LICENSE).
