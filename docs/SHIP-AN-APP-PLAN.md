# From an idea to a deployed app

A person who has never written code describes an app, and Ramu takes it from an empty folder to a live URL, with CI that keeps it working and deploys every change. A developer gets the same path with fewer steps: a new project, a deploy target and a pipeline in one flow instead of three dashboards. Remove work as it lands, document shipped behavior in the guide (a new **Shipping an app** page beside [GitHub, GitLab, Bitbucket and Azure DevOps](guide/git-hosting.md)), and delete this plan when implementation and acceptance are finished.

## The need

Today an agent in Ramu can write the app, run it in a background terminal, check it in the browser and fix failing checks on a pull request. Everything before and after that is manual:

- **Starting:** `project_add` only clones a repository or registers a folder. Someone with an idea and no repository has to create a folder, run `git init` and pick a framework first, which a non-coder cannot do.
- **Deploying:** Ramu has no deploy target, status or URL. `vercel`, `netlify`, `railway`, `cloudflared` and `docker` are on the risky-command list (`agent/autoCommandRules.ts`), so an agent can run them, but each run is a one-off approval. Nothing remembers where the app lives, which deployment is live or how to roll back.
- **CI/CD:** Ramu watches checks but never sets them up. Nobody generates the workflow, puts the deploy token into the repository's secrets or links the deploy platform to the repository.
- **Secrets:** `request_secret` and **Environment variables** put a token on the host. Nothing copies it to GitHub Actions or to the platform's own environment variables, so the person pastes the same value into three places.

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
4. **Deploy.** **Deploy** on the project (or the agent's suggestion when the goal is met) opens one sheet: the target (recommended from the stack), the account (signed in through the platform's own browser login, or a token through `request_secret`), the repository to push to (created on their GitHub account when there is none) and the environment variables the app needs, with the values Ramu already has filled in. **Deploy** links the platform to the repository, sets the variables, pushes, waits for the first deployment and shows the live URL.
5. **Every later change.** The agent works on a branch, opens a pull request, waits for CI and the preview deployment, and posts the preview URL in the thread. Merging deploys it. A failed production deployment wakes the thread that last changed it, with the build log.

A developer can enter at any step: **Deploy** on an existing project, or **Set up CI** alone.

## Delivery

### 1. Orchestration lessons from T3 Code

T3 Code's orchestrator tools (`delegate_task`, `orchestrator_capabilities`, `task_status`, `task_cancel`, `t3_project_create`) do a few things Ramu's `ramu_agent`, `thread_start` and `project_add` don't. These come first because the rest of the plan is a long, multi-agent task and needs them:

- **Choose the helper per call.** `ramu_agent` takes only a type and a name; the provider and model come from **Sub-agents → Routing**. Add optional `model` (a handle such as `opus-5.5`), `isolation` (`shared` or `worktree`) and `role` (implementation, research, review, test), validated against the providers the host has. The helper never gets broader access than its parent; when the target lacks the parent's mode it steps down to the next narrower one, and asking for a mode it lacks is refused. Routing stays the default when the agent passes nothing.
- **Show what's available.** A short `agent_models` tool lists the host's providers and models (at most eight per provider, searchable), so the agent stops guessing handles. It extends the data **Settings → Providers** already shows.
- **Status and stop for the agent.** `ramu_agent_status` and `ramu_agent_stop` act only on the caller's own helpers, so a lead can stop a helper that has gone off track without the person. Stopping the thread still stops them all.
- **Retries never start work twice.** An optional `requestId` on `ramu_agent`, `thread_start`, `project_add` and the new `project_create` replays the first result when a provider re-sends a tool call after a dropped connection.
- **Say what comes next.** Background results end with one instruction: "The report arrives as a message; end your turn and do not poll." T3 Code returns the same `next` and it stops agents from looping on status calls.
- **Isolated helpers start from the parent's current state.** T3 Code's worktree children start from the parent's `HEAD` and lose uncommitted edits. Ramu's isolation should copy them the way **Continue in a new worktree** already does (`thread_continue_in_worktree`).

Left as they are: T3 Code's queue-editing tool and changing another thread's model (already declined in [the roadmap](roadmap.md#decisions-and-deferred-scope)), and `html_preview`, which `preview_interactive` covers.

### 2. New project from scratch

- **`project_create`** (agent tool) and **projects.create** with a starter: a name, a folder beside the person's other repositories (the same parent `project_add` clones into), `git init`, an optional generator command run as an approved background command, a `.gitignore`, and a first commit. Outside Full access it shows one card naming the folder and the command. It returns the project for `thread_start`.
- **Stack choice** is a pure function in `packages/shared` (`stacks.ts`): from the answers (web or phone, sign-in, data, expected traffic) to a stack, a generator command, a default deploy target and the commands for build, test and dev. The same table drives the deploy sheet's recommendation. It covers static sites, Next.js, Vite + React, Astro, Expo, a Node API, Python with Django or FastAPI, Rails and Go, each with its generator, a test command and a deploy target that runs it.
- **No new screen.** Starting an app is a thread like any other, so Home stays the one start box. Three additions: **New project** in the Auto "No project matched" choices (and **New project…** in the Project picker), **Start something new** in the no-projects state beside **Open a folder**, and Auto's project routing recognizing a request to build something new. The agent then runs the questions, `project_create` and the goal with its verification command, and the thread moves from No project into the new project's checkout, the same handoff **Continue in a new worktree** uses. The browser opens on the dev server's ready line, using the existing `background_terminal_wait` ready-text match.
- **Project facts** saved in `projectConfig.ts`: the stack, the dev, build and test commands, and later the deploy target, so new threads in the project know them without being told.

### 3. Deploy targets

Nothing for deploys exists in code yet. Platforms differ more than forges do (Netlify has no database of its own, Neon is only a database, Vercel and Cloudflare are both), so instead of one large interface like `ForgeAdapter`, there are three small ones under `workspace/deploy/`, each with a registry like `registerForgeAdapter`. Callers and the UI see only the shared shapes in `packages/shared/src/types/deploy.ts`, so a new platform is one file, its credentials file and its tests, with no change to callers, IPC or UI:

- **`HostingAdapter`** (Vercel, Netlify, Cloudflare, GitHub Pages, Fly, Railway, Own server): `account`, `listDeployments`, `deploymentStatus`, `deploymentLogs` (a tail, like `forge/buildLogs.ts`) and `productionUrl` are required. Everything else is optional and listed in a `capabilities` object: `linkRepository` (the platform's Git integration), `deploy(ref)` for targets without one, `promote`, `rollback`, `domains`, `usage` and the resource kinds it can provision. The UI and the agent tools hide what a target lacks instead of calling it and failing.
- **`ResourceAdapter`** (databases, cache, file storage, email): `kind`, `plans`, `provision(project, plan)` returning the resource and its connection variables, and optional `branch(for a preview)`, `usage` and `migrateCommand`. A hosting platform that provisions through its marketplace implements it too (Vercel Marketplace, Cloudflare D1, KV and R2, Netlify DB); a standalone provider (Neon, Supabase, Upstash, Resend) implements only this one. Deleting a resource is not on the interface; it is done on the provider's page.
- **`EnvTarget`**: `list` (names only) and `set(environment, values)`. This host's **Environment variables**, the forge's CI secrets (GitHub Actions, GitLab CI variables) and each hosting adapter implement it, so secrets sync is one loop over targets and a new platform joins it by implementing two methods.
- **One contract test suite** runs every adapter against a fake HTTP server with recorded responses: required reads, the declared capabilities, a deploy or provision whose reply is lost, and error mapping to the shared failure kinds (signed out, missing permission, plan limit, not found). A new adapter is done when it passes.
- **The stack table** in `packages/shared` names adapter ids and resource kinds only, so adding a platform never touches it unless it becomes a default.
- **Platforms, in order:** Vercel, Netlify, Cloudflare (Pages and Workers), GitHub Pages (through the forge's GitHub account), then Fly and Railway, then **Own server** (below). Each is a REST client using a token from `credentials/`, never a shell string; a platform CLI is only for its browser sign-in.
- **IPC:** `deploy.*` handlers validated with zod and checked against the project's binding and account, like `forge.createPullRequest`. A deploy or rollback whose reply is lost reads the deployment list again before reporting, so a retry never deploys twice.
- **Agent tools:** `deploy_status`, `deploy_logs` and `deploy_preview` (a preview deployment of the current branch). `deploy_production`, `deploy_rollback` and domain changes ask the person every time with a card that names the URL and what changes.
- **Deploy watch:** after a deploy, and on every push to the default branch, the thread is woken once the deployment finishes: the URL on success, the log tail on failure. It reuses the pull request watch's wake and queue path (`background/pullRequestWatches.ts`) and adds **Deployment failed** presets for Vercel and Netlify to [webhook schedules](guide/background-work.md#when-a-request-arrives).
- **UI:** a **Deployments** section in the project (target, live URL, the last deployments with status, **Open**, **Logs**, **Roll back**) and the URL on the pull request card when the preview is ready. On the phone the section is read-only plus **Roll back** with confirmation.

### 4. CI/CD

- **Set up CI** (project menu, deploy sheet, or `ci_setup` for the agent) writes `.github/workflows/ci.yml` from the project facts: install with the lockfile's package manager, cached, then lint, typecheck, test and build, on pull requests and pushes to the default branch. GitLab gets `.gitlab-ci.yml`. The agent reviews the file against the repository (monorepo filters, services such as Postgres for tests) before the commit; the change goes through a pull request like any other, so the person sees the diff.
- **Deploy job** only for targets without Git integration: a `deploy.yml` that runs after CI passes on the default branch, using the platform's official action and repository secrets.
- **Secrets sync:** the deploy sheet lists the app's variables (from `.env.example` and the code) next to where each one is set: this host, GitHub Actions, the platform's preview and production environments. **Sync** writes the missing ones to each `EnvTarget`: the forge's existing account (GitHub's repository secrets API) and the hosting adapter. Values come from **Environment variables** or `request_secret` and are never shown again; paired devices see names only, as today.
- **Branch protection** (optional, checked by default for new repositories): CI required before merge, through the forge's API.
- **Keeping it green:** CI failures already reach the thread through `watch_pull_request` and **Fix failing checks**; a broken default branch (a push that fails CI) wakes the thread that pushed it.

### 5. Own server

For someone who has a VPS or wants the app on the Ramu host:

- **A VPS over SSH:** the deploy sheet takes a host, a user and a key (stored in `credentials/`), checks Docker, and sets up the app as a container behind Caddy with automatic HTTPS. Deploys go through a GitHub Actions job (build image, push to GHCR, `ssh` pull and restart), so the server never needs Ramu running. Rollback re-deploys the previous image tag.
- **The Ramu host itself** is for demos and home use: the app runs as a supervised background command and is published through the host's own named tunnel ([Your own tunnel](guide/remote-hosts.md#your-own-tunnel)) on a separate hostname. It needs a security review first: the tunnel must never expose Ramu's own port, and the sheet must say the app goes offline when the computer sleeps.

### 6. Domains

**Add domain** on the Deployments section asks the platform to add it, shows the DNS records to create in plain words ("At your domain provider, add a CNAME record named www pointing to …"), and watches verification and the certificate, waking the thread when it's live. When the domain's DNS is at a provider with an API (Cloudflare first, then Vercel DNS and Netlify DNS), **Create records** makes them after one confirmation instead.

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
- **Orchestration:** a lead splits a task into a worktree helper on another model and a read-only reviewer, stops one that goes off track, and a resent tool call does not start a second helper.
- Live checks for each platform with real accounts, and the VPS path on a real Ubuntu server, are listed under [Acceptance](roadmap.md#acceptance) until run.

