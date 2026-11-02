# Ramu Link service

Google and GitHub sign-in, the list of hosts each account links, and the relay that joins a device's stream to its host. It runs on Cloudflare Workers with D1 and one Durable Object per host, all within the Workers free plan for personal use.

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

4. `pnpm --filter @ramu/link deploy`, then point Ramu at it: Settings → Remote access → Ramu Link → Service, or `RAMU_LINK_URL=https://<your-domain>` for a headless host.

`HOST_LIMIT` in `wrangler.jsonc` caps hosts per account (5 by default); set it to `0` for no limit.

## Local development

```sh
pnpm --filter @ramu/link exec wrangler d1 migrations apply ramu-link --local
printf 'BETTER_AUTH_URL=http://localhost:8787\nBETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long\n' > apps/link/.dev.vars
pnpm --filter @ramu/link dev
```

Then set the service to `http://localhost:8787` on this computer; plain HTTP is accepted only for `localhost`.
