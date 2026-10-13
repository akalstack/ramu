# Agents and routing

## Helpers

Helper cards show task progress and transcripts. Open a card to inspect its work, send a message, or stop it. Stopping the main chat stops its helpers.

Ramu can route helpers to another provider or model. **Native** uses the provider's own helpers. Type rules override general routing. Codex's optional hook routes helpers before they start; enabling it adds a trust entry to `~/.codex/config.toml`.

An isolated helper uses a separate checkout and applies its changes back when finished. Conflicting patches remain in the checkout for review. The tracked-change snapshot excludes untracked files; isolated helpers do not support follow-up messages.

Already-running native helpers keep their provider. After a service restart, Ramu reads saved helper transcripts so the main agent can reconcile unfinished work; it does not reattach every helper process.

## Usage limits and fallback

**Settings → Access & Fallback** defines an ordered provider/model list. The default is **Only at the limit**; 80%, 90%, and 95% thresholds allow earlier switching. Unavailable or limited entries are skipped. **Return after the limit resets** restores the original provider and model on a later message.

Fallback requires installed, authenticated providers. It carries visible conversation context into the same chat; private provider reasoning is not transferred. Usage readings can be delayed or unavailable. Authentication errors and tool failures do not trigger usage fallback.

Helpers can use the main fallback policy or their own list and threshold.

### When every provider is limited

If the chat's provider and every fallback are at their limit, the chat goes idle with a notice showing the next check time instead of failing. A clock replaces the chat's status in the sidebar, and Home lists it under **Running in the background** with the expected resume time. It keeps working in the background, so closing the window does not cancel it:

- **Messages still go through.** Anything you send or queue while limited is kept in the chat's queue, and nothing reaches a provider yet.
- **It resumes by itself.** Ramu rechecks when a reset is known, or backs off from one minute up to 15 minutes when it is not. Queued messages are then sent together as one request; with nothing queued, the unfinished request continues.
- **It survives a service restart**, and a goal waiting on the same limit continues with it.
- **You can cancel it.** Stopping or interrupting the chat ends the wait. With **Auto fallback** off and no goal, a limit still stops the chat for manual action.

## Asides and advice

Select chat text to quote it or ask a read-only Aside. Aside replies stay separate from the main agent's conversation.

The optional advisor sends chat context to a second model for advice. See [providers and advisor](PROVIDERS.md#advisor).

Provider features depend on the installed runtime. See [provider setup](PROVIDERS.md) and [background recovery](AUTOMATION.md).
