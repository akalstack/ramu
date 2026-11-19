import type { GitCommitFile } from '@ramu/shared/types'

/** A commit or a stash, which the host reads the same way: its files, then one file's before and after. */
export interface Revision {
  oid: string
  stash: boolean
}

export const filesMethod = (revision: Revision) => (revision.stash ? 'git.stashFiles' : 'git.commitFiles')
export const diffMethod = (revision: Revision) => (revision.stash ? 'git.stashFileDiff' : 'git.commitFileDiff')

/** The route params that carry a revision to the file viewer. */
export const revisionParams = (revision: Revision) => ({ oid: revision.oid, ...(revision.stash ? { stash: '1' } : {}) })
export function readRevision(oid: string | undefined, stash: string | undefined): Revision | undefined {
  return oid && /^[a-f0-9]{40,64}$/.test(oid) ? { oid, stash: stash === '1' } : undefined
}

export type RevisionTone = 'ok' | 'warn' | 'bad'
/** The one-letter status git reports (A, M, D, R…) with the colour the file lists give it. */
export function revisionLetter(status: string): { letter: string; tone: RevisionTone } {
  const letter = status.trim().charAt(0).toUpperCase() || 'M'
  return { letter, tone: letter === 'A' ? 'ok' : letter === 'D' ? 'bad' : 'warn' }
}

export interface RevisionFile extends GitCommitFile {
  name: string
  dir: string
}
/** Files by folder then name, split into the name and the folder shown under it. */
export function revisionFiles(files: GitCommitFile[]): RevisionFile[] {
  return files
    .map((file) => {
      const slash = file.path.lastIndexOf('/')
      return { ...file, name: file.path.slice(slash + 1), dir: slash < 0 ? '' : file.path.slice(0, slash + 1) }
    })
    .sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name))
}

/** "On main: WIP" is how git words a stash; the branch is already in the row's context. */
export const stashTitle = (subject: string) => subject.replace(/^(?:On|WIP on) [^:]+: /, '') || subject
