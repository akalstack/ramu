# Deploying an app

Ramu deploys a project to a hosting platform on your own account. It hosts nothing itself: the app, its deployments, its database and their billing stay with the providers, and the repository stays a normal GitHub repository. Vercel and Netlify host apps; Neon provides Postgres databases.

## Connect an account

**Settings → Git → Hosting accounts** lists Vercel, Netlify and Neon with their marks. **Connect** offers two ways, in this order:

1. **Sign in with Vercel** or **Sign in with Netlify**, when the platform's CLI (`vercel` or `netlify`) is installed on the host. Ramu runs the CLI's own browser sign-in on the host and shows its link (and Vercel's code) in Settings; **Open the sign-in page**, sign in and authorize. Ramu then reads the token the CLI saved, checks it with the platform and shows the account name. The CLI runs against a private configuration folder that is deleted afterwards, so your own CLI login is not read, changed or signed out.
   - Vercel's sign-in is a session that renews itself; Ramu renews it before it expires. A Vercel CLI that signs in with a key bound to the computer cannot be used; use a token instead.
2. **A token**, when there is no CLI or the sign-in fails (a team that blocks CLI logins, single sign-on). **Open the token page** goes to the platform's token page, and a short checklist says what to pick: name it Ramu, the smallest scope (on Vercel, the team your projects are in rather than Full Account), and an expiry. Paste it into the secret field: it goes straight to the host's credential store, is checked with the platform on the spot, and is never shown again. Settings shows the account, an expiry date, and a note when a Vercel token reaches your whole account.

Neon connects with an API key only: create a personal key named Ramu on Neon's API keys page and paste it. Neon keys reach your whole account and do not expire, so revoke it on Neon when Ramu no longer needs it.

Agents never create tokens by driving your browser: a signed-in dashboard gives full account power, and a new token would end up in screenshots and the transcript.

Hosting accounts are added, replaced and removed only on the computer running the host. Paired devices see their status: the phone shows each platform's account under **GitHub on this host**, and a project's deployments under **Deployments** ([On the phone](#on-the-phone)). **Disconnect** deletes Ramu's copy only; to revoke the token itself, delete it on the platform.

The same accounts publish artifacts with **Publish to the web** ([Artifacts](artifacts.md)).

## Deploy a project

**Deploy…** in a project's menu opens the deploy sheet.

- **Link repository:** pick the platform (the one the project's stack names in `ramu.json` is recommended, see [Configuration](configuration.md)) and, with several, the repository. The repository must be on GitHub. Ramu links them through the platform's Git integration: every pull request gets a preview deployment, and pushes to the default branch deploy to production, with no deploy token in CI.
  - **Vercel** creates the project (named after the Ramu project) or links an existing one of that name. Vercel's GitHub app must be installed for the repository; the sheet says so when it is not.
  - **Netlify** creates the site and, through the repository's GitHub account in Settings, adds a read-only deploy key and a build webhook to the repository, as Netlify's own CLI does.
- **Once linked**, the sheet shows the platform, the live address with **Open**, and the latest deployments with their state, branch and commit message. **Logs** shows the end of a deployment's build log.
- **Deploy to production** builds the default branch. It asks once more, naming the address that changes, before anything starts.
- **Roll back** on an earlier production deployment makes it live again, after a confirmation naming the address.
- **Environment variables** lists the variables the app reads (names in `.env.example`, `.env.sample` or `.env.template`, and code that reads `process.env`, `import.meta.env`, `os.environ`, `ENV` or `os.Getenv`) next to where each is set: this host's **Environment variables** ([Providers](providers.md#environment-variables)), GitHub Actions repository secrets, and the platform's preview and production variables. **Sync** copies each value this host has to the places that lack it; values already set elsewhere are not changed. A variable this host has no value for is named, so you can add it in Settings (or an agent can ask for it with `request_secret` and keep it), then sync again. Values are never shown, only names, on this computer and on paired devices.
- **Domains** lists the project's custom domains (Vercel and Netlify). Type a name such as `www.example.com` and press **Add domain**: Ramu asks the platform to add it and shows, in plain words, each DNS record to create ("At your domain provider, add a CNAME record named www pointing to …"), including the ownership record Vercel asks for when the domain is used elsewhere. A domain itself (`example.com`) gets an A record named `@`.
  - When the domain's DNS is hosted by the same platform (Vercel DNS or Netlify DNS, on the connected account), **Create records** makes them after one confirmation naming the change.
  - Each domain shows **Waiting for DNS**, **Waiting for the HTTPS certificate** or **Live over HTTPS**. Where the platform does not report a step, Ramu checks it from the host: public DNS for the records, then an HTTPS request to the domain once the DNS points at the platform.
  - Ramu checks a newly added domain every minute for up to three days, and when it serves HTTPS it wakes the project's most recent thread with one message, through the same queue as pull request feedback.
- **Checks** says whether the repository has CI and offers **Set up CI** when it has none ([Set up CI](git-hosting.md#set-up-ci)).

## When a deployment finishes

Ramu follows a deployment until the platform finishes it, then wakes one thread with one message, through the same queue as pull request feedback:

- **What starts it:** a deploy from Ramu (**Deploy to production**, `deploy_production` or `deploy_preview`); a push of the production branch from a thread (**Push** or **Sync**) to the repository the platform watches; and **Merge…** of a pull request into that branch. For a push, Ramu finds the platform's production deployment of the pushed commit; for a merge, the first production deployment that starts after it.
- **Which thread:** the one that deployed, pushed or is linked to the merged pull request, or the project's most recent thread when there is none or it was closed since.
- **What it says:** the live address when the deployment is ready; when it fails, the deployment and the end of its build log, with anything that looks like a secret replaced by `[redacted]`, so the agent can find the cause and propose a fix. A failed production deployment leaves the previous one live.
- **Migrations:** a push or merge that the platform deploys on its own runs no migration from Ramu. When `ramu.json` names a `migrate` command, the message says so, and the agent offers **Deploy to production** (through `deploy_production`, which runs the migrations first) if the change adds one.
- A push the platform has not started deploying within 20 minutes, or a deployment still building after two hours, is no longer followed. A push replaced by a newer one is followed through the newer push.

Pushes made outside Ramu, such as from a terminal or GitHub's website, are not followed. For those, a **Deployment failed** [webhook schedule](background-work.md#when-a-request-arrives) for Vercel or Netlify starts a thread instead.

## On the phone

**Deployments** in a project's menu on the phone shows the platform and repository, the live address with **Open**, the latest deployments with their state, branch, time and **Open**, the [uptime](#uptime) watch with any open incident, and [usage](#usage) with **Open billing**. **Roll back** on an earlier production deployment asks first, naming the version and the address that changes, as in the deploy sheet. Linking, deploying, domains, databases and the watch's switch are on a computer. Viewer pairings do not see deployments.

## Usage

**Usage this billing period** in the deploy sheet shows what the project's platforms report through their APIs, next to the plan's limit when the API reports one. **Open billing** opens the platform's billing page. Ramu never changes a plan or adds a payment method, and neither can an agent.

| Platform | Figures | Limit |
| --- | --- | --- |
| Vercel | Each service's usage this calendar month (such as data transfer and function invocations), summed from Vercel's billing charges, for the account or team the project is linked under | Not reported by Vercel's API; **Open billing** shows it |
| Netlify | The team's build minutes for the billing period | The minutes included in the plan, with any add-on packs |
| Neon | The main branch's size, compute time and data transfer for the billing period (Neon's own counters, which lag a little) | Storage against Neon's branch size limit; compute against the plan's compute time; transfer has none |

When the API reports no figures for an account or plan (Vercel refuses billing data to some roles; Netlify plans billed in credits have no build minutes), the sheet says so instead of showing numbers.

Every six hours the host reads the same figures. A figure with a reported limit that reaches 80%, and again at 100%, raises one notice per billing period in the notifications (on the phone, under **Missed**), naming what grows and the cheapest fix, such as building only when the app's files change, or deleting data and branches the app no longer needs. The notice opens the project's most recent thread, where an agent can read the figures with `deploy_usage` and propose a fix as a pull request.

## Uptime

Once a project has a live production deployment, **Watch the live address** in the deploy sheet is on. Untick it to stop the checks.

- **What is checked:** every five minutes, the host sends one `GET` to the production address and the project's health path (`"healthPath"` in the stack of `ramu.json`, such as `"/api/health"`; `/` by default). An answer within 10 seconds that is a success, a redirect, or a sign-in or rate-limit page counts as up. Redirects are followed on the same host name only; a redirect to another host is an answer and is not followed. The sheet shows the last check with its status code and response time.
- **Incidents:** two failed checks in a row open a thread in the project titled **Down: …**, with the status code or the reason there was no answer, the response time, the last production deployment and the end of its build log, and notify your phones (the phone's **Failed** notifications). The thread uses the model of the project's most recent thread, with at most Auto access. Its agent reads the logs first and, when the last deploy is the likely cause, offers **Roll back** through `deploy_rollback`, whose card always asks you. A project has at most one open incident.
- **Recovery:** the first good check after an incident posts into the same thread, which answers with a short recap of what failed and what was done. The incident is then closed.
- **When the host cannot tell:** checks run only while this computer is awake and Ramu is running. A gap of more than eleven minutes between checks is shown as **Unknown** with its start and end, not as downtime, and failed checks before and after it are not counted together. A check with no answer while the hosting platform's API cannot be reached either means this computer is offline, and is counted as unknown too.

Turning the watch off forgets its checks and closes an open incident without a recap.

## Databases

The deploy sheet shows **Database** when the project needs one: its stack stores data (`"database": true` in `ramu.json`, set for the Next.js, Django and Rails stacks), or its code reads `DATABASE_URL`.

- **Provision** creates a Neon Postgres project named after the Ramu project on your connected Neon account, and a `preview` branch of it (a copy that shares storage until it changes). Production uses the main branch; preview deployments, this host and GitHub Actions use the `preview` branch, so they never change production data.
- Ramu keeps both branches' connection values in the host's credential store and sets the preview branch's `DATABASE_URL` (pooled, for the app) and `DATABASE_URL_UNPOOLED` (direct, for migrations) in this host's Environment variables. **Sync** in **Environment variables** then copies them on: the main branch's values to the platform's production variables, the preview branch's to its preview variables and GitHub Actions. The sheet shows names only.
- Once provisioned, the sheet shows the database, and **Open** for its page on Neon; its size and compute time are under [Usage](#usage). Resizing and deleting it are done on Neon's page; neither the sheet nor an agent deletes a database.
- **Migrations:** when `ramu.json` names a `migrate` command (the Django and Rails stacks fill it in), **Deploy to production** and `deploy_production` first run it on this host against the production database, in the repository's checkout of the production branch. The checkout must be on that branch at the commit pushed to GitHub, so the migrations match what deploys. A failed migration stops the deploy: the sheet shows its output, and the project's most recent thread is woken with it to find a fix. Pushes to the default branch that the platform deploys on its own do not run migrations from Ramu; the thread woken when that deployment finishes is told so.

The project stays linked to the account that linked it. If you connect a different account later, deploy actions are refused until you connect that account again or link the project again.

## Agents

Threads in a project get deploy tools for that project, on its linked platform and account:

- `deploy_status`: the target, live address, what the platform can do, and the latest deployments.
- `deploy_logs`: the end of a deployment's build log.
- `deploy_preview`: a preview deployment of the thread's current branch (Vercel; Netlify builds previews from pull requests). Outside Full access it asks first. The thread is woken when it finishes, as after `deploy_production` ([When a deployment finishes](#when-a-deployment-finishes)).
- `deploy_domains`: the project's domains, the records each needs and whether it is live.
- `deploy_usage`: what the platform and database report for the billing period, beside the plan's limits, and the billing page. Read-only.
- `deploy_domain_add` and `deploy_domain_records`: add a domain, or create its records in the platform's DNS. They always ask you with a card naming the domain and each record, in every access mode, and the thread is woken when the domain is live.
- `deploy_production` and `deploy_rollback`: always ask you with an approval card naming the address and what changes, in every access mode. A refusal is final for that request.

`deploy_production` runs the project's migrations first, and a failed migration returns its output to the agent instead of deploying. Agents cannot create or delete databases.

A deploy whose reply never arrives is not retried: Ramu reads the deployment list again and reports the deployment it finds, so a retry never deploys twice.
