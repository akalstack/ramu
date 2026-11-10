# Shipping an app

From one sentence on Home to a live app on your own accounts, with CI and previews for every later change. This page is the path; each step links to the page with the details. Ramu hosts nothing itself: the repository, the hosting, the database and their bills stay yours.

## 1. Start something new

Type what you want into Home's message box, such as "a booking page for my barbershop where customers pick a time and I get an email".

- With **Auto** and no project that fits, Home offers **New project** first. On the desktop, **New project…** in the Project picker does the same, and a host with no projects shows **Start something new** ([Home](inbox.md#home)).
- The agent asks at most three questions it cannot work out itself (a website or a phone app, sign-in, stored data), then names the stack in one line, such as "Next.js with TypeScript, deployed on Vercel". Ramu picks the smallest stack that does the job: plain HTML before a framework, a full framework only for sign-in or stored data.
- To skip the questions on the desktop, give the project a name (and a stack, if you know it): Ramu creates the project itself and the thread starts there with your message.

## 2. The project

Ramu creates a folder beside your other repositories (or where you put it with **Change…** on the desktop, or in the folder you tell the agent), runs the framework's own generator (Next.js, Vite, Astro, Expo, Hono, Django, FastAPI or Rails; a static site and a Go service start from files the agent writes), writes the stack's commands to `ramu.json` ([Configuration](configuration.md#repository-settings)) and commits. The thread moves into the new project and keeps working toward a [goal](goals.md) checked by the project's build and tests ([Threads started by agents](working-with-agents.md#threads-started-by-agents)). The agent starts the dev server as a [background command](background-work.md#background-commands) and opens the app in the [browser](browser-and-computer.md#browser), so you see it while it is built.

When the agent needs something only you know, such as an API key, it asks with a masked card and can keep it for later threads ([Secrets agents ask for](working-with-agents.md#secrets-agents-ask-for)).

## 3. Put it on GitHub

Deploys and CI work from a GitHub repository. **Publish to GitHub** in Source Control creates one on your account (private by default) and pushes the project.

## 4. Deploy

**Deploy…** in the project's menu opens the Deploy sheet. **Set up deploy** names the platform the stack suits (Vercel, Netlify, Railway, Fly.io or Cloudflare) and its plugin, and opens the install review or the plugin's card until it is installed with its token ([Set up a platform](deploy.md#set-up-a-platform)). Then ask the project's agent to deploy: it writes the platform's config and runs the platform's CLI with your token through `platform_cli` ([Deploying](deploy.md#deploying)).

- **Previews** run without asking.
- **Production** always asks you with a card, in every access mode: **Allow once**, or allow production deploys for the rest of the thread. The project's migrations run first against the production database address saved in the sheet, and a failed migration stops the deploy ([Migrations first](deploy.md#migrations-first)).
- An Expo app ships through the app stores with EAS, which the agent runs like any other CLI; Ramu never submits an app for store review.

## 5. What the app needs

The same sheet covers the rest:

- **Live address:** where people use the app, which the host watches ([Live address and uptime](deploy.md#live-address-and-uptime)).
- **Production database:** the address migrations run against, saved on the host and never shown again ([Migrations first](deploy.md#migrations-first)).
- **Checks:** **Set up CI** opens a pull request with a workflow made from the project's own scripts, and can require CI to pass before merging on GitHub ([Set up CI](git-hosting.md#set-up-ci)).

## 6. Every later change

The agent works on a branch and opens a pull request. Its card in Source Control and on the phone shows the checks, where a platform connected to the repository reports its preview ([The Pull requests page](git-hosting.md#the-pull-requests-page)). Merging deploys it.

- **After a push or merge from a thread**, Ramu follows the checks on that commit, CI and platform deploys alike, and wakes the thread once: a short note with the links when they pass, the failing checks with their logs when one fails ([After a push](deploy.md#after-a-push)).
- **Latest deploy** in the Deploy sheet shows the checks on the default branch's newest commit, as the Git host reports them ([The latest deploy](deploy.md#the-latest-deploy)).

## 7. Keep it running

- **Uptime:** the host checks the live address every five minutes. Two failed checks open a **Down:** thread and notify your phone; its agent finds the latest deploy and can offer a rollback through the platform's plugin, which asks you, and recovery posts a recap ([Live address and uptime](deploy.md#live-address-and-uptime)).
- **On the phone:** **Deploy** in a project's menu shows the latest deploy's checks, the uptime watch with its switch, and the production database's state ([On the phone](deploy.md#on-the-phone)).

## Coming from an existing project

Every step works on its own: **Deploy…** on any project, or **Set up CI…** alone. Agents in any project deploy through the platform's plugin with `platform_cli` ([Deploying](deploy.md#deploying)).
