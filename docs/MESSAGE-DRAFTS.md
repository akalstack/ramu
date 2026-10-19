# Saved message drafts

Mobile **Add to message → Save draft** puts the current unsent message aside and clears the composer. **Saved drafts** lists saves for that composer; **All drafts on this host** includes other composers on the same host. A preview shows the message, captured file context and uploaded attachment names. **Restore draft** restores an empty composer. In an occupied composer, **Save current and restore** keeps the current message as another saved item before restoring the selected one. Delete offers Undo while the sheet remains available.

These actions do not send, queue, steer, create a thread or workspace, or resume an agent. They work with an offline host. They do not change the selected provider or model. Active automatic drafts remain separate from explicit saves.

Quotes and inline references keep their original text. File context keeps repository identity, captured content, selections and diff metadata; mobile short mentions keep their expansion sidecars. A context preview shows up to 4000 characters per file, while restoring retains the full captured content. New-thread saves retain default/manual checkout choice or the selected existing workspace. Restoring changes the displayed choice, and normal creation revalidates the workspace on its host.

From the host-wide list, **Open original composer** opens the source thread or new-thread composer. If the original project/thread no longer exists, the saved text and captured context remain readable. Moving a save into another scope, hardware-keyboard shortcuts, desktop saved-draft controls and physical-device acceptance remain in [the active plan](MESSAGE-DRAFTS-PLAN.md).

## Storage and recovery

The saved library is device-local and keyed by stable host identity. A host's IDs never identify another host's saved work. Offline-created threads retain their stable device identity when a host task ID arrives, so their saved messages stay associated with the same composer. Each library is versioned and uses optimistic revisions; a delayed confirmation cannot overwrite a newer composer or consume a different save. Saving and restoring persist the complete library and active message before the visible composer changes. Failed writes keep the current message and saved source available. Pending uploads block moves, and late upload callbacks remain bound to their original host/composer and draft move revision.

Mobile retains the existing text/attachment/context/mention sidecars and adds a host-qualified saved library. Native profile storage alternates between two versioned files, retaining the previous complete commit during a write. Startup uses the newest complete supported commit; interrupted first migration can recover from the legacy profile. The legacy profile is removed after a successful migration. Unknown versions or unrecoverable corruption block writes rather than replacing stored work. Web-based mobile storage uses the existing atomic localStorage write. Forget host commits removal from both native recovery slots before discarding the visible host and its credentials; the confirmation explains active/saved draft and outbox removal.

Explicit saves do not expire or inherit automatic draft pruning. A host library accepts up to 40 items, 200,000 text characters per item and a serialized budget of 4 MiB measured as two bytes per JavaScript code unit, leaving room under common browser quotas for other state. Captured context counts toward that budget. Actual device quotas may be reached sooner. Capacity and storage errors reject the move; saves are never evicted or silently truncated.

## Attachment ownership

The existing execution-host attachment store copies completed uploads into the host profile. It has no automatic expiry or deletion path. Mobile's picker cache is an upload source; it is not the retained attachment. Saved drafts keep metadata and IDs, not base64 bytes or a promise that the file still exists. Deleting a saved record does not delete host uploads or resources referenced by message history, the queue or other drafts. Any future host cleanup needs reference tracking before deleting those resources.

Every restored attachment needs a check on its original host before Send. `attachments.status` checks a bounded list of IDs without returning bytes or trusting a saved device path. Submission also resolves references again, rejecting missing files, invalid metadata and changed file sizes before delivery. Missing attachments remain visible: attach again or remove them. Offline hosts require reconnect for this check; older hosts require an update or explicit removal of restored attachments. Text and captured context can still be edited, saved and restored offline. No attachment is silently dropped or fetched from another host.

## Validation

Shared transition tests cover complete snapshots, occupied restore, stale actions, host/scope collisions, corruption, delete/undo, limits and no automatic expiry. Mobile tests cover additive sidecars, native interrupted-write recovery, save failures, native action surfaces and attachment checks before message delivery. Server tests use real retained files and exercise the validated availability API. Native bundle exports and desktop startup smoke do not establish physical iOS/Android keyboard, accessibility or background/reconnect acceptance.
