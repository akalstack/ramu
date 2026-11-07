# From an idea to a deployed app

A person who has never written code describes an app, and Ramu takes it from an empty folder to a live URL, with CI that keeps it working and deploys every change. A developer gets the same path with fewer steps: a new project, a deploy target and a pipeline in one flow instead of three dashboards. Remove work as it lands, document shipped behavior in the guide ([Shipping an app](guide/shipping.md) and the pages it links to), and delete this plan and its roadmap line when implementation and acceptance are finished.

## The need

Most of the path is built ([Shipping an app](guide/shipping.md)). What is still manual or missing:

- **Starting:** `project_create` and **New project** start a project from one sentence, but the deploy sheet does not yet create the GitHub repository and push it, so a non-coder still meets **Publish to GitHub** first.
- **Deploying:** a project can be linked to Vercel, Netlify or Railway, set up on Fly.io through a GitHub Actions deploy job, or set up on the person's own server, with status, logs, production deploys and rollback, and an Expo app released to TestFlight and Play's internal track ([Deploying an app](guide/deploy.md)). Other platforms have no target yet: `railway`, `cloudflared` and `docker` are on the risky-command list (`agent/autoCommandRules.ts`), so an agent can run them, but each run is a one-off approval.
- **CI/CD:** Ramu adds a CI workflow through a pull request ([Set up CI](guide/git-hosting.md#set-up-ci)), wakes the thread whose push breaks the default branch, and can require CI before merge on GitHub.
- **Secrets:** `request_secret` and **Environment variables** put a token on the host, and **Sync** in the deploy sheet copies it to GitHub Actions and the platform's variables; GitLab CI variables are not covered yet.

**Easier for the person:** one sentence becomes a running app. One action (**Deploy**) turns it into a public URL on an account they own. Every later change goes through a pull request with checks and a preview URL, and merging to the default branch deploys it. The agent knows the target, the live URL and the last deployment's result, so "it's broken in production" is a task it can act on: read the logs, fix the bug, open a pull request, watch the deploy.

## Principles

- **The person owns everything.** The app runs on their account (Vercel, Netlify, Cloudflare, GitHub Pages, Fly, Railway, or their own server). Ramu is free and runs no hosting service, so it stores no app and charges nothing. The repository is a normal one they can take anywhere.
- **The platform's own Git integration comes first.** When the platform can watch the repository (Vercel, Netlify, Cloudflare Pages, Railway), Ramu links them: preview per pull request, production on the default branch, no deploy token in CI. A GitHub Actions deploy job is only for targets without one (GitHub Pages, Fly, a VPS).
- **Official generators over Ramu templates.** The agent starts a project with the framework's own command (`create-next-app`, `create-vite`, `create-expo-app`, `astro`), so Ramu has no templates to keep up to date. Ramu supplies the choice, the defaults and the checks.
- **Irreversible or public steps are the person's.** The first production deploy, a production rollback, adding a domain, changing DNS and deleting a deployment always show one approval card in plain words, whatever the thread's access, like merge in [Pull requests in Source Control](guide/git-hosting.md#pull-requests-in-source-control). Preview deploys and CI runs need no extra approval in Full access.
- **Plain words, the same UI.** No separate "beginner mode". Cards and recaps name outcomes ("Your app is live at …", "The last change broke sign-up; a fix is ready"), and commands, logs and diffs are one click away for anyone who wants them.

## The person's path

1. **Home, as it is.** They type "a booking page for my barbershop where customers pick a time and I get an email" into the same start box as any thread. With **Auto** and no project that fits, Home's existing "No project matched" choices offer **New project** first; a host with no projects yet shows **Start something new** beside **Open a folder**. The thread starts in No project, and the agent asks at most three questions as cards, each with a recommended answer chosen (web or phone app, needs sign-in, needs to store data), then proposes a stack in one line ("Next.js with a Postgres database, deployed on Vercel"), which they accept or change.
2. **The project.** Ramu creates a folder beside their other projects, runs the generator, commits, and starts a thread with a [goal](guide/goals.md) whose verification command is the project's build and test, plus a browser check that the main page loads. The app opens in the browser panel as soon as the dev server prints its ready line.
3. **Building.** The agent works toward the goal. Questions come as cards; anything only the person knows (an email address, a logo) is asked once and saved in the project.
4. **Deploy.** **Deploy** on the project (or the agent's suggestion when the goal is met) opens one sheet: the target (recommended from the stack), the account (connected as in [Deploying an app](guide/deploy.md#connect-an-account): the platform's own sign-in first, a guided token page otherwise), the repository to push to (created on their GitHub account when there is none) and the environment variables the app needs, with the values Ramu already has filled in. **Deploy** links the platform to the repository, sets the variables, pushes, waits for the first deployment and shows the live URL.
5. **Every later change.** The agent works on a branch, opens a pull request, waits for CI and the preview deployment, and posts the preview URL in the thread. Merging deploys it. A failed production deployment wakes the thread that last changed it, with the build log.

A developer can enter at any step: **Deploy** on an existing project, or **Set up CI** alone.

## Delivery

### 1. Artifacts as the smaller start

A request that needs no backend, shared data or domain becomes an artifact instead of a project ([Artifacts](ARTIFACTS-PLAN.md), today's [Apps](guide/artifacts.md)): the stack choice sends "a page that adds up my monthly costs" to an App artifact and "a pitch deck" to Slides, so the smallest thing that works is made first, and a Design artifact can be the starting point of a new project. A page that outgrows itself arrives here through **Make it a project**, which already writes its sources, record fields and records to a new project and starts a thread; **Publish to the web** uses the same hosting accounts as deploys; its upload moves onto the adapters with §2.

### 2. Deploy targets

Vercel, Netlify and the person's own server are built ([Deploying an app](guide/deploy.md)): `HostingAdapter` and its registry in `workspace/deploy/`, the shared shapes in `packages/shared/src/types/deploy.ts`, hosting accounts connected by the platform's CLI sign-in or a guided token page, the contract suite (`apps/server/test/deployAdapters.test.ts`), `deploy.*` IPC, the deploy tools and the Deploy sheet. A new platform is one adapter file, its sign-in and a contract entry. What remains:

- **More platforms, in order:** Cloudflare (Pages and Workers, signed in with `wrangler login`), then GitHub Pages (through the forge's GitHub account, deployed by a GitHub Actions job read with `actionsDeploys.ts`). Each is an API client using a token from `credentials/`; a platform CLI is only for its browser sign-in ([Adding a platform](contributing/architecture.md#adding-a-platform)).
- **Capabilities still to declare:** `promote` and the resource kinds a platform provisions. Netlify previews come from pull requests; a branch preview through its API is not declared.
- **`ResourceAdapter`** (`workspace/deploy/resource.ts`, Neon built, §6): a hosting platform that provisions through its marketplace implements it too (Vercel Marketplace, Cloudflare D1, KV and R2, Netlify DB); a standalone provider (Supabase, Upstash, Resend) implements only this one. Deleting a resource is not on the interface.
- **Connecting an account, still to do:** the same CLI sign-in for `gh`, `wrangler` and `eas` as those platforms land; starting a sign-in from a paired device for a remote host, with the link shown there (hosting accounts change only on the host today); token links prefilled where the platform allows it (GitHub's fine-grained token form, Cloudflare's templates); and offering an expiring token again before it runs out (Settings shows the date today).
- **Deploy watch, still to do:** deploys, pushes and merges from Ramu are followed ([When a deployment finishes](guide/deploy.md#when-a-deployment-finishes), `workspace/deploy/deployWatch.ts`), and **Deployment failed** webhook presets cover Vercel and Netlify. Pushes an agent makes with `git push` in its shell are not followed yet, nor are pushes from outside Ramu without a webhook schedule.
- **Marks:** each resource kind names its `BrandId` (`packages/shared/src/brands.ts`) and shows its `BrandIcon` beside its name, as the hosting platforms do.
- **UI:** the sheet's remaining steps from [the person's path](#the-persons-path) (create the GitHub repository when there is none, set the variables, push and wait for the first deployment), and **Deploy** suggested when a goal is met. The pull request card shows the preview, and the phone a project's deployments, uptime and usage with **Roll back** ([Deploying an app](guide/deploy.md#on-the-phone)); domains and databases are not on the phone yet, and the agent does not post the preview address in the thread by itself.
- **Publish to the web:** Netlify and Vercel use the hosting accounts; the static upload in `hosting/staticSite.ts` moves onto the adapters as a capability, with Cloudflare Pages and GitHub Pages, as those adapters land.

### 3. CI/CD

**Set up CI**, requiring CI before merge on GitHub, and following pushes to the default branch are built ([Set up CI](guide/git-hosting.md#set-up-ci)): the generator in `packages/shared/src/ciWorkflow.ts`, the pull request from a temporary worktree in `apps/server/src/workspace/ci/`, `ci_setup`, and push watches beside pull request watches in `background/pullRequestWatches.ts`. What remains:

- **Deploy job** only for targets without Git integration: the own server's `deploy.yml` and Fly.io's `fly-deploy.yml` are built (`packages/shared/src/serverDeploy.ts` and `flyDeploy.ts`, proposed with the files they need in one pull request, secrets written through the GitHub Actions `EnvTarget`). GitHub Pages gets its own the same way as it lands, using its official action.
- **Secrets sync for more targets:** the deploy sheet's sync over `EnvTarget` (`workspace/deploy/envSync.ts`: this host, GitHub Actions secrets, Vercel and Netlify) is built ([Deploying an app](guide/deploy.md#deploy-a-project)). GitLab CI variables join it as a target, and each new hosting adapter declares `environment` (names per preview and production, and writing values) so it is covered.
- **Branch protection on GitLab:** GitHub is built; GitLab's "Pipelines must succeed" project setting is not set yet, and repositories created by the deploy sheet should join the ones it is checked by default for.
- **Keeping it green:** a push of the default branch from a thread wakes it when CI fails ([Set up CI](guide/git-hosting.md#set-up-ci)); a merge through **Merge…** that breaks the default branch should wake the thread linked to the pull request too.

### 4. Own server

A VPS over SSH is built ([Your own server](guide/deploy.md#your-own-server), `workspace/deploy/server.ts`, `serverSetup.ts` and `ssh.ts`). What remains:

- **More than one server per host:** the server is one hosting account, so every project on a host deploys to the same server (each as its own container and Caddy site).
- **Apps that are not one container:** a database or worker beside the app (a Compose file) and per-project health checks before the old container is removed.
- **The Ramu host itself** is built for Docker ([On this computer](guide/deploy.md#on-this-computer)), behind a quick tunnel whose address changes when Ramu restarts. Remaining:
  - A lasting hostname: a named Cloudflare Tunnel Ramu configures itself, with an ingress naming exactly the app's hostname and port and ending in a catch-all 404, checked before it starts and refusing Ramu's own port, a wildcard hostname or a Unix socket.
  - The project's own variables passed into the container, and the uptime watch following the published address.
  - Without Docker: running the app as a supervised command in its own process group, with the sheet saying it runs with the person's own permissions.

### 5. Domains

**Add domain**, the records in plain words, **Create records** in Vercel DNS and Netlify DNS, the domain tools and the watch that wakes a thread when a domain is live are built ([Deploying an app](guide/deploy.md#deploy-a-project)). What remains: **Create records** at Cloudflare DNS with a token that can edit DNS (the artifacts' Cloudflare Pages token cannot), domains for each new platform's adapter, and the domains list on the phone.

### 6. Databases and storage

`ResourceAdapter` with Neon (API key on the guided token page), **Provision** in the deploy sheet for stacks or code that need a database, a `preview` branch for previews, this host and CI, connection variables in secrets sync, and migrations before a production deploy from Ramu are built ([Databases](guide/deploy.md#databases)). What remains:

- **More providers:** the platforms' own options (Vercel Marketplace, Cloudflare D1, KV and R2, Netlify DB), Supabase, file storage and email (Resend), each a `ResourceAdapter` with its `BrandId`, and the stack choice naming storage and email needs.
- **Neon's CLI sign-in:** `neonctl auth` signs in through a browser on the host and saves an hourly token renewed through Neon's OAuth client; Ramu uses an API key until that renewal is built.
- **A branch per pull request** instead of one shared `preview` branch, created when the preview deployment starts and removed when the pull request closes. The deploy watch finds deployments by commit, so it can tell when a pull request's preview starts.
- **Migrations on every production deploy:** a push to the default branch that the platform deploys itself runs no migration from Ramu; the deploy watch tells the thread so. A safe way to run them: turn off the platform's automatic promotion for linked projects (Vercel's staged production deployments, with auto-assigned production domains off; Netlify's locked auto publishing), let the deploy watch see the production build finish, run `migrate` from the host against production at that commit, and only then promote the deployment (Vercel's promote endpoint, Netlify's restore endpoint), declared as the `promote` capability. A failed migration leaves the old deployment live and wakes the thread. It needs the host awake for every production deploy and migrations that the running version tolerates (add columns before the code uses them), so it is opt-in per project.

### 7. Cost and usage

Usage figures for Vercel, Netlify and Neon beside the limits their APIs report, **Open billing**, notices at 80% and 100%, and `deploy_usage` are built ([Usage](guide/deploy.md#usage)). What remains: figures for each new platform's adapter as it lands, and Netlify bandwidth or credits if Netlify's API starts reporting them.

### 8. Uptime

**Watch the live address**, incident threads after two failed checks, the recap on recovery and unknown spans while the host sleeps are built ([Uptime](guide/deploy.md#uptime)), and the phone shows the watch's state beside the project's deployments. What remains: turning the watch on and off from the phone.

### 9. Mobile store releases

**Store releases** in the deploy sheet (checks from `app.json` and `eas.json`, the person's store steps, **Add eas.json in a pull request**, **Release** through `eas build --auto-submit-with-profile` to TestFlight and Play's internal track), the Expo access token in Settings, the deploy watch through each build and its upload, and `release_status`, `release_logs` and `release_start` are built ([Store releases](guide/deploy.md#store-releases), `workspace/deploy/release.ts` and `expo.ts`). What remains:

- **Previews per pull request with EAS Update:** publish each pull request's branch to its own update channel and show a QR code on the pull request card and in the thread that opens it in Expo Go. It needs `expo-updates` and a runtime version in the app, a channel per branch, and works in Expo Go only for apps without custom native code, so the sheet must say when a development build is needed instead.
- **Expo's CLI sign-in:** `eas login --device --non-interactive` signs in through a browser on any device and saves a session secret in `~/.expo/state.json` (eas-cli 27); a sign-in can ask the person to pick the number their browser shows. Ramu would run it with a private `HOME`, exchange the session for an access token named Ramu (Expo's `createAccessToken` mutation), then end the session, which needs the number choice in Settings' sign-in.
- **On the phone:** the store builds and their uploads beside a project's deployments, and **Release** with the same confirmation.
- **Dynamic configuration:** an `app.config.*` app is checked from `app.json` only; reading its resolved configuration needs `expo config --json`, which runs the project's code.

### 10. The site

The site (`apps/site`, one Astro page) is about keeping coding agents moving. With this plan, Ramu also takes someone from an idea to a live app, so the site gets new copy throughout, written once the features ship and only claiming what they do:

- **Positioning:** two readers, one product. Someone with an idea and no code ("Describe it. Ramu builds it, puts it online and keeps it working, on accounts you own.") and a developer ("New project, deploy, CI and previews in one flow, with the agents you already use."). Draft several heroes and pick with the person; keep **free and open source**, **your accounts** and the phone companion.
- **Sections, rewritten in order:** hero; **Idea to live app** (the person's path, five steps with real screenshots); **Every change, safely** (pull request, preview URL, CI, merge to deploy, roll back from the phone); **Your agents, your accounts** (providers, then hosting platforms and databases by name, with brand marks only where their guidelines allow); the existing agents, review, mobile and source sections tightened around the new story; download.
- **Demo:** `components/demo.tsx` plays the new loop (one sentence, questions, the app in the preview, **Deploy**, the live URL) instead of today's thread-only demo.
- **Around the page:** title, description and the social-sharing image; the README's opening lines match the hero; the sponsor links (GitHub Sponsors and Trakteer) stay.
- **Claims:** no comparison with another app without matched-task evidence (the [evidence rule](roadmap.md#decisions-and-deferred-scope)), and no "anyone can ship an app" until the non-coder acceptance task has passed with real people.

## Safety

- Production deploys, rollbacks, domain and DNS changes, deleting deployments or databases, plan and billing changes, store submissions and branch protection changes are the person's actions; agents ask through a card every time, in every access mode.
- Tokens stay in `credentials/` on the host, scoped to the smallest permission the platform offers. A token is never written into a workflow file, a commit or the transcript, and a committed `.env` file blocks the push with an explanation.
- Every new IPC input and agent tool is bounded with zod; the deploy adapter only talks to the project's own linked target and account.
- Generated workflows pin actions to a major version and use `permissions:` with the least access the job needs.

## Acceptance

- **Non-coder task:** someone who has never used a terminal asks for "a one-page site for my bakery with opening hours and a contact form", answers the questions, and opens the live URL on their phone without typing a command, in under 30 minutes. They then ask for a change; it arrives as a preview URL, and after **Merge** the live site shows it.
- **Developer task:** for an existing Next.js repository with no CI, **Deploy** to Vercel and **Set up CI** together take one sheet and one pull request. Count steps and context switches against doing it by hand in the Vercel and GitHub dashboards.
- **Broken production:** a merge that breaks the build wakes the thread with the log tail; the agent opens a fix and the person can roll back from the phone meanwhile.
- **Data and uptime:** a booking app gets a Postgres database from the deploy sheet, preview deployments use their own branch, and stopping the database's endpoint opens an incident thread within ten minutes that recovers with a recap.
- **Mobile:** an Expo app goes from **Release** to TestFlight and Play's internal track with only the store steps done by hand.
- **Docs and site:** someone new to Ramu goes from the site to a deployed app using only the site and the guide, and every doc link and screenshot matches the shipped app.
- Live checks for each platform with real accounts, and the VPS path on a real Ubuntu server, are listed under [Acceptance](roadmap.md#acceptance) until run.

