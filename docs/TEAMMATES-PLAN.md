# Teammates and agent profiles

A second model joins a thread and works beside the first, and anyone can describe a reusable agent in plain words. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Models differ. Someone working with Opus 5.5 may want GPT Sol 6.1 to rewrite the copy, or to review what Opus just did. Today they copy text into another thread, or switch the thread's model and lose the first model's working session, or hope the agent decides to start a helper. Helpers are chosen by the agent, and the person cannot talk to one from the composer as a peer.

Reusable agents have a similar gap. Settings → Sub-agents can route a type such as Explore to a model, but it does not define what an agent is for, and writing a definition by hand is slow.

**Easier for the person:** adding a second model takes one action, no context is pasted, and the two can hand work to each other in view. A useful custom agent takes one sentence to create.

## Names

| Name | Means |
| --- | --- |
| **Teammate** (new) | A second model the **person** adds to this thread. It stays visible, keeps its session, and takes messages from the person and the lead. |
| **Lead** (new) | The thread's main model. |
| **Sub-agent** (unchanged) | A short job the **agent** starts for itself. It reports back and ends. |
| **Agent profile** (new) | A saved definition: name, purpose, instructions, model, tools. A teammate or a sub-agent can use one. |

Teammate is not a sub-agent: the difference is who starts it and how long it stays. A profile is not an agent that runs; it is the recipe. In the UI, Settings → Agents lists profiles.

## Delivery

### 1. Teammates in a thread

- **Adding one:** **Add teammate** in the model menu, or `/teammate`, picks a model or a profile. The composer shows both, and the person chooses who gets each message by chip or `@sol`. The lead stays the default.
- **Two ways of working**, chosen when adding and changeable:
  - **Review** (default): read-only. It reads the lead's latest changes and replies with findings when asked, so an idle teammate costs nothing. **Review every turn** is an option.
  - **Take over**: the teammate edits while the lead waits, then hands back with a summary. For "Sol rewrites this".
- **One writer at a time:** the two models never edit at once. Take over passes the turn, using the existing workspace-writer rule.
- **Talking to each other:** visible messages in the transcript, labelled by sender, through a `teammate_message` tool and `thread_message`'s limits. Each exchange costs a turn, so a back-and-forth stops after 4 rounds without the person, and the count is shown.
- **Context:** the teammate starts from the existing handoff (`buildHandoff`), with secrets redacted, and receives only events it has not seen, the same delta rule as provider returns. It keeps its own provider session, so neither model loses its working memory.
- **Transcript:** one thread, one timeline. Each message shows its model's mark. Changes, usage and Stop are per teammate; stopping the thread stops all.
- **Access:** a teammate cannot exceed the thread's access. Review is read-only whatever the thread's access.
- **Limits:** one teammate per thread. Usage limits and fallback apply per teammate, and a limited teammate waits without stopping the lead.
- **Phone:** the same chips, labels and Stop.

### 2. Agent profiles

- **What one is:** a name, a description of when to use it, instructions, a model, and a read-only switch. Profiles live on the host, in Settings → Agents, and are read, never executed.
- **Describe to create:** Settings → Agents → **New agent**, or `/agent new`, takes one sentence ("a strict reviewer for security and missing tests"). One bounded, tool-free call drafts the name, description, instructions and suggested model. The person edits it before saving; nothing saves itself.
- **Invoked automatically:** the description is listed to the lead like a skill, so it can use a profile through `ramu_agent` when a task fits. Ramu shows which profile ran. Native sub-agent types (Explore, Plan) stay.
- **Safety:** read-only narrows what the thread's access allows and never widens it. Instructions reach providers through the existing delivery, not by writing provider config.

## Services to extend

`SubagentRunner` for sessions and mirroring; `handoff.ts` for context; `SessionRegistry.activeWriter` for writers; `fallbackRouter` for limits; `subagentSelection` for routing; `agent/toolRegistry.ts` for tools; `rules` for instruction budgets; `agent.messageTask` and `agent.stopTask` for controls;

Teammates reuse helper sessions with three changes: the person starts them, they survive turns, and they appear in the main timeline instead of a panel.

## Acceptance

- In an Opus thread, add GPT Sol as a Review teammate in two steps. After Opus edits, Sol's findings appear in the same timeline, and Opus can act on them when asked.
- Take over: Sol rewrites a README and hands back. Opus's next turn knows what changed without pasting, and neither provider session restarts.
- A back-and-forth stops at 4 rounds and says so. Stopping the thread stops both. A limited teammate waits while the lead continues.
- One sentence creates a profile. The saved file is readable, and the lead uses it on a matching task, shown in the transcript.
- A read-only profile cannot edit files, even in a Full-access thread.
- Representative task: Opus builds a feature and Sol reviews and rewrites its docs in one thread, with no copying between threads.

Tests: server tests with the fake provider for sessions, delta context, the round limit and writers; shared tests for profile parsing. Live cross-provider runs stay open under [Acceptance](ROADMAP.md#acceptance) until run.
