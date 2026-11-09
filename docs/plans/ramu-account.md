# Ramu account and encrypted settings backup

## The need

A person who sets Ramu up on a new machine, or reinstalls, starts from defaults and rebuilds theme, models, abilities, rules, commit style, notifications and identities from memory. Copying from a paired host ([Identities and moving settings](identities-and-settings.md)) helps only while the old host is still there and reachable. The person needs their settings to survive a lost or wiped machine, with nothing to set up beyond signing in, and without handing their configuration to anyone, Ramu included.

A Ramu account is also where cloud Ramu hosts will attach later, so it is designed for that from the start, but it ships with one feature that is useful on day one: settings backup that only the person's own devices can read.

## Principles

- **Optional.** Everything that works without an account keeps working. Ramu never asks for sign-in at first launch or as a gate; it offers it where it helps (**Back up settings**, and **Restore your settings?** in a new host's setup).
- **An account is not access.** Signing in never pairs a device or grants anything on a host. An account can carry a pairing request to a host, but the host approves it with the same six-digit check as a nearby request. Host pairing, device tokens, roles and permissions stay the only way in ([Security](../../SECURITY.md#remote-access)).
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

**Phone.** The phone can sign in, approve a new host's key request, and show backup status. Its own preferences are backed up too ([Phone preferences](#4-phone-preferences)).

**Turning it off.** **Stop backing up** keeps local settings and offers **Delete backups** for each destination. **Sign out** on a host removes its session and its copy of the backup key; other devices keep theirs.

### 3. Your hosts

**The need.** Adding a host today means being near it (a nearby request) or copying a pairing code or link from its screen. Setting up a new phone, or adding the home server from the office, means getting to that host first.

**Listing a host.** A signed-in host offers **List in my account** in **Settings → Remote access** (off until chosen). The account then holds the host's name, its public key and when it was last seen; never its addresses, which travel only inside an approved pairing. **Remove from my account** takes it off, and signing out removes it.

**Asking without a code.** **Add a host** on a signed-in device (the desktop or the phone) lists **Your hosts** from the account above hosts nearby. Choosing one sends a pairing request through the service: the device's one-time X25519 key and the commitment pairing requests already use (`packages/shared/src/pairRequest.ts`). The host receives it the way it receives a nearby request (in Ramu, as a notification, or with `ramu pair --approve`), both screens show the same six-digit number, and the host chooses the access. The approval travels back sealed to the device's key, carrying the device token and the host's addresses, so the service relays only envelopes it cannot open; a request expires after ten minutes. The device then connects directly and checks the host's identity on each address, as after any pairing.

**Bounds.** Only devices signed in to the same account can send a request to a listed host; at most five requests wait per host and one is sent per device per minute. A listed host checks the service for requests while it runs, at most every 30 seconds, and immediately while its **Pair a device** sheet is open. A denied or expired request changes nothing.

### 4. Phone preferences

The phone's own preferences (appearance, text size, language, notification and haptics choices, viewer gestures, layout choices such as collapsed sections) are backed up in a slot of their own, sealed under the same backup key as host settings. The phone gets that key when it signs in and is approved by a device that holds it, or from the recovery code. Device tokens, paired hosts' credentials, drafts and anything in `expo-secure-store` are never included.

On a new phone, signing in offers **Restore your phone's settings?** with the same review list, then **Pair again with your hosts**, which lists [Your hosts](#3-your-hosts) to request in turn. Each still needs its host's approval.

### 5. Docs and trust

[Security](../../SECURITY.md) gets an account section: what the service stores, that it cannot read backups, that an account grants no host access, and what a compromised service could and could not do (withhold or delete backups, see sign-in metadata, backup sizes and times and the names of listed hosts, delay or drop pairing requests; not read settings, learn a host's addresses or pair a device). The privacy notice on akalstack.com lists the same, and getramu.dev links to it. [Configuration](../guide/configuration.md) documents backup and restore.

## Existing services to extend

- Portable settings and batched edits: `packages/shared/src/settingsCompatibility.ts`, `apps/server/src/sharedSettings.ts`, `apps/server/src/settings/settingsStore.ts`.
- Host credential store for the account session and backup key: `apps/server/src/credentials/store.ts`.
- Six-digit confirmation and X25519 from pairing requests: `packages/shared/src/pairRequest.ts`, `apps/server/src/remote/pairingRequests.ts`.
- GitHub sign-ins for the GitHub destination: `apps/server/src/workspace/forgeAccounts.ts`.
- Phone secret storage: `expo-secure-store` beside the existing device token.
- Pairing requests, their approval and the access chosen: `apps/server/src/remote/pairingRequests.ts`; the device side: `apps/mobile/src/runtime/nearby.ts`, and **Add a host** on the desktop.
- Phone preferences: `apps/mobile/src/storage/index.ts`.

## Acceptance

- Representative task: a person wipes their Mac, installs Ramu, chooses **Restore your settings?**, signs in with GitHub, approves on their phone with the matching number, reviews and restores. Theme, models, rules and identities are back in under two minutes, and they connect only provider and hosting accounts again. Before, they rebuilt every setting by hand.
- The same restore with no other device, using the recovery code.
- The same restore from a GitHub gist backup with no Ramu account, using the recovery code.
- A database dump read directly shows no setting value, host name or settings key name in any backup row.
- The service's tests pass against a plain Postgres container, and a dump restored into a second Postgres serves an existing account's backups after only `DATABASE_URL` changes.
- A wrong recovery code, a tampered backup and an expired approval each fail with a plain message and change nothing.
- From outside the home network, a signed-in phone adds a listed home server from **Your hosts**: the request appears on the host with the same number as on the phone, **Allow** pairs it, and the phone connects over the host's tunnel address. No code was copied. A database dump shows the host's name and public key but no address.
- A device signed in to another account cannot send a request to that host; a sixth waiting request is refused.
- A new phone signs in, restores its preferences after review, and pairs again with two listed hosts with one approval each; no device token came from the backup.
- **Delete account** leaves no rows for the person.
- Server tests for sealing and opening, versions and limits, the approval envelope, restore review, listed hosts and relayed pairing requests with their bounds; web and mobile tests for sign-in, approval, restore, **Your hosts** and phone preference restore; strings translated to Indonesian.

## Later options

- **Cloud Ramu hosts** attached to the account, listed in the host switcher and paired like any other host, with the web app at `ramu.akalstack.com`; sign-in stays at `account.akalstack.com`.
