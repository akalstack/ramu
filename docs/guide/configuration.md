# Configuration

## Host settings

The host keeps its settings in `settings.json` in its data folder, beside `ramu.db`. Settings writes it. You can also edit it by hand, and Ramu reloads it. An invalid file is ignored and the last valid settings stay active. Keep it private. It can hold provider paths and account configuration.

```json
{ "language": "en", "accent": "teal", "defaultCheckoutMode": "worktree" }
```

### Defaults and Advanced

On the desktop and the phone, the reset button at the foot of a Settings page asks first, then resets every row on that page. Rows few people change, such as how long archived threads and unused memories are kept, sit under a closed **Advanced** fold. Searching for one opens it.

### Asking an agent to change a setting

Say what you want ("stop warning before I change model", "keep 12 recent threads per project") and the thread's agent changes it:

- `settings_find` searches the same titles and words as Settings search and returns each row's page, help, current value and allowed values.
- `settings_change` puts the change in a card in the thread: each row's title, old value → new value, its page, and the agent's reason. In **Full access** it applies at once and the card offers **Undo**. In the other access modes the card waits for **Apply**, **Open in Settings** or **Dismiss**. Undo is refused, with **Open in Settings**, if you changed that row since. Apply is refused the same way if the row changed after the agent asked.
- Applying from a paired phone needs that phone's **Change settings** permission on the host.
- On the desktop and the phone, a Settings row an agent changed shows a dot and **Changed by an agent in** *thread name*, which opens the thread, until you change the row yourself.

Agents never change what widens what agents may do or who can reach the host: **Default access**, **Let agents start threads**, **Ask before using another provider**, provider logins and executables, abilities routed to Shared MCP tools, and everything without a typed setting (Permissions and saved approvals, Remote access, pairing and device permissions, Identities, Account, environment variables, **Computer use** and **Let agents use test devices**). `settings_find` still lists these, marked for you to change, with the page to open, so the agent points you to the right row. Claude's file tools refuse `settings.json` and the rest of the data folder (apart from the thread's own folders), so the card is the only way an agent changes settings.

## Repository settings

An optional `ramu.json` at a project's root (or `.ramu/config.json`) shares team defaults. Ramu reads it without running anything, and ignores credentials, paths and permissions in it.

```json
{
  "actions": [{ "id": "test", "name": "Test", "command": "pnpm test", "keys": "mod+shift+t" }],
  "agent": { "preferredProvider": "codex" },
  "workspace": { "defaultCheckoutMode": "worktree", "branchPrefix": "feat/" },
  "commit": { "commitStyle": "conventional" },
  "abilities": { "image_generation": "off", "web_search": { "provider": "claude-code", "model": "" } },
  "stack": { "id": "nextjs", "dev": "npm run dev", "build": "npm run build", "test": "npm run lint" }
}
```

- **Actions** appear in the project menu and run only when you choose them. **Manage actions** reorders and hides them for this host.
- **Default model** applies to new threads until you pick another. If it isn't available, Ramu asks you to choose.
- **Workspace** and **commit** fields override the host's defaults for this project.
- **Abilities** override **Settings → Models → Abilities** for threads in this project, ability by ability: `"auto"`, `"off"`, or one provider and model (an empty model uses the one its check ran on). An ability turned off here is refused with this file named as the reason ([Abilities](working-with-agents.md#abilities)).
- **Stack** says how to run, build and test the project. New threads in the project read it, so the agent uses these commands without being told. A project Ramu creates gets it filled in. `"migrate"` (an argument list, such as `["npx", "prisma", "migrate", "deploy"]`) runs against the production database before each production deploy ([Migrations first](deploy.md#migrations-first)). `"healthPath"` (such as `"/api/health"`) is the path the uptime watch checks on the live address ([Live address and uptime](deploy.md#live-address-and-uptime)).

## Local diagnostics

See [Diagnostics](diagnostics.md).
