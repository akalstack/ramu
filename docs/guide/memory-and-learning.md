# Memory and learning

Ramu carries what your agents learn from one thread to the next, across every provider.

## Shared memory

Agents read and save notes that apply to a project or to all projects. **Settings → Memory & learning → Shared memory** (on by default) lets you browse, search, edit, archive and restore them, with full history. Notes you wrote or confirmed are never rewritten or archived by an agent. Don't store credentials: memory can reach any provider you use.

Every new thread starts with your own preferences and corrections, and any note marked essential, quoted in full, so they apply whatever the task is about. If there are too many to quote, the rest are listed first by title. Other notes appear as titles the agent opens when needed: all of them while they fit (roughly 150), otherwise the most important and recently used. Each message you send also lists up to five notes whose titles or tags match it, so the agent finds them without having to think of a search.

**Memory cleanup** runs daily when enough has changed, merging duplicates, archiving outdated notes and renaming agent-written notes whose titles don't say when they apply. **Clean up memory** runs it now.

## Learning

**Learning & skills** offers **Off**, **Review first** (default) and **Automatic**. After a substantive turn, Ramu reviews it and proposes memories, reusable skills and a session checkpoint. In Review first you apply or dismiss each proposal, on the desktop or under **Settings → Memory** on the phone, which lists the reviews waiting for you with what each would save and **Apply**, **Retry review** and **Dismiss**. Reviews wait until you're idle, share a daily limit (five by default), and skip turns with nothing new.

Every proposal is checked for credentials before it can be saved. Model-written learning can be wrong, so your own notes and current instructions always outrank it.

## Skills

- **Customize → Skills** lists the skills you wrote and the ones you installed, and searches the open directory at [skills.sh](https://skills.sh) as you type, with its most installed skills under **Popular on skills.sh**. Clicking a skill opens its details, or its install review when you do not have it yet (as **Install** on its row does). The review shows SKILL.md (what every agent is told) formatted, with **Show source**, beside a list of the skill's other files, each opened on a click and scripts marked, which **Agents** (every agent by default) and **Projects** (all projects by default) use it, and **Check with AI**, a safety read of its instructions and scripts by the host's maintenance model; an update marks the files it adds or changes. A skill's details show the same files under **Show what it tells agents**, with the same **Agents**, **Projects** and safety check, and update, copy, turn off or remove it. **Add** writes a skill or installs one from a repository, address or folder. **Advanced** keeps copies' source changes and supporting files.
- **Ramu's skills** are the ones Ramu learns or you write; each shows the projects and providers it applies to. They load through each provider's own skill system for that thread, without touching your provider folders. Pin a skill to keep it from being archived.
- **Installed skills** come from skills.sh, a repository, URL or folder (**Customize → Skills**, or ask the agent). You approve the files first; its scripts come with it, since its instructions call them, and Ramu never runs them itself. Each card names its source; **Update** brings in changes from there.
- **Your skills** are ones you write by hand. Learning never changes them. **Edit a copy** makes an editable copy of an installed skill; the copy says what it came from, and changes to that source reach it only after you review them.
- **On your other hosts:** **Available on** in a skill's details sends an installed skill, or one you wrote, to your other hosts for review there ([On your other hosts](plugins.md#on-your-other-hosts)). Learned skills stay with the host that learned them.
- **Skills in your provider folders and projects** are listed under **Settings → Agent setup** (desktop and phone) with which providers load each one and the files it comes from. Two places holding different content under one name are flagged.

## What Ramu learned

A periodic summary (weekly by default) of what learning saved, merged and archived, listed in **Inbox → Learned**. **Looks good** dismisses it; typing in its box starts a review thread that can fix memories and skills with your approval.

## Recalling past work

**Recall past conversations** (on by default) lets agents search earlier threads in the project and open the original messages. It searches locally, with no model call.
