# Agents and routing

## Helpers

Claude and Codex helpers appear as cards with their task, progress, transcript, and controls. Open a card to inspect its work, send a follow-up, or stop it. Messages are relayed through the main agent. Stopping the main chat also stops its helpers.

Saved helper transcripts can be recovered when reopening a chat. Service restart recovery lets the main agent reconcile unfinished helper work; it does not reattach every helper process or isolated worktree. See [background workflows](AUTOMATION.md).

## Quote and Aside

Select chat text to quote it in a follow-up or ask a read-only Aside without interrupting the main conversation. Aside uses a separate analysis session; provider support and available context vary.

## Usage limits and fallback

Claude and Codex report account usage windows when their runtimes expose them. Configure fallback providers, models, and reasoning effort in Settings. Ramu can switch before a usage limit or continue after a limit, preserving the visible conversation in the same chat. Provider-private reasoning is not transferred.

Fallback requires installed and authenticated runtimes. Authentication errors and ordinary tool failures do not imply a usage limit. Usage information can be unavailable or delayed. Already-running native helpers cannot be moved to another provider.

## Cross-provider helpers

Routing settings can send helper tasks to another provider or model, with optional worktree isolation. Codex's opt-in spawn hook enables routing at native spawn time; without it, routing changes apply at message boundaries. Existing native helpers keep their original provider.

An isolated helper works in a separate checkout. Conflicting patches are preserved for review. Isolation does not include untracked files in the tracked-change snapshot, and isolated helpers do not support follow-up messages.

## Advisor

An optional advisor provides a second perspective using another installed provider or model. Advice can arrive while the main agent continues independent work. Pending advisor requests do not survive a service restart. See [provider setup and advisor](PROVIDERS.md#advisor).

## Compatibility

Capabilities depend on the installed runtime. Automated fixtures cover routing and transcript behavior; they do not certify every live provider version. See [provider setup](PROVIDERS.md) and [ACP chat presentation](ACP-CHAT-UI.md) for integration details.
