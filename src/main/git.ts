// Git CLI wrapper. Every call uses an argument array (never a shell string)
// and an explicit, canonical working directory.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import type { DiffContents, GitCommitFile, GitBranchInfo, GitCommit, GitFileState, GitStatus, GitStatusEntry, GitStash, GitOperation, PullMode, CommitBranchOptions } from '../shared/types'

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly cwd: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message)
  }
}

const MAX_BUFFER = 64 * 1024 * 1024

export function git(cwd: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        // Never let Git block on an interactive prompt or open an editor.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = typeof err.code === 'number' ? err.code : null
          reject(new GitError(`git ${args[0]} failed: ${stderr.trim() || err.message}`, args, cwd, code, stderr))
        } else {
          resolve(stdout)
        }
      },
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

export async function topLevel(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const out = (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
  return out || null
}

export async function headOid(cwd: string): Promise<string | null> {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() || null
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  )
}

const XY: Record<string, GitFileState | null> = {
  '.': null,
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(raw: string): GitStatus {
  const status: GitStatus = { branch: null, detached: false, oid: null, upstream: null, ahead: 0, behind: 0, entries: [] }
  const records = raw.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue
    if (rec.startsWith('# ')) {
      const [, key, ...rest] = rec.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') {
        status.detached = value === '(detached)'
        status.branch = status.detached ? null : value
      } else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const type = rec[0]
    if (type === '?') {
      status.entries.push({ path: rec.slice(2), staged: null, unstaged: 'untracked' })
    } else if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const parts = splitN(rec, ' ', 9)
      status.entries.push(entryFromXY(parts[1]!, parts[8]!))
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path\0origPath
      const parts = splitN(rec, ' ', 10)
      const entry = entryFromXY(parts[1]!, parts[9]!)
      entry.origPath = records[++i]
      status.entries.push(entry)
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = splitN(rec, ' ', 11)
      status.entries.push({ path: parts[10]!, staged: 'unmerged', unstaged: 'unmerged' })
    }
  }
  return status
}

function entryFromXY(xy: string, path: string): GitStatusEntry {
  return { path, staged: XY[xy[0]!] ?? null, unstaged: XY[xy[1]!] ?? null }
}

/** Splits into at most n fields; the last field keeps any remaining separators (paths may contain spaces). */
function splitN(s: string, sep: string, n: number): string[] {
  const out: string[] = []
  let rest = s
  while (out.length < n - 1) {
    const idx = rest.indexOf(sep)
    if (idx < 0) break
    out.push(rest.slice(0, idx))
    rest = rest.slice(idx + 1)
  }
  out.push(rest)
  return out
}

export async function status(cwd: string): Promise<GitStatus> {
  const [raw, op, remotes] = await Promise.all([git(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']), operation(cwd), git(cwd, ['remote'])])
  return { ...parseStatus(raw), operation: op, remote: !!remotes.trim() }
}

/** A rebase or merge in progress. --git-path resolves per-worktree state, where `.git` may be a file. */
export async function operation(cwd: string): Promise<GitOperation | null> {
  const [merge, apply, mergeHead] = (await git(cwd, ['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'MERGE_HEAD'])).trim().split('\n').map((path) => resolve(cwd, path))
  if (existsSync(merge!) || existsSync(apply!)) return 'rebase'
  return existsSync(mergeHead!) ? 'merge' : null
}

/** Content of a path at HEAD or in the index; empty string if absent there. */
export async function showBlob(cwd: string, side: 'HEAD' | 'INDEX', path: string): Promise<string> {
  const spec = side === 'HEAD' ? `HEAD:${path}` : `:${path}`
  return git(cwd, ['show', spec]).catch(() => '')
}

/** Tracked plus untracked-but-not-ignored files, relative to cwd. */
export async function listFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--deduplicate'])
  return out.split('\0').filter(Boolean)
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length) await git(cwd, ['--literal-pathspecs', 'add', '--all', '--', ...paths])
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  if (await headOid(cwd)) await git(cwd, ['--literal-pathspecs', 'restore', '--staged', '--', ...paths])
  else await git(cwd, ['--literal-pathspecs', 'rm', '--cached', '--quiet', '-r', '--', ...paths])
}

export async function discardTracked(cwd: string, paths: string[]): Promise<void> {
  if (paths.length) await git(cwd, ['--literal-pathspecs', 'restore', '--worktree', '--', ...paths])
}

export async function undoCommit(cwd: string, expectedHead: string): Promise<string> {
  const current = await status(cwd)
  if (current.oid !== expectedHead) throw new Error('The latest commit changed. Refresh before undoing it.')
  if (current.detached || current.operation || current.entries.some((entry) => entry.staged === 'unmerged')) throw new Error('Resolve the repository state before undoing a commit.')
  if (current.upstream && current.ahead === 0) throw new Error('This commit is already on the upstream branch. Use a revert instead.')
  const message = (await git(cwd, ['log', '-1', '--format=%B', expectedHead])).trimEnd()
  await git(cwd, ['reset', '--soft', `${expectedHead}^`])
  return message
}

export async function commit(cwd: string, message: string, amendHead?: string, branchOptions?: CommitBranchOptions): Promise<string> {
  // The message goes through stdin so it never needs quoting.
  if (amendHead) {
    const current = await status(cwd)
    if (current.oid !== amendHead) throw new Error('The latest commit changed. Refresh before amending it.')
    if (current.operation || current.entries.some(entry => entry.staged === 'unmerged')) throw new Error('Finish the Git operation and resolve conflicts before amending.')
  }
  if (!message.trim() && !amendHead) throw new Error('A commit message is required.')
  if (branchOptions) {
    if (await currentBranch(cwd) !== branchOptions.expectedBranch) throw new Error('The current branch changed. Review the commit destination again.')
    if (branchOptions.newBranch) {
      if (amendHead) throw new Error('Amend cannot create a feature branch.')
      const current = await status(cwd)
      if (current.operation || current.entries.some(entry => entry.staged === 'unmerged')) throw new Error('Finish the Git operation and resolve conflicts before creating a feature branch.')
      if (!current.entries.some(entry => entry.staged)) throw new Error('Stage changes before committing on a feature branch.')
      await git(cwd, ['check-ref-format', '--branch', branchOptions.newBranch])
      // Starting at HEAD preserves both the index and working tree, including dirty files.
      await git(cwd, ['-c', 'branch.autoSetupMerge=false', 'switch', '-c', branchOptions.newBranch])
    }
  }
  const args = ['commit', ...(amendHead ? ['--amend'] : []), ...(message.trim() ? ['--file=-', '--cleanup=strip'] : ['--no-edit'])]
  await git(cwd, args, message.trim() ? { input: message } : undefined)
  return (await headOid(cwd)) ?? ''
}

/** Prefer the remote's recorded HEAD; common names cover repositories without one. No network request. */
export async function commitBranchInfo(cwd: string): Promise<{ branch: string | null; defaultBranch: string | null }> {
  const branch = await currentBranch(cwd)
  const remotes = (await git(cwd, ['remote'])).trim().split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null
  if (remote) {
    const ref = (await git(cwd, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]).catch(() => '')).trim()
    if (ref.startsWith(`refs/remotes/${remote}/`)) return { branch, defaultBranch: ref.slice(`refs/remotes/${remote}/`.length) }
  }
  for (const name of ['main', 'master']) if (await branchExists(cwd, name) || branch === name) return { branch, defaultBranch: name }
  return { branch, defaultBranch: null }
}

export async function worktreeAdd(repoRoot: string, path: string, branch: string, baseRef: string): Promise<void> {
  await git(repoRoot, ['worktree', 'add', '-b', branch, '--', path, baseRef])
}

export async function worktreeAddExistingBranch(repoRoot: string, path: string, branch: string): Promise<void> {
  await git(repoRoot, ['worktree', 'add', '--', path, branch])
}

/** Removes a worktree; git itself refuses if it has changes (no --force). */
export async function worktreeRemove(repoRoot: string, path: string): Promise<void> {
  await git(repoRoot, ['worktree', 'remove', '--', path])
}

export async function worktreePaths(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, ['worktree', 'list', '--porcelain', '-z'])
  return out
    .split('\0')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

export async function history(cwd: string): Promise<GitCommit[]> {
  if (!await headOid(cwd)) return []
  // Commits not yet on the upstream; without an upstream nothing is marked.
  const [raw, ahead] = await Promise.all([
    git(cwd, ['log', '--max-count=30', '--format=%H%x00%h%x00%an%x00%at%x00%s%x00%D']),
    git(cwd, ['rev-list', '--max-count=30', '@{upstream}..HEAD']).catch(() => ''),
  ])
  const outgoing = new Set(ahead.split('\n').filter(Boolean))
  return raw.trimEnd().split('\n').map((line) => {
    const [oid, shortOid, author, timestamp, subject, refs] = line.split('\0')
    return { oid: oid!, shortOid: shortOid!, author: author!, timestamp: Number(timestamp) * 1000, subject: subject!, refs: refs ?? '', outgoing: outgoing.has(oid!) }
  })
}
export async function branches(cwd: string): Promise<GitBranchInfo[]> {
  const raw = await git(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(worktreepath)', 'refs/heads'])
  return raw.trimEnd().split('\n').filter(Boolean).map((line) => {
    const [name, current, upstream, worktree] = line.split('\0')
    return { name: name!, current: current === '*', upstream: upstream ?? '', worktree: worktree ?? '' }
  })
}
export async function requireClean(cwd: string): Promise<void> {
  const current = await status(cwd)
  if (current.operation) throw new Error(`A ${current.operation} is in progress. Continue or abort it in Source Control first.`)
  if (current.entries.length) throw new Error('Commit or stash your working changes before switching branches or pulling. Ramu does not stash them automatically.')
}
export async function createBranch(cwd: string, name: string): Promise<void> {
  await requireClean(cwd)
  await git(cwd, ['check-ref-format', '--branch', name])
  await git(cwd, ['switch', '-c', name])
}
export async function deleteBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ['check-ref-format', '--branch', name])
  await git(cwd, ['branch', '-d', '--', name])
}
export async function stashes(cwd: string): Promise<GitStash[]> {
  const output = await git(cwd, ['stash', 'list', '--format=%H%x00%gd%x00%s'])
  return output.trimEnd().split('\n').filter(Boolean).map((line) => { const [oid, ref, subject] = line.split('\0'); return { oid: oid!, ref: ref!, subject: subject! } })
}
export async function stash(cwd: string, name: string, stagedOnly = false): Promise<void> {
  const current = await status(cwd)
  if (!current.oid || !current.entries.length || current.entries.some((entry) => entry.staged === 'unmerged')) throw new Error('Stash requires an existing commit and changes without merge conflicts.')
  if (stagedOnly && !current.entries.some((entry) => entry.staged)) throw new Error('There are no staged changes to stash.')
  // --staged needs Git 2.35+; older versions report their own error.
  await git(cwd, ['stash', 'push', ...(stagedOnly ? ['--staged'] : ['--include-untracked']), '--message', name || 'Ramu workspace changes'])
}
/** Applies a stash and removes it. pop and drop take a stash@{n} reference, not an oid. */
export async function popStash(cwd: string, oid: string): Promise<void> {
  await requireClean(cwd)
  const entry = (await stashes(cwd)).find((item) => item.oid === oid)
  if (!entry) throw new Error('This stash is no longer available. Refresh first.')
  await git(cwd, ['stash', 'pop', '--index', entry.ref])
}
export async function applyStash(cwd: string, oid: string): Promise<void> {
  await requireClean(cwd)
  if (!(await stashes(cwd)).some((entry) => entry.oid === oid)) throw new Error('This stash is no longer available. Refresh first.')
  await git(cwd, ['stash', 'apply', '--index', oid])
}
export async function dropStash(cwd: string, oid: string): Promise<void> {
  const entry = (await stashes(cwd)).find((entry) => entry.oid === oid)
  if (!entry) throw new Error('This stash is no longer available. Refresh first.')
  await git(cwd, ['stash', 'drop', entry.ref])
}
export async function checkout(cwd: string, branch: string): Promise<void> {
  await requireClean(cwd)
  if (!await branchExists(cwd, branch)) throw new Error('Select an existing local branch')
  await git(cwd, ['switch', '--', branch])
}
export async function fetch(cwd: string): Promise<void> { await git(cwd, ['fetch', '--all']) }
const PULL_FLAGS: Record<PullMode, string[]> = {
  rebase: ['--rebase'],
  // --ff overrides a global pull.ff=only so merge mode can create a merge commit.
  merge: ['--no-rebase', '--ff'],
  'ff-only': ['--ff-only'],
}
/** Explicit flags: recent Git refuses divergent pulls when no mode is configured. */
export async function pull(cwd: string, mode: PullMode = 'rebase'): Promise<void> {
  await requireClean(cwd)
  try { await git(cwd, ['pull', ...PULL_FLAGS[mode]]) } catch (error) {
    // A conflict leaves the checkout mid-rebase or mid-merge; say what to do instead of echoing Git's hints.
    const op = await operation(cwd)
    if (!op) throw error
    const conflicted = (await status(cwd)).entries.filter((entry) => entry.staged === 'unmerged').length
    throw new Error(`Pull stopped on ${conflicted === 1 ? 'a conflict in 1 file' : `conflicts in ${conflicted} files`}. Resolve and stage ${conflicted === 1 ? 'it' : 'them'} in Source Control, then Continue, or Abort the ${op}. Nothing was pushed.`)
  }
}
/** VS Code's Sync: publish a branch without an upstream; otherwise pull, then push only if still ahead. A failed pull never pushes. */
export async function sync(cwd: string, mode: PullMode = 'rebase'): Promise<void> {
  const before = await status(cwd)
  if (before.operation) throw new Error(`A ${before.operation} is in progress. Continue or abort it in Source Control first.`)
  if (!before.branch) throw new Error('Switch to a branch before syncing')
  if (!before.upstream) return push(cwd)
  await git(cwd, ['fetch'])
  if ((await status(cwd)).behind) await pull(cwd, mode)
  if ((await status(cwd)).ahead) await git(cwd, ['push'])
}
export async function continueOperation(cwd: string): Promise<void> {
  const op = await operation(cwd)
  if (!op) throw new Error('No rebase or merge is in progress.')
  if ((await status(cwd)).entries.some((entry) => entry.staged === 'unmerged')) throw new Error('Resolve and stage every conflicted file before continuing.')
  await git(cwd, [op, '--continue'])
}
export async function abortOperation(cwd: string): Promise<void> {
  const op = await operation(cwd)
  if (!op) throw new Error('No rebase or merge is in progress.')
  await git(cwd, [op, '--abort'])
}
export async function push(cwd: string, expectedBranch?: string): Promise<void> {
  const s = await status(cwd)
  if (expectedBranch !== undefined && s.branch !== expectedBranch) throw new Error('The current branch changed after committing. Nothing was pushed. Review the branch before pushing.')
  if (!s.branch) throw new Error('Switch to a branch before pushing')
  if (s.upstream) { await git(cwd, ['push']); return }
  const remotes = (await git(cwd, ['remote'])).trim().split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null
  if (!remote) throw new Error('Configure a Git remote or upstream before publishing this branch')
  await git(cwd, ['push', '--set-upstream', remote, s.branch])
}
export async function commitDetails(cwd: string, oid: string): Promise<string> {
  if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('Invalid commit identifier')
  return git(cwd, ['show', '--no-ext-diff', '--no-textconv', '--format=fuller', '--stat', '--patch', oid, '--'])
}
export async function compareUpstream(cwd: string): Promise<string> {
  const s = await status(cwd)
  if (!s.upstream) throw new Error('This branch has no upstream. Set one in your terminal before comparing.')
  return git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--stat', '--patch', '@{upstream}', 'HEAD', '--'])
}
export async function stagedPatch(cwd: string): Promise<{ patch: string; fingerprint: string }> {
  const patch = await git(cwd, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--'])
  return { patch, fingerprint: createHash('sha256').update(patch).digest('hex') }
}
/** Every staged file with its status (A/M/D/R…), so a commit draft sees the whole change even when the patch is cut short. */
export async function stagedSummary(cwd: string): Promise<string> {
  return (await git(cwd, ['diff', '--cached', '--no-ext-diff', '--name-status', '-M', '--'])).trim()
}

async function commitParent(cwd: string, oid: string): Promise<string | null> {
  if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('Invalid commit identifier')
  return (await git(cwd, ['rev-list', '--parents', '-n', '1', oid])).trim().split(' ')[1] ?? null
}

/** Merge commits compare with their first parent, matching the history file tree. */
export async function commitFiles(cwd: string, oid: string): Promise<GitCommitFile[]> {
  const parent = await commitParent(cwd, oid)
  const raw = await git(cwd, parent
    ? ['diff', '--no-ext-diff', '--name-status', '-z', '-M', parent, oid, '--']
    : ['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '-M', oid, '--'])
  const fields = raw.split('\0').filter(Boolean)
  const result: GitCommitFile[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]!
    const first = fields[index++]!
    if (status.startsWith('R') || status.startsWith('C')) result.push({ status: status[0]!, origPath: first, path: fields[index++]! })
    else result.push({ status: status[0]!, path: first })
  }
  return result
}

export async function commitFileDiff(cwd: string, oid: string, path: string): Promise<DiffContents> {
  const entry = (await commitFiles(cwd, oid)).find((file) => file.path === path)
  if (!entry) throw new Error('This file is not part of the selected commit')
  const parent = await commitParent(cwd, oid)
  const original = !parent || entry.status === 'A' ? '' : await git(cwd, ['show', `${parent}:${entry.origPath ?? path}`])
  const modified = entry.status === 'D' ? '' : await git(cwd, ['show', `${oid}:${path}`])
  return { original, modified }
}
