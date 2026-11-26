# Shipping an app

From one sentence on Home to a live app on your own accounts, with CI and previews for every later change. Ask for all of it at once ("build a booking page for my barbershop and put it live") and the agent goes through steps 1 to 4 without stopping between them: it creates the project, builds it, publishes it to a private repository, deploys it and records the live address. It stops only for what is yours to decide: the questions in step 1, a token or secret on a masked card, and the first production deploy. Or take the steps one at a time. Each links to the details. Ramu hosts nothing: the repository, hosting, database and their bills stay yours.

## 1. Start something new

Type what you want into Home's message box, such as "a booking page for my barbershop where customers pick a time and I get an email".

- With **Auto** and no project that fits, Home offers **New project** first. On the desktop, **New project…** in the Project picker does the same, and a host with no projects shows **Start something new** ([Home](inbox.md#home)).
- The agent asks at most three questions it can't work out itself (a website or a phone app, sign-in, stored data), then names the stack in one line, such as "Next.js with TypeScript". Ramu picks the smallest stack that does the job and starts without a framework: plain HTML, TypeScript with Vite, or Node's own HTTP server. A framework comes in only for sign-in, stored data, many routed pages, or a phone or desktop app.
- To skip the questions on the desktop, give the project a name (and a stack, if you know it). Ramu creates the project and the thread starts there with your message.

## 2. The project

Ramu creates a folder beside your other repositories (or where you choose with **Change…** on the desktop, or where you tell the agent), runs the framework's own generator (Next.js, Vite, Nuxt, Astro, Expo, Hono, Django, FastAPI, Rails, Rust, Swift, Tauri, Electron or Flutter; a static site and a Go service start from files the agent writes; any other framework you name, such as SvelteKit, from its official create command the agent looks up and you approve), writes the stack's commands to `ramu.json` ([Configuration](configuration.md#repository-settings)) and commits. The thread moves into the new project and works toward a [goal](goals.md) checked by the project's build and tests ([Threads started by agents](working-with-agents.md#threads-started-by-agents)). The agent starts the dev server as a [background command](background-work.md#background-commands) and opens the app in the [browser](browser-and-computer.md#browser), so you see it while it's built.

When the agent needs something only you know, such as an API key, it asks with a masked card and can keep it for later threads ([Secrets agents ask for](working-with-agents.md#secrets-agents-ask-for)).

## 3. Put it on GitHub

**Publish to GitHub** in Source Control creates a repository on your account (private by default) and pushes the project. Asked to put the project live, the agent does this itself, always private; outside Full access it asks first. The latest deploy's checks and CI read from the Git host.

## 4. Deploy

Ask the project's agent to deploy. It picks a platform that suits the stack (Vercel, Netlify, Railway, Cloudflare, Fly.io and others), installs that platform's plugin if it helps, and asks you for a token with a card when it needs one. Ramu decides when to ask ([Deploying](deploy.md#deploying)):

- **Previews** follow the thread's access mode like any other command.
- **Production** always asks with a card: **Allow once**, or allow production deploys for the rest of the thread. The project's migrations run first, and a failed migration stops the deploy ([Migrations first](deploy.md#migrations-first)).

## 5. What the app needs

**Live app…** in the project's menu covers the rest:

- **Live address:** where people use the app, which the host watches ([Live address and uptime](deploy.md#live-address-and-uptime)). A deploy made while shipping to **Live in production** saves it for you.
- **Production database:** the address migrations run against ([Migrations first](deploy.md#migrations-first)).
- **Checks:** **Set up CI** opens a pull request with a workflow made from the project's own scripts ([Set up CI](git-hosting.md#set-up-ci)).

## 6. Every later change

The agent works on a branch and opens a pull request. Ask it to ship and it also fixes checks and handles review rounds until the project's finish line ([Shipping a change](git-hosting.md#shipping-a-change)). Its card in Source Control and on the phone shows the checks, including the preview a platform connected to the repository reports ([The Pull requests page](git-hosting.md#the-pull-requests-page)). With the platform connected to the repository, merging deploys it.

- **After a push or merge from a thread**, Ramu follows the checks on that commit and wakes the thread once, with the links or the failing logs ([After a push](deploy.md#after-a-push)).
- **Latest deploy** in **Live app…** shows the checks on the default branch's newest commit ([The latest deploy](deploy.md#the-latest-deploy)).

## 7. Keep it running

- **Uptime:** the host checks the live address every five minutes. Two failed checks open a **Down:** thread and notify your phone. Its agent finds the latest deploy and can offer a rollback, which asks you ([Live address and uptime](deploy.md#live-address-and-uptime)).
- **On the phone:** **Live app** in a project's menu shows the latest deploy, the uptime watch and the production database's state ([On the phone](deploy.md#on-the-phone)).

## Coming from an existing project

Every step works on its own: ask any project's agent to deploy, open **Live app…**, or run **Set up CI…** alone.
