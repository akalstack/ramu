# Shipping an app

From one sentence on Home to a live app on your own accounts, with CI and previews for every later change. This page is the path; each step links to the page with the details. Ramu hosts nothing itself: the repository, the hosting, the database and their bills stay yours.

## 1. Start something new

Type what you want into Home's message box, such as "a booking page for my barbershop where customers pick a time and I get an email".

- With **Auto** and no project that fits, Home offers **New project** first. On the desktop, **New project…** in the Project picker does the same, and a host with no projects shows **Start something new** ([Home](inbox.md#home)).
- The agent asks at most three questions it cannot work out itself (a website or a phone app, sign-in, stored data), then names the stack in one line, such as "Next.js with TypeScript, deployed on Vercel". Ramu picks the smallest stack that does the job: plain HTML before a framework, a full framework only for sign-in or stored data.
- To skip the questions on the desktop, give the project a name (and a stack, if you know it): Ramu creates the project itself and the thread starts there with your message.

## 2. The project

Ramu creates a folder beside your other repositories, runs the framework's own generator (Next.js, Vite, Astro, Expo, Hono, Django, FastAPI or Rails; a static site and a Go service start from files the agent writes), writes the stack's commands to `ramu.json` ([Configuration](configuration.md#repository-settings)) and commits. The thread moves into the new project and keeps working toward a [goal](goals.md) checked by the project's build and tests ([Threads started by agents](agents.md#threads-started-by-agents)). The agent starts the dev server as a [background command](background-work.md#background-commands) and opens the app in the [browser](browser-and-computer.md#browser), so you see it while it is built.

When the agent needs something only you know, such as an API key, it asks with a masked card and can keep it for later threads ([Secrets agents ask for](agents.md#secrets-agents-ask-for)).

## 3. Put it on GitHub

Deploys and CI work from a GitHub repository. **Publish to GitHub** in Source Control creates one on your account (private by default) and pushes the project.

## 4. Deploy

Connect an account once in **Settings → Git → Hosting accounts**, with the platform's own sign-in where its CLI is installed, or a token through a guided page ([Connect an account](deploy.md#connect-an-account)). Then **Deploy…** in the project's menu opens the deploy sheet, which recommends the platform the stack names when Ramu can deploy to it.

| Target | What Ramu sets up | Details |
| --- | --- | --- |
| Vercel or Netlify | Links the platform to the repository: a preview for every pull request, and production from every push to the default branch | [Deploy a project](deploy.md#deploy-a-project) |
| Railway, Fly.io, Cloudflare or Supabase | The agent writes the platform's config and runs its own CLI with your connected account; each command that changes anything asks you first | [Railway, Fly.io, Cloudflare and Supabase](deploy.md#railway-flyio-cloudflare-and-supabase) |
| App Store and Google Play | For an Expo app: the store checks, an `eas.json` pull request, and **Release** to TestFlight and Play's internal track | [Store releases](deploy.md#store-releases) |

**Deploy to production**, **Roll back**, adding a domain, creating DNS records and **Release** are always yours: in the sheet you confirm them, and an agent asking for one shows an approval card in every access mode. Ramu never submits an app for store review.

## 5. What the app needs

The same sheet covers the rest:

- **Environment variables:** the variables the app reads, next to where each is set (this host, GitHub Actions and the platform's preview and production). **Sync** copies the values this host has to the places that lack them ([Deploy a project](deploy.md#deploy-a-project)).
- **Database:** for a stack or code that stores data, **Provision** creates a Neon Postgres database on your account, with a separate branch for previews and development. Migrations named in `ramu.json` run before each production deploy from Ramu ([Databases](deploy.md#databases)).
- **Domains:** **Add domain** shows each DNS record in plain words, **Create records** makes them when the platform hosts your DNS, and the project's thread hears when the domain is live over HTTPS.
- **Checks:** **Set up CI** opens a pull request with a workflow made from the project's own scripts, and can require CI to pass before merging on GitHub ([Set up CI](git-hosting.md#set-up-ci)).

## 6. Every later change

The agent works on a branch and opens a pull request. Its card in Source Control and on the phone shows the checks and, on Vercel or Netlify, the preview address ([Pull requests in Source Control](git-hosting.md#pull-requests-in-source-control)). Merging deploys it.

- **When a deployment finishes**, Ramu wakes the thread that deployed, pushed or merged, with the live address or the end of the build log ([When a deployment finishes](deploy.md#when-a-deployment-finishes)). For pushes from outside Ramu, a **Deployment failed** webhook schedule starts a thread instead ([When a request arrives](background-work.md#when-a-request-arrives)).
- **When CI breaks the default branch** after a push from a thread, the failing jobs go back to that thread ([Set up CI](git-hosting.md#set-up-ci)).

## 7. Keep it running

- **Uptime:** the host checks the live address every five minutes. Two failed checks open a **Down:** thread with the status, the last deployment and its build log, and notify your phone; its agent can offer **Roll back**, and recovery posts a recap ([Uptime](deploy.md#uptime)).
- **Usage:** the sheet shows what the platform and database report for the billing period beside the plan's limits. A figure at 80% and at 100% raises a notice that opens the project's thread, where the agent can propose a fix ([Usage](deploy.md#usage)).
- **On the phone:** **Deployments** in a project's menu shows the live address, the latest deployments, the uptime watch and usage, with **Roll back** ([On the phone](deploy.md#on-the-phone)).

## Coming from an existing project

Every step works on its own: **Deploy…** on any project with a GitHub repository, or **Set up CI…** alone. Agents in the project use the same steps through their deploy tools ([Deploys](agents.md#deploys)).
