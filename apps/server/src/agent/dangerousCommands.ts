import { homedir, tmpdir } from 'node:os'
import { basename, resolve, sep } from 'node:path'
import { commandDeploy } from '@ramu/shared/deployActions'
import type { AgentSettings } from '@ramu/shared/types'

/**
 * The few commands full access still stops for. Full access skips approvals, so this list stays narrow: work or data
 * that a command can destroy for good, the machine itself, acting as administrator, and a production deploy. Deleting, cleaning or
 * resetting inside the thread's own folders stays routine.
 *
 * The parse is deliberately loose: quotes are dropped, and shells, `env`, `xargs` and similar wrappers are looked
 * through, so `bash -c 'rm -rf ~'` reads as the removal it runs. A false alarm costs one approval; a miss costs data.
 */

/** Where a command runs and the folders the thread works in. */
export interface CommandScope {
  cwd: string
  additionalDirs?: string[]
  covers?: string[]
}

const SHELL = /^(?:ba|z|da|k|c|tc|fi)?sh$/
const WRAPPERS = new Set([
  'env',
  'command',
  'builtin',
  'exec',
  'eval',
  'nohup',
  'time',
  'nice',
  'ionice',
  'caffeinate',
  'xargs',
  'timeout',
  'watch',
  'stdbuf',
])
const ADMIN = new Set(['sudo', 'su', 'doas', 'pkexec', 'runas'])
const REMOVE = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm'])
const DISK = new Set(['mkfs', 'fdisk', 'sfdisk', 'parted', 'wipefs', 'format'])
const POWER = new Set(['shutdown', 'reboot', 'halt', 'poweroff'])
const OWNERSHIP = new Set(['chmod', 'chown', 'chgrp'])
const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']

const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

type Place = 'inside' | 'project' | 'outside' | 'unknown'

/** Where a path a command names falls: inside the thread's folders, one of those folders itself, or elsewhere. */
function placeOf(word: string, scope: CommandScope): Place {
  if (/[$`]/.test(word)) return 'unknown'
  const roots = [...new Set([scope.cwd, ...(scope.additionalDirs ?? []), ...(scope.covers ?? [])])].map((root) =>
    resolve(root),
  )
  const literal = word.replace(/[*?[].*$/, '') || '.'
  const expanded = literal === '~' || literal.startsWith('~/') ? homedir() + literal.slice(1) : literal
  if (expanded.startsWith('~')) return 'unknown'
  const path = resolve(scope.cwd, expanded)
  if (roots.some((root) => path === root)) return 'project'
  if (roots.some((root) => within(path, root)) || TEMP_ROOTS.some((root) => within(path, resolve(root))))
    return 'inside'
  return 'outside'
}

/** The words of each simple command in a line, looking through quotes, substitutions and command separators. */
function commandsOf(command: string): string[][] {
  return command
    .replace(/\\\r?\n/g, ' ')
    .split(/&&|\|\||[;|&\n]|\$\(|`|[(){}]/)
    .map((segment) =>
      segment
        .replace(/["']/g, ' ')
        .split(/\s+/)
        .filter((word) => word && !/^\d*>/.test(word) && !/^<+$/.test(word)),
    )
    .filter((words) => words.length)
}

/** Drops what only launches the real command: variable assignments, shells with `-c`, `env`, `xargs` and the like. */
function unwrap(words: string[]): { words: string[]; admin?: string; fromInput: boolean } {
  let fromInput = false
  const rest = [...words]
  while (rest.length) {
    const name = basename(rest[0]!)
    if (/^[A-Za-z_]\w*=/.test(rest[0]!)) rest.shift()
    else if (ADMIN.has(name)) return { words: rest, admin: name, fromInput }
    else if (WRAPPERS.has(name) || SHELL.test(name)) {
      if (name === 'xargs') fromInput = true
      rest.shift()
      while (rest.length && (rest[0]!.startsWith('-') || (name === 'timeout' && /^\d/.test(rest[0]!)))) rest.shift()
    } else break
  }
  return { words: rest, fromInput }
}

const flagsOf = (args: string[]) => args.filter((word) => word.startsWith('-') && word !== '-' && word !== '--')
const targetsOf = (args: string[]) => {
  const end = args.indexOf('--')
  return [
    ...(end < 0 ? args : args.slice(0, end)).filter((word) => !word.startsWith('-')),
    ...(end < 0 ? [] : args.slice(end + 1)),
  ]
}
const hasShort = (flags: string[], letters: RegExp) => flags.some((flag) => /^-[^-]/.test(flag) && letters.test(flag))

/** Why a removal, or a recursive permission change, reaches beyond the thread's own work. */
function reachBeyond(targets: string[], scope: CommandScope, recursive: boolean, verb: string): string | null {
  for (const target of targets) {
    const place = placeOf(target, scope)
    if (basename(target.replace(/\/+$/, '')) === '.git' && place !== 'unknown')
      return `${verb} the repository itself (${target})`
    if (place === 'outside') return `${verb} ${target}, outside this thread’s folders`
    if (place === 'project' && recursive) return `${verb} a whole project folder (${target})`
    if (place === 'unknown' && recursive) return `${verb} ${target}, a path Ramu cannot check before it runs`
  }
  return null
}

function gitDanger(args: string[]): string | null {
  const rest = [...args]
  while (rest[0]?.startsWith('-')) {
    const option = rest.shift()!
    if (/^-[Cc]$/.test(option)) rest.shift()
  }
  const [verb = '', ...more] = rest
  const flags = flagsOf(more)
  const targets = targetsOf(more)
  if (verb === 'reset' && flags.includes('--hard')) return 'Discards uncommitted changes (git reset --hard)'
  if (verb === 'clean' && (hasShort(flags, /f/) || flags.includes('--force')))
    return 'Deletes untracked files (git clean)'
  if (
    verb === 'push' &&
    (flags.some((flag) => /^--(?:force(?:-with-lease)?(?:=.*)?|mirror|delete|prune)$/.test(flag)) ||
      hasShort(flags, /[fd]/) ||
      targets.some((target) => /^[+:]/.test(target)))
  )
    return 'Overwrites or deletes history on the remote (git push --force or --delete)'
  if (/^filter-(?:branch|repo)$/.test(verb)) return 'Rewrites the repository’s history'
  if (verb === 'stash' && more[0] === 'clear') return 'Deletes every stash (git stash clear)'
  if (verb === 'reflog' && more[0] === 'expire') return 'Removes recovery points (git reflog expire)'
  if (
    (verb === 'checkout' || verb === 'restore') &&
    targets.some((target) => target === '.' || target === ':/' || target === '*') &&
    !(verb === 'restore' && (flags.includes('--staged') || flags.includes('-S')) && !flags.includes('--worktree'))
  )
    return 'Discards every uncommitted change in the working tree'
  return null
}

/** The typed tool to use instead of a CLI write on a pull request, which would post with no card and nothing to undo. */
const FORGE_WRITES: Record<string, Record<string, string>> = {
  gh: {
    comment: 'pull_request_comment',
    review: 'pull_request_review',
    merge: 'pull_request_merge',
    close: 'pull_request_state',
    reopen: 'pull_request_state',
    ready: 'pull_request_state',
    edit: 'pull_request_update',
  },
  glab: {
    note: 'pull_request_comment',
    approve: 'pull_request_review',
    revoke: 'pull_request_withdraw_review',
    merge: 'pull_request_merge',
    close: 'pull_request_state',
    reopen: 'pull_request_state',
    update: 'pull_request_update',
  },
}

function forgeWrite(name: string, args: string[]): string | null {
  const tools = FORGE_WRITES[name]
  const [group, verb = ''] = args.filter((word) => !word.startsWith('-'))
  if (!tools || group !== (name === 'gh' ? 'pr' : 'mr')) return null
  const tool = tools[verb]
  return tool
    ? `Posts on a pull request in your name with no card (${name} ${group} ${verb}); agents use ${tool}`
    : null
}

/** Why a command asks at every access level: it deploys to production. */
export function productionDeploy(command: string): string | null {
  return commandDeploy(command) === 'production' ? 'Deploys to production' : null
}

/** Why a command asks although the access level would run it on its own, or null. */
export function alwaysAsks(command: string, scope: CommandScope, access: AgentSettings['access']): string | null {
  return access === 'full' ? dangerousCommand(command, scope) : productionDeploy(command)
}

/**
 * Why a shell command needs a person's approval even under full access, or null when it may run. Reasons are short
 * sentences shown on the approval.
 */
export function dangerousCommand(command: string, scope: CommandScope): string | null {
  if (typeof command !== 'string' || !command.trim()) return null
  const deploy = productionDeploy(command)
  if (deploy) return deploy
  if (/>\s*\/dev\/(?:r?disk|sd|nvme|hd|mmcblk)/.test(command)) return 'Writes directly to a disk'
  for (const raw of commandsOf(command)) {
    const { words, admin, fromInput } = unwrap(raw)
    if (admin) return `Runs a command as administrator (${admin})`
    const [exe = '', ...args] = words
    const name = basename(exe)
    const flags = flagsOf(args)
    const targets = targetsOf(args)
    if (REMOVE.has(name)) {
      const recursive = name === 'rmdir' || hasShort(flags, /[rR]/) || flags.includes('--recursive') || name === 'shred'
      if (fromInput && recursive) return 'Deletes files listed at run time, which Ramu cannot check first'
      const reason = reachBeyond(targets, scope, recursive, 'Deletes')
      if (reason) return reason
    } else if (name === 'find' && args.some((word) => /^-(?:delete|exec|execdir|ok|okdir)$/.test(word))) {
      const deletes =
        args.includes('-delete') ||
        args.some((word, i) => /^-(?:exec|execdir|ok|okdir)$/.test(word) && REMOVE.has(basename(args[i + 1] ?? '')))
      const starts = args.slice(
        0,
        Math.max(
          0,
          args.findIndex((word) => /^[-(!]/.test(word)),
        ),
      )
      if (deletes) {
        const reason = reachBeyond(starts.length ? starts : ['.'], scope, false, 'Deletes files under')
        if (reason) return reason
      }
    } else if (OWNERSHIP.has(name) && (hasShort(flags, /R/) || flags.includes('--recursive'))) {
      const reason = reachBeyond(targets.slice(1), scope, true, 'Changes permissions on')
      if (reason) return reason
    } else if (name === 'git') {
      const reason = gitDanger(args)
      if (reason) return reason
    } else if (name === 'gh' || name === 'glab') {
      const reason = forgeWrite(name, args)
      if (reason) return reason
    } else if (DISK.has(name) || /^mkfs\./.test(name)) return `Formats or repartitions a disk (${name})`
    else if (name === 'dd' && args.some((word) => /^of=\/dev\//.test(word))) return 'Writes directly to a disk (dd)'
    else if (
      name === 'diskutil' &&
      /^(?:erase\w*|zeroDisk|randomDisk|secureErase|partitionDisk|reformat)$/i.test(args[0] ?? '')
    )
      return `Erases or repartitions a disk (diskutil ${args[0]})`
    else if (POWER.has(name)) return `Shuts down or restarts the computer (${name})`
  }
  return null
}
