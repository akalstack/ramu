# Deploying an app

Ramu deploys a project to a hosting platform on your own account. It hosts nothing itself: the app, its deployments and its billing stay with the platform, and the repository stays a normal GitHub repository. Vercel and Netlify are supported.

## Connect an account

**Settings → Git → Hosting accounts** lists Vercel and Netlify with their marks. **Connect** offers two ways, in this order:

1. **Sign in with Vercel** or **Sign in with Netlify**, when the platform's CLI (`vercel` or `netlify`) is installed on the host. Ramu runs the CLI's own browser sign-in on the host and shows its link (and Vercel's code) in Settings; **Open the sign-in page**, sign in and authorize. Ramu then reads the token the CLI saved, checks it with the platform and shows the account name. The CLI runs against a private configuration folder that is deleted afterwards, so your own CLI login is not read, changed or signed out.
   - Vercel's sign-in is a session that renews itself; Ramu renews it before it expires. A Vercel CLI that signs in with a key bound to the computer cannot be used; use a token instead.
2. **A token**, when there is no CLI or the sign-in fails (a team that blocks CLI logins, single sign-on). **Open the token page** goes to the platform's token page, and a short checklist says what to pick: name it Ramu, the smallest scope (on Vercel, the team your projects are in rather than Full Account), and an expiry. Paste it into the secret field: it goes straight to the host's credential store, is checked with the platform on the spot, and is never shown again. Settings shows the account, an expiry date, and a note when a Vercel token reaches your whole account.

Agents never create tokens by driving your browser: a signed-in dashboard gives full account power, and a new token would end up in screenshots and the transcript.

Hosting accounts are added, replaced and removed only on the computer running the host. Paired devices see their status: the phone shows each platform's account under **GitHub on this host**. **Disconnect** deletes Ramu's copy only; to revoke the token itself, delete it on the platform.

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
- **Checks** says whether the repository has CI and offers **Set up CI** when it has none ([Set up CI](git-hosting.md#set-up-ci)).

The project stays linked to the account that linked it. If you connect a different account later, deploy actions are refused until you connect that account again or link the project again.

## Agents

Threads in a project get deploy tools for that project, on its linked platform and account:

- `deploy_status`: the target, live address, what the platform can do, and the latest deployments.
- `deploy_logs`: the end of a deployment's build log.
- `deploy_preview`: a preview deployment of the thread's current branch (Vercel; Netlify builds previews from pull requests). Outside Full access it asks first.
- `deploy_production` and `deploy_rollback`: always ask you with an approval card naming the address and what changes, in every access mode. A refusal is final for that request.

A deploy whose reply never arrives is not retried: Ramu reads the deployment list again and reports the deployment it finds, so a retry never deploys twice.
