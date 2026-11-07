# Configuration

## Host settings

The host keeps its settings in `settings.json` in its data folder, beside `ramu.db`. Settings writes it; you can also edit it by hand, and Ramu reloads it. An invalid file is ignored and the last valid settings stay active. Keep it private: it can hold provider paths and account configuration.

```json
{ "language": "en", "accent": "teal", "defaultCheckoutMode": "worktree" }
```

## Repository settings

An optional `ramu.json` at a project's root (or `.ramu/config.json`) shares team defaults. Ramu reads it without running anything, and ignores credentials, paths and permissions in it.

```json
{
  "actions": [{ "id": "test", "name": "Test", "command": "pnpm test", "keys": "mod+shift+t" }],
  "agent": { "preferredProvider": "codex" },
  "workspace": { "defaultCheckoutMode": "worktree", "branchPrefix": "feat/" },
  "commit": { "commitStyle": "conventional" },
  "stack": { "id": "nextjs", "dev": "npm run dev", "build": "npm run build", "test": "npm run lint", "deployTarget": "vercel" }
}
```

- **Actions** appear in the project menu and run only when you choose them. **Manage actions** reorders and hides them for this host.
- **Default model** applies to new threads until you pick another; an unavailable one asks you to choose.
- **Workspace** and **commit** fields override the host's defaults for this project.
- **Stack** says how to run, build and test the project and where it deploys. New threads in the project read it, so the agent uses these commands without being told. A project created by an agent gets it filled in. `"database": true` makes the deploy sheet offer a database, and `"migrate"` (an argument list, such as `["npx", "prisma", "migrate", "deploy"]`) runs before each production deploy from Ramu ([Deploying an app](deploy.md#databases)).

## Local diagnostics

See [Diagnostics](diagnostics.md).
