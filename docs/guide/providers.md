# Providers

Ramu runs the agent tools you already use, with your own accounts.

## Setup

| Provider    | Install                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Claude Code | Install Claude Code and sign in                                                                |
| Codex       | Install Codex and sign in                                                                      |
| OpenCode    | Install OpenCode and configure a model provider                                                |
| Cursor      | **Login** in Settings (Cursor's browser sign-in), or set `CURSOR_API_KEY`                      |
| Antigravity | **Settings → Providers → Antigravity → Install runtime**, then **Login** with Google           |

A new profile opens a short setup that finds installed tools and offers their sign-ins. **Settings → Providers** handles sign-in, accounts, updates and executable paths (`RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN`, `RAMU_ANTIGRAVITY_BIN`). Ramu stores no provider passwords.

Each provider card shows whether its installed version is **Supported**, **Limited**, **Incompatible** or **Unverified**, with **Update** when a tested release exists.

## Models

The model picker lists each provider's models. **Legacy** marks an older version once a newer one of the same family is listed, or a model its provider calls deprecated or has retired; **Show legacy models** reveals them. **New** marks a model released in the last two weeks, and **Retires ‹date›** one whose retirement is announced within 90 days.

Release and retirement dates come from public model lists, [models.dev](https://models.dev) and [LiteLLM's](https://github.com/BerriAI/litellm), which each host reads once a day and keeps a small copy of. A daily read asks whether each list changed, so an unchanged one is not downloaded again, and one list failing keeps the other. Nothing about you is sent. Offline it uses its last copy.

When a provider starts offering a model your host has not seen it offer before, every device shows it once (**See models**), and the model list tags it **New** for two weeks when no release date says otherwise. Turning a provider on does not announce everything it has. **Tell me about new models** (Settings → Models) turns this off. **Look up model dates online** (Settings → Models) turns the lookups off; Legacy then comes from versions alone.

## Accounts

Every provider can hold several logins; the first enabled one in **Settings → Providers** applies to new threads. When a thread hits a limit, Ramu moves it on its own only to another login that uses an API key, before another model. It never switches to another subscription login by itself, because plan limits are meant for one person's ordinary use and providers' terms bar working around them; you can still pick any login yourself. A provider or login turned off starts nothing: new threads, threads continuing after a stop or restart, and fallback switches all refuse it and say why.

To pick a login yourself, open the model menu under the message box (on the phone, the model sheet): the **Account** row lists the provider's logins once more than one is turned on. Each is named by its label, else its sign-in email, marks a login that uses an API key, and says how much room it has for the thread's model, such as "58% of the weekly limit used" or "Limit reached · resets Thu 12:59", so you do not move to a login that is also at its limit. The thread moves over with its conversation. While a thread waits at a usage limit, a model or login you choose applies at once, so **Try anyway** and the automatic resume use it. Signing a login in, changing its key, or signing it in from a terminal and refreshing **Settings → Providers** updates its name and usage on every device. On the phone, **Settings → Providers** lists each login with how it signs in and turns logins on or off.

### API keys

Claude Code, Codex, Cursor and OpenCode logins can use an API key instead of a subscription: choose the key button on a login in **Settings → Providers** on the host. Usage is then billed to the key, and adding a login with a key gives a thread somewhere to continue when your plan's limit is reached. OpenCode asks which model provider the key is for. Codex keeps the key in its own login file; for the others the key stays in the host's OS credential store and reaches only that login's processes. **Remove key** returns the login to its subscription (for Codex, sign in again). Antigravity takes Gemini and Agent Platform keys in its own **Login** dialog.

## Environment variables

**Settings → Environment variables** adds variables to every provider process on the host, for all providers or one. Paste `.env` text to fill several rows. Values stay in the host's OS credential store and paired devices see only names. `RAMU_*` names are reserved.

## Access modes

- **Allow edits:** the agent edits files in the project and asks before other actions, where the provider supports asking.
- **Auto:** Ramu's own tools run without asking; everything else follows the provider's automatic review, so risky commands still ask.
- **Full access:** commands and edits run without asking, except the few that can destroy work or the machine: deleting outside the thread's folders, a whole project or `.git`; `git reset --hard`, `git clean -f`, force-pushes and other history rewrites; running as administrator; formatting disks; and shutting down. Those ask once each, with the reason, and cannot be saved as rules. Claude's own safety checks, and ask rules in your Claude settings, also still ask. Cursor's SDK cannot pause a command, so Cursor threads in Full access never ask. Use it only for work you trust.

Approvals default to **Allow once**. For a command you can save a prefix rule (such as `git diff *`) for the project or for every project, from the card in the thread on desktop or on the phone (**Don't ask again…**). A saved approval can be forgotten from the card. **Settings → Permissions → Saved approvals** lists and removes them.

## Plan usage

The sidebar footer shows, in one line, how much each provider's login in use has spent in its tightest window, the closest to a limit first; providers that do not fit show as **+N**, named when you hover it; with the sidebar hidden, the status bar shows the same as rings. Either opens **Plan usage**: a section per provider with a row for every login on every connected host, its windows side by side with their reset times, its plan, and the hosts it is signed in on, a dot marking each host whose threads use it. A login signed in on several hosts shows once, matched by its sign-in email; where a host does not know the email, logins whose limits and reset times are identical are merged and marked **Matched by its limits**. Percentages are never added together. Account names and emails stay hidden until you choose **Show accounts**, which this device remembers. Claude and Codex report their own usage; for Cursor and Antigravity Ramu reads the same services their apps use. **This week** adds finished turns, reported cost and tokens across hosts; hosts whose providers report no cost or tokens are named rather than counted as zero.

## Advisor

**Settings → Goals & delegation → Advisor** lets the agent ask a second model for an opinion. Each consultation sends the thread to that model and uses its tokens. Turn on **Always wait for advice** to pause while it answers.

## Provider notes

- Ramu supports OpenCode 2, which runs one `opencode serve` per thread. Antigravity uses ACP.
- Antigravity lists the models your Google plan offers, including its Claude and GPT models. Ramu identifies itself to the runtime as Zed, because Google offers those models only to the ACP clients it allows. Thinking levels show only on models that have them.
- ACP runtimes cannot take input mid-turn, so **Steer** cancels the turn and continues with your message.
- Cursor steers within the turn.
