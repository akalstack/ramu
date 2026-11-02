# Memory and learning

Ramu carries what your agents learn from one thread to the next, across every provider.

## Shared memory

Agents read and save notes that apply to a project or to all projects. **Settings → Memory & skills → Shared memory** (on by default) lets you browse, search, edit, archive and restore them, with full history. Notes you wrote or confirmed are never rewritten or archived by an agent. Don't store credentials: memory can reach any provider you use.

**Memory cleanup** runs daily when enough has changed, merging duplicates and archiving outdated notes. **Clean up memory** runs it now.

## Learning

**Learning & skills** offers **Off**, **Review first** (default) and **Automatic**. After a substantive turn, Ramu reviews it and proposes memories, reusable skills and a session checkpoint. In Review first you apply or dismiss each proposal. Reviews wait until you're idle, share a daily limit (five by default), and skip turns with nothing new.

Every proposal is checked for credentials before it can be saved. Model-written learning can be wrong, so your own notes and current instructions always outrank it.

## Skills

- **Managed skills** are the ones Ramu writes. They load through each provider's own skill system for that thread, without touching your provider folders. Pin a skill to keep it from being archived.
- **Installed skills** come from a repository, URL or folder (**Settings → Memory & skills → Installed skills**, or ask the agent). You approve the files first, and scripts need a second approval.
- **Your skills** are ones you write by hand. Learning never changes them. **Edit a copy** makes an editable copy of an installed skill.

## What Ramu learned

A periodic summary (weekly by default) of what learning saved, merged and archived, listed in **Inbox → Learned**. **Looks good** dismisses it; typing in its box starts a review thread that can fix memories and skills with your approval.

## Recalling past work

**Recall past conversations** (on by default) lets agents search earlier threads in the project and open the original messages. It searches locally, with no model call.
