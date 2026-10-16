# Agents and routing

## Changing models while working

Selecting a model from the dropdown during a running turn starts a five-second countdown. **Apply now** switches immediately; **Cancel** restores the currently applied model and reasoning effort. Adjusting reasoning while a model change is pending keeps the original deadline and applies the latest effort with that model. Selecting a model through the slider still commits on release. Idle threads keep their existing selection behavior, and a pending countdown is cancelled if the turn stops running.

## Helpers

Helper cards show task progress and transcripts. Open a card to inspect its work, send a message, or stop it. Stopping the main thread stops its helpers.

Ramu can route helpers to another provider or model. **Native** uses the provider's own helpers. Type rules override general routing. Codex's optional hook routes helpers before they start; enabling it adds a trust entry to `~/.codex/config.toml`.

An isolated helper uses a separate checkout and applies its changes back when finished. Conflicting patches remain in the checkout for review. The tracked-change snapshot excludes untracked files; isolated helpers do not support follow-up messages.

Already-running native helpers keep their provider. After a service restart, Ramu reads saved helper transcripts so the main agent can reconcile unfinished work; it does not reattach every helper process.

## Usage limits and fallback

**Settings → Access & Fallback** holds one list of provider and model pairs, best first. The default is Claude Code, then Codex. A thread uses the highest model on the list that has room:

- When its model reaches the limit, the thread moves to the highest model below it that has room. Unavailable or limited entries are skipped. The default switch point is **Only at the limit**; 80%, 90%, and 95% thresholds switch earlier.
- Before each message, if a model higher on the list has room again, the thread moves back up. A new thread started lower on the list moves up the same way.
- A model you pick by hand in a thread stays until it reaches its limit. A model that isn't on the list also stays until its limit. Neither moves up on its own.
- The composer's usage chip shows where the next message goes. Use it to keep the current model for one message or for the thread.

Background work such as titles, recaps, and commit messages keeps its model until that model reaches its limit.

Fallback requires installed, authenticated providers. It carries visible conversation context into the same thread; private provider reasoning is not transferred. Usage readings can be delayed or unavailable. Authentication errors and tool failures do not trigger usage fallback.

Helpers can use the main list or their own list and threshold. Helpers only move down the list when they reach a limit, so task-type routing is kept.

### When every provider is limited

If the thread's provider and every fallback are at their limit, the thread goes idle with a notice showing the next check time instead of failing. A clock replaces the thread's status in the sidebar, and Home lists it under **Running in the background** with the expected resume time. It keeps working in the background, so closing the window does not cancel it:

- **Messages still go through.** Anything you send or queue while limited is kept in the thread's queue, and nothing reaches a provider yet.
- **It resumes by itself.** Ramu rechecks when a reset is known, or backs off from one minute up to 15 minutes when it is not. Queued messages are then sent together as one request; with nothing queued, the unfinished request continues.
- **It survives a service restart**, and a goal waiting on the same limit continues with it.
- **You can cancel it.** Stopping or interrupting the thread ends the wait. With **Auto fallback** off and no goal, a limit still stops the thread for manual action.

## Asides and advice

Select thread text to quote it or ask a read-only Aside. Aside replies stay separate from the main agent's conversation.

The optional advisor sends thread context to a second model for advice. See [providers and advisor](PROVIDERS.md#advisor).

Provider features depend on the installed runtime. See [provider setup](PROVIDERS.md) and [background recovery](AUTOMATION.md).
