# From an idea to a deployed app

A person who has never written code describes an app, and Ramu takes it from an empty folder to a live URL, with CI that keeps it working and deploys every change. A developer gets the same path with fewer steps: a new project, a deploy target and a pipeline in one flow instead of three dashboards. Remove work as it lands, document shipped behavior in the guide (a new **Shipping an app** page beside [GitHub, GitLab, Bitbucket and Azure DevOps](guide/git-hosting.md)), and delete this plan when implementation and acceptance are finished.

## The need

Today an agent in Ramu can write the app, run it in a background terminal, check it in the browser and fix failing checks on a pull request. Everything before and after that is manual:

- **Starting:** `project_add` only clones a repository or registers a folder. Someone with an idea and no repository has to create a folder, run `git init` and pick a framework first, which a non-coder cannot do.
- **Deploying:** a project can be linked to Vercel or Netlify, with status, logs, production deploys and rollback ([Deploying an app](guide/deploy.md)). Other platforms have no target yet: `railway`, `cloudflared` and `docker` are on the risky-command list (`agent/autoCommandRules.ts`), so an agent can run them, but each run is a one-off approval.
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

### 1. Orchestration

Per-call `model`, `isolation` and `role` on `ramu_agent`, `agent_models`, `ramu_agent_status` and `ramu_agent_stop`, `requestId` replay on `ramu_agent`, `thread_start` and `project_add`, and the `next` line on background results are built ([Agents](guide/agents.md#sub-agents)). `project_create` below takes `requestId` too.

### 2. New project from scratch

A request that needs no backend, shared data or domain becomes an artifact instead of a project ([Artifacts](ARTIFACTS-PLAN.md), today's [Apps](guide/artifacts.md)): the stack choice sends "a page that adds up my monthly costs" to an App artifact and "a pitch deck" to Slides, so the smallest thing that works is made first, and a Design artifact can be the starting point of a new project. A page that outgrows itself arrives here through **Make it a project**, which already writes its sources, record fields and records to a new project and starts a thread; **Publish to the web** uses the same hosting accounts as deploys; its upload moves onto the adapters with §3.

### 3. Deploy targets

Vercel and Netlify are built ([Deploying an app](guide/deploy.md)): `HostingAdapter` and its registry in `workspace/deploy/`, the shared shapes in `packages/shared/src/types/deploy.ts`, hosting accounts connected by the platform's CLI sign-in or a guided token page, the contract suite (`apps/server/test/deployAdapters.test.ts`), `deploy.*` IPC, the deploy tools and the Deploy sheet. A new platform is one adapter file, its sign-in and a contract entry. What remains:

- **More platforms, in order:** Cloudflare (Pages and Workers, signed in with `wrangler login`), GitHub Pages (through the forge's GitHub account, deployed by a GitHub Actions job), then Fly and Railway, then **Own server** (below). Each is a REST client using a token from `credentials/`; a platform CLI is only for its browser sign-in.
- **Capabilities still to declare:** `promote`, `usage` (§8) and the resource kinds a platform provisions. Netlify previews come from pull requests; a branch preview through its API is not declared.
- **`ResourceAdapter`** (databases, cache, file storage, email): `kind`, `plans`, `provision(project, plan)` returning the resource and its connection variables, and optional `branch(for a preview)`, `usage` and `migrateCommand`. A hosting platform that provisions through its marketplace implements it too (Vercel Marketplace, Cloudflare D1, KV and R2, Netlify DB); a standalone provider (Neon, Supabase, Upstash, Resend) implements only this one. Deleting a resource is not on the interface; it is done on the provider's page. It joins the contract suite with a provision whose reply is lost.
- **Connecting an account, still to do:** the same CLI sign-in for `gh`, `wrangler`, `fly`, `railway` and `eas` as those platforms land; starting a sign-in from a paired device for a remote host, with the link shown there (hosting accounts change only on the host today); token links prefilled where the platform allows it (GitHub's fine-grained token form, Cloudflare's templates); and offering an expiring token again before it runs out (Settings shows the date today).
- **Deploy watch:** after a deploy, and on every push to the default branch, the thread is woken once the deployment finishes: the URL on success, the log tail on failure. It reuses the pull request watch's wake and queue path (`background/pullRequestWatches.ts`) and adds **Deployment failed** presets for Vercel and Netlify to [webhook schedules](guide/background-work.md#when-a-request-arrives).
- **Marks:** each resource kind names its `BrandId` (`packages/shared/src/brands.ts`) and shows its `BrandIcon` beside its name, as the hosting platforms do.
- **UI:** the preview URL on the pull request card when it is ready; the sheet's remaining steps from [the person's path](#the-persons-path) (create the GitHub repository when there is none, set the variables, push and wait for the first deployment); **Deploy** suggested when a goal is met; and on the phone, the project's Deployments read-only plus **Roll back** with confirmation (the phone shows each platform's account today).
- **Publish to the web:** Netlify and Vercel use the hosting accounts; the static upload in `hosting/staticSite.ts` moves onto the adapters as a capability, with Cloudflare Pages and GitHub Pages, as those adapters land.

### 4. CI/CD

**Set up CI**, requiring CI before merge on GitHub, and following pushes to the default branch are built ([Set up CI](guide/git-hosting.md#set-up-ci)): the generator in `packages/shared/src/ciWorkflow.ts`, the pull request from a temporary worktree in `apps/server/src/workspace/ci/`, `ci_setup`, and push watches beside pull request watches in `background/pullRequestWatches.ts`. What remains:

- **Deploy job** only for targets without Git integration: a `deploy.yml` that runs after CI passes on the default branch, using the platform's official action and repository secrets. Vercel and Netlify use their Git integration, so it lands with GitHub Pages, Fly or **Own server**.
- **Secrets sync for more targets:** the deploy sheet's sync over `EnvTarget` (`workspace/deploy/envSync.ts`: this host, GitHub Actions secrets, Vercel and Netlify) is built ([Deploying an app](guide/deploy.md#deploy-a-project)). GitLab CI variables join it as a target, and each new hosting adapter declares `environment` (names per preview and production, and writing values) so it is covered.
- **Branch protection on GitLab:** GitHub is built; GitLab's "Pipelines must succeed" project setting is not set yet, and repositories created by the deploy sheet should join the ones it is checked by default for.
- **Keeping it green:** a push of the default branch from a thread wakes it when CI fails ([Set up CI](guide/git-hosting.md#set-up-ci)); a merge through **Merge…** that breaks the default branch should wake the thread linked to the pull request too.

### 5. Own server

For someone who has a VPS or wants the app on the Ramu host:

- **A VPS over SSH:** the deploy sheet takes a host, a user and a key (stored in `credentials/`), checks Docker, and sets up the app as a container behind Caddy with automatic HTTPS. Deploys go through a GitHub Actions job (build image, push to GHCR, `ssh` pull and restart), so the server never needs Ramu running. Rollback re-deploys the previous image tag.
- **The Ramu host itself** is for demos and home use: the app runs as a supervised background command and is published through the host's own named tunnel ([Your own tunnel](guide/remote-hosts.md#your-own-tunnel)) on a separate hostname. It needs a security review first: the tunnel must never expose Ramu's own port, and the sheet must say the app goes offline when the computer sleeps.

### 6. Domains

**Add domain**, the records in plain words, **Create records** in Vercel DNS and Netlify DNS, the domain tools and the watch that wakes a thread when a domain is live are built ([Deploying an app](guide/deploy.md#deploy-a-project)). What remains: **Create records** at Cloudflare DNS with a token that can edit DNS (the artifacts' Cloudflare Pages token cannot), domains for each new platform's adapter, and the domains list on the phone.

### 7. Databases and storage

- The stack choice says when the app needs a database, file storage or email. The deploy sheet then offers the platform's own option (Vercel Marketplace: Neon Postgres, Upstash Redis, Blob; Cloudflare: D1, KV, R2; Netlify DB) or a provider the person picks (Neon, Supabase, Resend for email), on the person's account.
- **Provision** creates it through the `ResourceAdapter`, and its connection variables join the same secrets sync: this host for development, the platform's preview and production environments, and GitHub Actions when tests need it. Preview deployments get their own branch database where the provider has branching (Neon, Supabase).
- Migrations run as a step of the deploy (the stack's migrate command), and a failed migration stops the deploy and wakes the thread with its output. Deleting a database is never an agent action.

### 8. Cost and usage

- The Deployments section shows what the platform reports for the current billing period (bandwidth, function time, build minutes, database storage) beside the plan's limit, read through the deploy adapter.
- A notice in Inbox before a free-tier limit runs out (at 80% and 100%), naming what grows and the cheapest fix (cache a page, shrink images, raise the plan). The agent can read the same figures with `deploy_usage` and propose a change as a pull request.
- Ramu never changes a plan or adds a payment method; **Open billing** goes to the platform's page.

### 9. Uptime

- **Watch the live URL** (on by default after the first production deploy) checks the production URL and one health path every five minutes from the host, using the schedule runner. Two failed checks in a row open a thread in the project with the status code, the response time, the last deployment and its logs, and send a phone notification.
- The thread's first step is reading the logs and offering **Roll back** when the last deploy is the likely cause; the person decides. Recovery closes the incident with a recap. A host that is asleep reports the gap as unknown, not as downtime.

### 10. Mobile store releases

- For an Expo app, **Release** is a deploy target: EAS Build for iOS and Android, then EAS Submit to TestFlight and Play's internal track, on the person's Expo account (`EXPO_TOKEN` through `request_secret`). Over-the-air updates (EAS Update) are the preview channel for each pull request, with a QR code in the thread for Expo Go.
- The sheet checks what the stores need first (bundle identifier, icons, version, privacy text) and lists what only the person can do: enrolling in the Apple Developer Program and creating the Play app. Submitting to production review is always the person's action.
- A build or submission that fails wakes the thread with its log, through the same deploy watch.

### 11. Documentation and clean-up

Each section updates the docs it changes when it lands. When the last one lands, one pass makes the whole set read as one product:

- **New guide page** `docs/guide/shipping.md`: starting something new from Home, the questions and the stack, **Deploy** and each target, previews and CI, secrets sync, databases, domains, usage notices, uptime incidents, store releases and your own server. Linked from [docs/README.md](README.md) and the root README's **What it does**, which gets a **From idea to live app** group.
- **Pages that change:** [Agents](guide/agents.md) (per-call model, isolation and role, helper status and stop, `project_create`), [Home and Inbox](guide/inbox.md) (New project choices, usage and uptime notices), [Git hosting](guide/git-hosting.md) (Set up CI, branch protection, CI secrets), [Background work](guide/background-work.md) (deploy watch, **Deployment failed** presets, uptime checks), [Remote hosts](guide/remote-hosts.md) (publishing an app through your tunnel, kept apart from Ramu's own port), [Providers](guide/providers.md#environment-variables) (where each variable is synced), [Configuration](guide/configuration.md) (project facts), the [mobile README](../apps/mobile/README.md) and [VERIFICATION.md](../apps/mobile/VERIFICATION.md) (Deployments on the phone), and [SECURITY.md](../SECURITY.md) (deploy tokens, the actions that always ask, tunnel isolation).
- **Contributors:** [Architecture](contributing/architecture.md) gets the deploy boundary beside the forge one and **Adding a platform**: the adapter, its credentials file, its capabilities and the contract suite it must pass.
- **Every string** goes through `t()` with its Indonesian translation ([Localization](contributing/localization.md)), and plain-language copy is reviewed as a whole for one voice.
- **Clean-up:** agents use the deploy tools rather than running `vercel` or `netlify` as one-off risky commands, so the deploy-specific guidance in `agent/autoCommandRules.ts` points at the tools; any helper, type or doc text the new paths replaced is removed, with no unused exports left; docs pass the format and link checks; the live checks still to run move to [Acceptance](roadmap.md#acceptance); this plan and its roadmap line are deleted.

### 12. The site

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
- **Orchestration:** a lead splits a task into a worktree helper on another model and a read-only reviewer, stops one that goes off track, and a resent tool call does not start a second helper.
- Live checks for each platform with real accounts, and the VPS path on a real Ubuntu server, are listed under [Acceptance](roadmap.md#acceptance) until run.

