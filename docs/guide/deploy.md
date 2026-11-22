# Deploying an app

Agents deploy a project to a hosting platform on your own account. The app, its deployments, its database and their billing stay with the platform, and the repository stays a normal Git repository. Ramu has no code for any platform: an agent picks the platform, installs its [plugin](plugins.md) when one helps (`plugin_search`, `plugin_install`) and deploys with the plugin's MCP tools or the platform's CLI. Ramu keeps what an agent shouldn't decide alone: going to production, the migrations before it, and watching the result.

## Signing in to a platform

The agent signs in the way the platform's plugin or CLI says. When it needs a token only you can give, such as `VERCEL_TOKEN`, it asks with a masked card that links to the page where you create one, and can keep it for later threads ([Secrets agents ask for](working-with-agents.md#secrets-agents-ask-for)). A plugin that runs a CLI through `platform_cli` (Ramu's **fly-cli** for Fly.io) keeps its token on the host, pasted on its card in **Customize → Plugins**; the agent never sees it.

## Deploying

Ask the project's agent to deploy. It writes the platform's own setup (`vercel.json`, `netlify.toml`, `railway.json`, `fly.toml`, `wrangler.jsonc`), commits it like any change, then deploys with the plugin's MCP tools or the platform's CLI. Ramu recognises a deploy from the action itself, the same way on every path: a command in the agent's shell (also through `npx`, `pnpm dlx`, `bunx`, a `bash -c` line or a chain with `&&`), a CLI run through `platform_cli`, or an MCP tool whose name says deploy, redeploy, rollback or promote (or creates a deployment) and isn't marked read-only.

- **Previews follow the normal rules.** `vercel deploy`, `netlify deploy`, `wrangler versions upload`, `wrangler pages deploy --branch …`, `firebase hosting:channel:deploy`, or a deploy tool whose arguments name a preview, staging or development target runs or asks like any other command in the thread's access mode.
- **Production asks first, in every access mode.** `vercel --prod`, `vercel promote` or `rollback`, `netlify deploy --prod`, `wrangler deploy`, `railway up`, `fly deploy`, `supabase db push`, `firebase deploy`, `gcloud run deploy`, and any other deploy tool show a card naming the action. **Allow once** allows that one deploy. **Allow production deploys in this thread** allows the rest of this thread's production deploys until it ends or Ramu restarts. No saved project or user rule lets a production deploy through, and an MCP tool set to **Allow** still asks. A refusal is final for that request.
- **Through `platform_cli`** (Fly.io), the CLI runs in the thread's checkout with the token in its environment, never in its arguments, and the token shows as `[token]` in anything the CLI prints. The CLI gets its own home folder, so your own CLI login isn't read or changed. Commands that only read (such as `status`, `logs` and `--help`) run straight away. Every other command shows a card naming it.

Where Ramu sees the action:

| Agent | Shell commands | MCP tools |
| --- | --- | --- |
| Claude Code | Every access mode, also over an allow rule of your own | Shared through Ramu: always |
| Codex | Every access mode; under **Auto**, a deploy needs the network Codex's sandbox doesn't have, so it asks Codex's way and reaches the card | Shared through Ramu: always |
| OpenCode, Antigravity | Every access mode | Shared through Ramu: always |
| Cursor | Not seen: Cursor gives no approval callback. Outside **Full access** its sandbox has no network, so a deploy can't go out; under **Full access** it runs without a card | Shared through Ramu: always |

MCP servers set up only in a provider's own configuration, not through Ramu, are outside Ramu's view.

## Migrations first

When `ramu.json` names a `migrate` command (the Django and Rails stacks fill it in), an allowed production deploy first runs it on this host, in the thread's checkout, with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` set to the project's production database address and nothing else from Ramu's environment. The deploy waits for it. A failed migration stops the deploy: nothing goes out, the request is refused, and the thread shows the end of the output (with the address and anything that looks like a secret replaced) so the agent can find the cause.

**Production database** in the project's **Live app…** sheet keeps that address. **Add address** works only on the host's own computer. The address goes straight to the host's credential store and is never shown again. The sheet says whether one is saved and which command runs, with **Replace address** and **Forget**. Without a saved address, a production deploy of a project with a `migrate` command is refused with where to add one.

## The latest deploy

Platforms connected to a repository through their Git integration (Vercel, Netlify, Railway, Cloudflare, Render, GitHub Pages) report each deploy on the commit as a check or a commit status. **Latest deploy** in the **Live app…** sheet shows the checks on the newest commit of each repository's default branch, with each one's state and **Open** for its link, so it works for any platform. Ramu reads GitHub's check runs and commit statuses, and GitLab's pipeline jobs. A repository not on a Git host yet offers **Publish to GitHub…** first. A platform that deploys only from its CLI, without a Git integration, reports nothing here, and the agent gives you its address instead.

## After a push

When a thread pushes (**Push** or **Sync** in Source Control, a `git push` the agent runs in its own shell, or **Merge…** of a pull request into the default branch), Ramu follows the checks on the pushed commit, CI and platform deploys alike. When they finish it wakes that thread once, through the same queue as pull request feedback:

- **All passed:** a short note listing the checks with their links. The agent replies in one line, with the deploy's address when there is one.
- **One failed:** the failing checks with the end of their logs, treated as external text, so the agent can find the cause and propose a fix. A fix for the default branch goes on a new branch.

This works on GitHub and GitLab. Only the newest push of a branch is followed. A push with no checks after 20 minutes, or checks still running after three hours, is dropped. A branch whose pull request is [watched](git-hosting.md#github) is left to that watch. Pushes made outside Ramu aren't followed.

## Live address and uptime

**Live address** in the project's **Live app…** sheet is where people use the app, such as `https://shop.example.com`. Save it there, edit it later, or clear it with **Forget**. Without a saved address, Ramu uses the production deployment your Git host records (GitHub or GitLab), then the lasting address of an app [run on this computer](#on-this-computer). While **Watch the live address** is on (the default), the host checks it:

- **What is checked:** every five minutes, one `GET` to the address and the project's health path (`"healthPath"` in the stack of `ramu.json`, such as `"/api/health"`; `/` by default). An answer within 10 seconds that is a success, a redirect, or a sign-in or rate-limit page counts as up. Redirects are followed on the same host name only. The sheet shows the last check with its status code and response time.
- **Incidents:** two failed checks in a row open a thread in the project titled **Down: …**, with the status code or the reason there was no answer, and notify your phones. The thread uses the model of the project's most recent thread, with at most Auto access. Its agent finds the latest deploy from the Git host and reads its logs through the platform's plugin. When the last deploy is the likely cause, it offers to roll back, which asks you like any production deploy. A project has at most one open incident.
- **Recovery:** the first good check after an incident posts into the same thread, which answers with a short recap. The incident is then closed.
- **When the host can't tell:** checks run only while this computer is awake and Ramu is running. A gap of more than eleven minutes between checks shows as **Unknown** with its start and end, not as downtime. A check with no answer while github.com doesn't answer either means this computer is offline, and counts as unknown too.

Turning the watch off forgets its checks and closes an open incident without a recap.

## On this computer

For demos and home use, **Run on this computer** in the **Live app…** sheet publishes the project's app from this computer, with no account or server. **Publish from this computer** builds it into a Docker container (with the repository's Dockerfile, or one Ramu writes for the stack and passes to the build without adding it to the repository) and runs it with only its port published to this computer's loopback address. The app gets a public address through its own tunnel, of the kind chosen for artifacts opened to anyone (Cloudflare or ngrok without a fixed domain). The address reaches only the app, never Ramu, and changes when Ramu restarts. The app is offline while the computer sleeps or Ramu isn't running, and an app left published starts again with Ramu. **Stop** takes the address down first, then the container. Of this host's saved Environment variables, the app gets only the ones its code reads. Docker must be installed and running.

Without Docker, **Run without Docker…** first says what it means, then runs a Node app with a `start` script as a program here. It installs dependencies when there's no `node_modules`, runs the `build` script if there is one, and starts the app with `PORT` and `HOST` set to a loopback port. The tunnel names it once the app answers there. The program gets the project's variables and none of Ramu's environment, but it has your own permissions, so use it only for code you trust. **Stop** ends its whole process group, and a program that exits takes its address down and shows the end of its output.

**Give it a lasting address…** keeps one hostname across restarts instead of a new quick-tunnel address each time. Enter a hostname on a domain in your Cloudflare account and a Cloudflare token with **Account → Cloudflare Tunnel → Edit** and **Zone → DNS → Edit**. Ramu creates a Cloudflare Tunnel whose only route is that hostname to one fixed port on this computer (anything else gets 404), adds its DNS record, and runs `cloudflared` with the tunnel's own token whenever the app is published. It can't reach Ramu's own port, and a wildcard hostname is refused. **Remove** deletes the record and the tunnel.

## On the phone

**Live app** in a project's menu on the phone shows the latest deploy's checks with **Open**, the live address watch with any open incident and its switch, and whether a production database address is saved and which migrate command runs. Saving the live address and adding the database address are done on a computer. Viewer pairings don't see it.
