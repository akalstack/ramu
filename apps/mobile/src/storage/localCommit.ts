/** Two complete slots keep an interrupted native file write from destroying the last committed profile. */
export interface LocalCommitStorage {
  read(slot: 0 | 1): string | null
  write(slot: 0 | 1, value: string): void
}
export class LocalCommitError extends Error {
  readonly code: 'corrupt' | 'version' | 'conflict'
  constructor(code: 'corrupt' | 'version' | 'conflict', message: string) {
    super(message)
    this.code = code
  }
}
type Commit = { version: 1; revision: number; data: Record<string, unknown> }

function latest(storage: LocalCommitStorage): { slot: 0 | 1; commit: Commit } | null {
  let found: { slot: 0 | 1; commit: Commit } | null = null
  let corrupt = false
  for (const slot of [0, 1] as const) {
    const raw = storage.read(slot)
    if (raw === null) continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      corrupt = true
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      corrupt = true
      continue
    }
    const commit = value as Commit
    if (commit.version !== 1) throw new LocalCommitError('version', 'This phone data needs a newer Ramu version.')
    if (
      !Number.isSafeInteger(commit.revision) ||
      commit.revision < 1 ||
      !commit.data ||
      typeof commit.data !== 'object' ||
      Array.isArray(commit.data)
    ) {
      corrupt = true
      continue
    }
    if (!found || commit.revision > found.commit.revision) found = { slot, commit }
    else if (
      commit.revision === found.commit.revision &&
      JSON.stringify(commit.data) !== JSON.stringify(found.commit.data)
    )
      throw new LocalCommitError('conflict', 'Conflicting phone data. The stored copies have been kept for recovery.')
  }
  if (!found && corrupt)
    throw new LocalCommitError('corrupt', 'Could not read phone data. The stored copies have been kept for recovery.')
  return found
}

export function readLocalCommit(storage: LocalCommitStorage): Record<string, unknown> | null {
  return latest(storage)?.commit.data ?? null
}

export function writeLocalCommit(
  storage: LocalCommitStorage,
  data: Record<string, unknown>,
  legacyRecovery = false,
): void {
  let previous: ReturnType<typeof latest>
  try {
    previous = latest(storage)
  } catch (error) {
    if (!legacyRecovery || !(error instanceof LocalCommitError) || error.code !== 'corrupt') throw error
    previous = null
  }
  const revision = (previous?.commit.revision ?? 0) + 1
  if (!Number.isSafeInteger(revision)) throw new Error('Phone data revision limit reached.')
  const slot = previous?.slot === 0 ? 1 : 0
  const text = JSON.stringify({ version: 1, revision, data } satisfies Commit)
  storage.write(slot, text)
  if (storage.read(slot) !== text) throw new Error('Could not finish saving phone data. Try again.')
}
