# From an idea to a deployed app

A person who has never written code describes an app, and Ramu takes it from an empty folder to a live URL, with CI that keeps it working and deploys every change. A developer gets the same path with fewer steps: a new project, a deploy target and a pipeline in one flow instead of three dashboards. Remove work as it lands, document shipped behavior in the guide ([Shipping an app](guide/shipping.md) and the pages it links to), and delete this plan and its roadmap line when implementation and acceptance are finished.

## The need

The path is built ([Shipping an app](guide/shipping.md)): a project from one sentence, the repository published from the deploy sheet, hosting on Vercel, Netlify, Railway, Fly.io, Cloudflare, GitHub Pages or the person's own server, databases, caches, file storage and email on their own accounts, CI that GitHub or GitLab requires before merge, variables synced to GitHub Actions, GitLab CI and the platform, and store releases of an Expo app. What is still missing:

- **Showing people:** the site describes the path in words; real screenshots of each step are still to come.
- **Usage for newer platforms:** the deploy sheet's usage figures cover Vercel, Netlify, Railway, Neon and Upstash; others report none through the APIs Ramu uses yet.

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

### 1. Cost and usage

Usage figures for Vercel, Netlify, Railway, Neon, Supabase, Upstash, Resend and Cloudflare Workers beside the limits their APIs report, **Open billing**, notices at 80% and 100%, and `deploy_usage` are built ([Usage](guide/deploy.md#usage)). What remains: figures for each new platform's adapter as it lands, and Netlify bandwidth or credits if Netlify's API starts reporting them.

### 2. The site

The rewrite is built (`apps/site`): the hero leads with "Describe it. Ramu builds it, puts it online and keeps it working." and the developer line second, **From an idea to a live app** in five steps, **Every change, safely**, hosting platforms and data providers named in text beside the agents, the demo playing one sentence through the questions, the build, the preview and **Deploy** to the live address, the title, description and social image, the README's opening line, and the sponsor links. Remaining:

- **Screenshots:** a real capture of each of the five steps from the app, beside its text, once the captures are made on a release build.
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

