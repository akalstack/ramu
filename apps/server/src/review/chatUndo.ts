import { join } from 'node:path'
import type { ChangeFile, ChangeReview } from '@ramu/shared/types'

export interface UndoRevision extends ChangeReview {
  roots: { repoId: string; repoName: string; cwd: string }[]
}

/** Collapse consecutive captured runs into one before/after diff, including provider switches. */
export function combineChatUndo(revisions: UndoRevision[]) {
  const paths = new Map<
    string,
    {
      first: ChangeFile
      last: ChangeFile
      root: UndoRevision['roots'][number]
      members: { reviewId: string; fileId: string }[]
      reason?: string
    }
  >()
  for (const review of revisions)
    for (const file of review.files) {
      const root = review.roots.find((root) => root.repoId === file.repoId)
      if (!root) throw new Error('A recorded working directory is unavailable.')
      const path = join(root.cwd, file.path)
      const prior = paths.get(path)
      if (!prior)
        paths.set(path, {
          first: file,
          last: file,
          root,
          members: [{ reviewId: review.id, fileId: file.id }],
          ...(review.undoFileIds?.includes(file.id)
            ? { reason: 'This range contains changes already restored. Review this file manually.' }
            : {}),
        })
      else {
        const beforeExists = file.status !== 'added',
          afterExists = prior.last.status !== 'deleted'
        if (beforeExists !== afterExists || (beforeExists && file.oldContent !== prior.last.newContent))
          prior.reason = 'This file changed outside the captured runs. Restore it manually to preserve those edits.'
        if (file.binary || prior.last.binary) prior.reason = 'Binary or large files require manual review.'
        if (review.undoFileIds?.includes(file.id))
          prior.reason = 'This range contains changes already restored. Review this file manually.'
        prior.last = file
        prior.members.push({ reviewId: review.id, fileId: file.id })
      }
    }
  const files: ChangeFile[] = [],
    roots: UndoRevision['roots'] = [],
    members: Record<string, { reviewId: string; fileId: string }[]> = {},
    blocked: Record<string, string> = {}
  for (const entry of paths.values()) {
    const beforeExists = entry.first.status !== 'added',
      afterExists = entry.last.status !== 'deleted'
    if (
      !entry.reason &&
      ((!beforeExists && !afterExists) ||
        (beforeExists &&
          afterExists &&
          entry.first.oldContent === entry.last.newContent &&
          !entry.first.binary &&
          !entry.last.binary))
    )
      continue
    const repoId = String(roots.length),
      id = entry.first.id
    roots.push({ ...entry.root, repoId })
    files.push({
      ...entry.first,
      id,
      repoId,
      status: !beforeExists ? 'added' : !afterExists ? 'deleted' : 'modified',
      newContent: entry.last.newContent,
      newHash: entry.last.newHash,
      binary: entry.first.binary || entry.last.binary,
    })
    members[id] = entry.members
    if (entry.reason) blocked[id] = entry.reason
  }
  return { files, roots, members, blocked }
}
