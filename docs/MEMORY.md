# Shared memory

Agents use the same saved notes across providers. Notes can apply to a project or all projects. **Settings → Memory & skills → Shared memory** is on by default and applies to threads started after saving.

Browse, search, add, edit, archive, or restore notes in Settings → Memory & skills. Changes are recorded so earlier versions can be restored. Do not store credentials; memory can be sent to any provider used by your threads.

Use **History** to compare earlier text and restore a revision. User-confirmed and essential notes cannot be rewritten or archived by an agent or automatic cleanup. Conflicting evidence stays separate until you edit the original. When an agent saves a decision that replaces an earlier one, it passes the earlier note's ID (`supersedes`): the old note is archived as "superseded by" the new one and stays restorable, and reading the new note shows what it replaced. A note you wrote is never retired this way; both stay visible.

**Learning & skills** can review completed work for durable memories, reusable procedures, and session checkpoints. See [learning and context efficiency](LEARNING.md) for modes, budgets, and tool discovery.

## Cleanup

**Memory cleanup** uses a model to merge duplicates and archive outdated notes. It runs daily when enough has changed and uses model tokens. **Clean up memory** runs it manually.

Unused project notes can be archived after the configured period. Preferences and references last twice as long; important notes get a longer retention period. User-written or user-edited notes and essential memories are kept. Archived notes remain available for restoration until the retention policy removes them.

## Checks

`apps/server/test/memory.test.ts` covers storage, search, scope, cleanup, and history. Model-generated cleanup depends on the selected provider and available tokens.
