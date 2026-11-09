# Ramu account and encrypted settings backup

## The need

A person who sets Ramu up on a new machine, or reinstalls, starts from defaults and rebuilds theme, models, abilities, rules, commit style, notifications and identities from memory. Copying from a paired host ([Identities and moving settings](identities-and-settings.md)) helps only while the old host is still there and reachable. The person needs their settings to survive a lost or wiped machine, with nothing to set up beyond signing in, and without handing their configuration to anyone, Ramu included.

A Ramu account is also where cloud Ramu hosts will attach later, so it is designed for that from the start, but it ships with one feature that is useful on day one: settings backup that only the person's own devices can read.

## Principles

- **Optional.** Everything that works without an account keeps working. Ramu never asks for sign-in at first launch or as a gate; it offers it where it helps (**Back up settings**, and **Restore your settings?** in a new host's setup).
- **An account is not access.** Signing in never pairs a device or grants anything on a host. Host pairing, device tokens, roles and permissions stay the only way in ([Security](../../SECURITY.md#remote-access)).
- **The service cannot read backups.** Settings are encrypted on the host before upload. The service stores ciphertext, its size and its time.
- **Credentials never leave the host,** encrypted or not. A backup carries the portable settings export only.
- **Free to run.** The service must fit free hosting and database plans whose terms allow a company's product (Vercel's Hobby plan does not), which bounds sizes, versions and request rates below.
- **Portable.** The service is a web-standard HTTP app on plain Postgres. Moving its host or its database is a configuration change, not a migration project.

## Delivery

### 1. Account service

`apps/account`, a new package: [Better Auth](https://www.better-auth.com) in a small [Hono](https://hono.dev) app, served at `account.akalstack.com`, under the company's domain so the same account can later sign in to other Akalstack apps. The getramu.dev site stays marketing only. People sign in to the product they know, so Google's consent screen and the GitHub app are named Ramu with Akalstack as their publisher, and the sign-in page reads **Ramu** with "by Akalstack" beside the address; the privacy notice and terms are on akalstack.com, which Google's brand verification checks. Passkeys use `akalstack.com` as their relying party, so they keep working if the service later splits across subdomains. In Ramu the button reads **Sign in**, and **Settings → Account** says the account is run by Akalstack.

- **Sign-in:** **Continue with GitHub**, **Continue with Google**, then a passkey. No passwords to store or reset. Every client signs in with Better Auth's device authorization flow: the app shows a short code and opens the sign-in page in the system browser, the person signs in and confirms the code, and the client continues on its own. No embedded web view (Google refuses them), no callback port, no app URL scheme, so it works the same on the desktop, on a phone, and from `ramu account login` over SSH.
- **What the account holds:** name, email and avatar from the identity provider; linked sign-ins; sessions per device, each revocable; backup slots (below). Identity providers' access tokens are not kept after sign-in.
- **Deletion:** **Delete account** removes every row for the person at once, including backups.

**Database: any Postgres.** The service reads one `DATABASE_URL` and talks to it with a standard Postgres driver (`pg`) through Better Auth's built-in Kysely adapter, so Neon, Supabase, RDS, Railway, Fly or a local `postgres` container all work unchanged. Rules that keep it that way:

- No provider SDKs or serverless-only drivers in the service, and no provider features in the schema: plain tables, `bytea`, `timestamptz`, indexes.
- Schema changes are SQL migration files in `apps/account/migrations`, run by `pnpm --filter @ramu/account migrate` against `DATABASE_URL`. Better Auth's tables are generated into the same folder, so one tool owns the schema.
- Moving providers is `pg_dump` from the old database, `pg_restore` into the new one, and a new `DATABASE_URL`. A test runs the migrations and the backup round trip against a throwaway Postgres container in CI, which proves the service needs nothing beyond Postgres.

Neon is the first database (free plan; the first request after idle can be slower while it wakes, which is acceptable for sign-in and backup). The app likewise has no host-specific code: it runs first on Cloudflare Workers (free plan, with `nodejs_compat` for `pg` and Hyperdrive for pooled connections to the database), where akalstack.com's DNS also lives, and the same entry point runs under Node on any server. Cloudflare-only features (KV, D1, Durable Objects) stay out of it.

### 2. Encrypted settings backup

**What is backed up:** the portable export from [Copy settings between hosts](identities-and-settings.md#3-copy-settings-between-hosts) (appearance, models and abilities, agent defaults, Git and commit style, notifications, rules, identities' match rules and Git author). No paths, tokens, account references that only make sense on one host, or workspace state.

**The backup key.** The first time backup is turned on, the host generates a random 256-bit backup key and keeps it in its credential store (`apps/server/src/credentials/store.ts`). Each backup is the export, compressed, then sealed with XChaCha20-Poly1305 under that key (`@noble/ciphers`, beside the `@noble/curves` and `@noble/hashes` already in `packages/shared`). The key never reaches the service.

**Getting the key to another machine**, in the order offered:

1. **Approve from a device you have.** The new host shows **Approve on another device** and makes a one-time X25519 key pair. A signed-in host or phone that holds the backup key sees the request, both show the same six-digit number (derived the way pairing requests are in `packages/shared/src/pairRequest.ts`), and on **Approve** it sends the backup key sealed to the new host's public key through the service, which relays an envelope it cannot open and deletes it on delivery or after ten minutes.
2. **Recovery code.** When backup is turned on, Ramu shows a recovery code once (a 128-bit random code in groups, with **Copy** and **Save to a file**) and asks the person to keep it in a password manager. The backup key is also stored on the service sealed under a key derived from that code, so a person who lost every device restores with the code alone. Without any device and without the code, the backup cannot be opened, and Settings says so plainly when it shows the code.

**Where backups go.** **Back up settings** in **Settings → Remote access** offers two destinations, either or both:

- **Ramu account:** one slot per host, named on the host and stored encrypted, so the service sees only an opaque slot id. The last 30 versions are kept, 256 KB each at most; a host uploads at most once a minute, after a short delay following a settings change.
- **Your GitHub:** the same sealed file saved to a private gist (or a `ramu-settings` repository) in an account the host is already signed in to with `gh` or a saved token, with no Ramu account needed. Git history keeps versions. The backup key and recovery code work the same way: the recovery code alone opens it on a new machine, and **Approve on another device** works only between devices signed in to a Ramu account.

**Restore.** A new host's setup offers **Restore your settings?** when a signed-in account or a connected GitHub account has backups. It lists them by host name and time, gets the key (approval or recovery code), decrypts, and opens the same review list as **Import settings**, so nothing changes without the person seeing it. **Restore an earlier version** in Settings does the same for older versions.

**Phone.** The phone can sign in, approve a new host's key request, and show backup status. Its own device preferences are not backed up in this delivery.

**Turning it off.** **Stop backing up** keeps local settings and offers **Delete backups** for each destination. **Sign out** on a host removes its session and its copy of the backup key; other devices keep theirs.

### 3. Docs and trust

[Security](../../SECURITY.md) gets an account section: what the service stores, that it cannot read backups, that an account grants no host access, and what a compromised service could and could not do (withhold or delete backups, see sign-in metadata and backup sizes and times; not read settings or pair a device). The privacy notice on akalstack.com lists the same, and getramu.dev links to it. [Configuration](../guide/configuration.md) documents backup and restore.

## Existing services to extend

- Portable settings and batched edits: `packages/shared/src/settingsCompatibility.ts`, `apps/server/src/sharedSettings.ts`, `apps/server/src/settings/settingsStore.ts`.
- Host credential store for the account session and backup key: `apps/server/src/credentials/store.ts`.
- Six-digit confirmation and X25519 from pairing requests: `packages/shared/src/pairRequest.ts`, `apps/server/src/remote/pairingRequests.ts`.
- GitHub sign-ins for the GitHub destination: `apps/server/src/workspace/forgeAccounts.ts`.
- Phone secret storage: `expo-secure-store` beside the existing device token.

## Acceptance

- Representative task: a person wipes their Mac, installs Ramu, chooses **Restore your settings?**, signs in with GitHub, approves on their phone with the matching number, reviews and restores. Theme, models, rules and identities are back in under two minutes, and they connect only provider and hosting accounts again. Before, they rebuilt every setting by hand.
- The same restore with no other device, using the recovery code.
- The same restore from a GitHub gist backup with no Ramu account, using the recovery code.
- A database dump read directly shows no setting value, host name or settings key name in any backup row.
- The service's tests pass against a plain Postgres container, and a dump restored into a second Postgres serves an existing account's backups after only `DATABASE_URL` changes.
- A wrong recovery code, a tampered backup and an expired approval each fail with a plain message and change nothing.
- **Delete account** leaves no rows for the person.
- Server tests for sealing and opening, versions and limits, the approval envelope and restore review; web and mobile tests for sign-in, approval and restore; strings translated to Indonesian.

## Later options

- **Cloud Ramu hosts** attached to the account, listed in the host switcher and paired like any other host, with the web app at `ramu.akalstack.com`; sign-in stays at `account.akalstack.com`.
- **Your hosts** from the account, so a signed-in device can find a host and send a pairing request without a code (the host still approves).
- Backing up the phone's own device preferences.
