# Providers

Ramu runs the agent tools you already use, with your own accounts.

## Setup

| Provider    | Install                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| Claude Code | Install Claude Code and sign in                                                      |
| Codex       | Install Codex and sign in                                                            |
| OpenCode    | Install OpenCode and configure a model provider                                      |
| Cursor      | **Login** in Settings (Cursor's browser sign-in), or set `CURSOR_API_KEY`            |
| Antigravity | **Settings → Providers → Antigravity → Install runtime**, then **Login** with Google |

A new profile opens a short setup that finds installed tools and offers their sign-ins. **Settings → Providers** handles sign-in, accounts, updates and executable paths (`RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN`, `RAMU_ANTIGRAVITY_BIN`). Ramu stores no provider passwords.

Newer provider CLIs and newer Ramu releases on every connected host come as one notice: **Update all**, or **Choose** to update one at a time from a list grouped by host. **Settings → Providers** has **Update all** beside each provider's own **Update**, and a host card on the phone lists each update with its own button. With **Wait a day before offering updates** on (the default, in **Settings → Background & updates**), a release is offered once it has been out 24 hours, so a bad release is usually pulled before it reaches you. For provider CLIs the day counts from when the host first saw the version, and for Ramu from its GitHub release. Codex installs exactly the version that waited. CLIs that update themselves are held until their newest release has waited. A waiting release shows when it will be offered, and **Update now** installs it at once after a confirmation.

A provider card shows no version message while Ramu can use the installed version, even one nobody has tested yet. When the version can't be used with this Ramu release, the card says so in red with the fix: **Update to** a tested release, **Update Ramu** for a bundled runtime, **Change executable path**, or **Check again**.

## Models

The model picker lists each provider's models. **Legacy** marks an older version once a newer one of the same family is listed, or a model its provider calls deprecated or has retired. **Show legacy models** reveals them. **New** marks a model released in the last two weeks, and **Retires ‹date›** one whose retirement is announced within 90 days.

Release and retirement dates come from two public model lists, [models.dev](https://models.dev) and [LiteLLM's](https://github.com/BerriAI/litellm). Each host reads them once a day and keeps a small copy. An unchanged list is not downloaded again, and if one list fails the other still works. Nothing about you is sent. Offline, the host uses its last copy.

When a provider offers a model your host hasn't seen it offer before, every device shows it once (**See models**), and the list tags it **New** for two weeks unless a release date says otherwise. Turning a provider on doesn't announce everything it has. **Tell me about new models** (Settings → Models) turns this off. **Look up model dates online** (Settings → Models) turns the lookups off, and Legacy then comes from versions alone.

## Accounts

Every provider can hold several logins. The first enabled one in **Settings → Providers** applies to new threads. When a thread hits a limit, Ramu moves it on its own only to another login that uses an API key, before trying another model. It never switches to another subscription login by itself, because plan limits are meant for one person's ordinary use and providers' terms bar working around them. You can still pick any login yourself. Once a Claude, Codex or Cursor subscription is signed in, **Settings → Providers** notes beside **Add account** that separate personal and work logins are fine, but stacking your own subscriptions to get past limits can break the provider's terms, with a link to them. When the login it left has room again, the thread switches back. A provider or login turned off starts nothing: new threads, threads continuing after a stop or restart, and fallback switches all refuse it and say why.

To pick a login yourself, open the model menu under the message box (on the phone, the model sheet). The **Account** row lists the provider's logins once more than one is turned on. Each shows its label (or its sign-in email), whether it uses an API key, and how much room it has for the thread's model, such as "58% of the weekly limit used" or "Limit reached · resets Thu 12:59", so you don't move to a login that is also at its limit. The thread moves over with its conversation. While a thread waits at a usage limit, a model or login you choose applies at once, so **Try anyway** and the automatic resume use it. Signing a login in, changing its key, or signing it in from a terminal and refreshing **Settings → Providers** updates its name and usage on every device. On the phone, **Settings → Providers** lists each login with how it signs in, and turns logins on or off.

### API keys

Claude Code, Codex, Cursor and OpenCode logins can use an API key instead of a subscription: choose the key button on a login in **Settings → Providers** on the host, or **Use an API key** beside a signed-out login. Usage is then billed to the key, and a login with a key gives a thread somewhere to continue when your plan's limit is reached. OpenCode asks which model provider the key is for. Codex keeps the key in its own login file. For the others, the key stays in the host's OS credential store and reaches only that login's processes. **Remove key** returns the login to its subscription (for Codex, sign in again). Antigravity takes Gemini and Agent Platform keys in its own **Login** dialog, which opens on the method the login used last. Under **Google account** it notes that Google may limit personal plans used outside its own apps, which a Gemini API key avoids. Ramu checks the Antigravity runtime it downloads against Google's published checksum before unpacking it.

## Abilities

A provider offers an [ability](working-with-agents.md#abilities) to other providers' threads only after a live check passes on the installed version. The check is one small request using only that tool. It runs a minute after the host starts or when Settings asks, once per version and sign-in of the provider's chosen login. A failure is kept too, and isn't retried until the version or login changes. Each provider card in **Settings → Providers** lists the results under **Abilities**, with why one isn't available and **Check again**.

| Provider    | Checked abilities                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Codex       | Web search (built-in search). Image generation and editing (built-in image tool), only where the login and model offer it. |
| Claude Code | Web search (`WebSearch`).                                                                                               |
| Both        | Long documents, when a model reports a context window of 400,000 tokens or more.                                        |

OpenCode, Cursor and Antigravity declare no abilities yet.

## Artifacts using a provider

An artifact you allow to use AI calls the host's signed-in providers, never a key of its own. **Fast** uses the maintenance model and **Smart** the default model. Each call counts against the artifact's daily limit, follows the same usage-limit fallback as other background work, and shows in **Activity** with the artifact's name. It is refused with a clear error when the provider is signed out or limited. See [Artifacts](artifacts.md#what-an-artifact-may-use).

## Environment variables

**Settings → Agent setup → Environment variables** adds variables to every provider process on the host, for all providers or one. Paste `.env` text to fill several rows. Values stay in the host's OS credential store, and paired devices see only names. `RAMU_*` names are reserved.

## Access modes

- **Allow edits:** the agent edits files in the project and asks before other actions, where the provider supports asking. Ramu tools that ask you themselves (questions, starting threads, settings changes, the browser and computer) and tools of your [MCP servers](working-with-agents.md#rules-and-mcp), whose approvals Ramu applies on every call, never show a second card from the provider. This works the same in every provider.
- **Auto:** Ramu's own tools run without asking. Everything else follows the provider's automatic review, so risky commands still ask.
- **Full access:** commands and edits run without asking, except the few that can destroy work or the machine: deleting outside the thread's folders, a whole project or `.git`, `git reset --hard`, `git clean -f`, force-pushes and other history rewrites, running as administrator, formatting disks, and shutting down. Those ask once each, with the reason, and can't be saved as rules. Claude's own safety checks and ask rules in your Claude settings still ask too. Cursor's SDK can't pause a command, so Cursor threads in Full access never ask. Use it only for work you trust.

Approvals default to **Allow once**. For a command you can save a prefix rule (such as `git diff *`) for the project or for every project, from the card in the thread on desktop or on the phone (**Don't ask again for**). A saved approval can be forgotten from the card. **Settings → Permissions → Saved approvals** lists and removes them on the desktop and the phone, and **Remove displayed approvals** clears them all.

## Plan usage

The sidebar footer shows, in one line, how much each provider's current login has used in its tightest window, closest to a limit first. Providers that don't fit show as **+N**, named on hover. With the sidebar hidden, the status bar shows the same as rings. Either opens **Plan usage**: a section per provider with a row for every login on every connected host, showing its windows side by side with reset times, its plan, and the hosts it is signed in on, with a dot on each host whose threads use it. A login signed in on several hosts shows once, matched by its sign-in email. Where a host doesn't know the email, logins with identical limits and reset times are merged and marked **Matched by its limits**. Percentages are never added together. Account names and emails stay hidden until you choose **Show accounts**, which this device remembers. Claude and Codex report their own usage. OpenCode, Cursor and Antigravity share usage only with their own apps, so their logins show a limit once one is reached, with its reset time when the provider gives it. Cursor's row links to its usage page. **This week** adds up finished turns, reported cost and tokens across hosts. Hosts whose providers report no cost or tokens are named instead of counted as zero.

## Advisor

**Settings → Goals & delegation → Advisor** lets the agent ask a second model for an opinion. Each consultation sends the thread to that model and uses its tokens. Turn on **Always wait for advice** to pause while it answers.

## Provider notes

- Ramu supports OpenCode 2 and runs one `opencode serve` per thread. Antigravity uses ACP.
- Antigravity lists the models your Google plan offers, including its Claude and GPT models. Ramu identifies itself to the runtime as Zed, because Google offers those models only to the ACP clients it allows. Thinking levels show only on models that have them.
- ACP runtimes can't take input mid-turn, so **Steer** cancels the turn and continues with your message.
- Cursor steers within the turn.
