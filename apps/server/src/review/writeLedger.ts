import { execFile } from 'node:child_process'
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgentEvent } from '@ramu/shared/types'
import { readsOnly } from '../agent/autoCommandRules'

const exec = promisify(execFile)

type ToolUse = Extract<AgentEvent, { kind: 'tool-use' }>
type ToolResult = Extract<AgentEvent, { kind: 'tool-result' }>

/**
 * Who wrote a file that changed during a turn. `shared`/`other` name chat sessions, never sub-agents; `you` is a save
 * the person made in Ramu's editor, and `byYou` says the person saved a file the thread also wrote.
 */
export type Authorship =
  | { kind: 'mine'; byYou?: true }
  | { kind: 'shared'; with: string[]; byYou?: true }
  | { kind: 'other'; by: string }
  | { kind: 'you' }
  | { kind: 'unknown' }

interface Recording {
  sessionId: string
  roots: string[]
  from: number
  to: number | null
  /** Compared already; kept only while a turn it overlapped is still open. */
  compared?: true
}

interface Span {
  sessionId: string
  from: number
  to: number | null
  /** Where the checkout's changed files stood when the command started, where they can't be watched. */
  before?: Promise<Signature>
  /** Moved to the background: it may write until its turn ends, but no longer holds other commands back. */
  background?: true
}

/** Changed files of a checkout by absolute path, each with its size and modification time. */
type Signature = Map<string, string>

/** Saves the person made in Ramu's own editor are claimed under this id. */
const PERSON = '\0person'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'])
const SHELL_TOOLS = new Set(['Bash', 'shell', 'local_shell', 'exec_command'])
const IGNORED = /(^|[\\/])(\.git|node_modules)([\\/]|$)/
/** A file event lands a little after the command that caused it has reported its end. */
const SETTLE_MS = 2_000
/** Times kept per path; a few are enough to place a file's writes among the turns. */
const TIMES_KEPT = 32
/** The longest a command waits for another thread's command; past it both run, and their writes may be untold. */
const TURN_WAIT_MS = 120_000
/** Changed files read for a checkout that can't be watched; a checkout with more is left to the turn's own diff. */
const SIGNATURE_FILES = 5_000
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm

const within = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
const sharesRoot = (a: string[], b: string[]) => a.some((x) => b.some((y) => within(x, y) || within(y, x)))

/** The files an agent's tool call says it writes, as absolute paths; empty for any other tool. */
export function writtenPaths(event: ToolUse, cwd: string): string[] {
  const edits =
    event.toolKind === 'edit' || event.toolKind === 'delete' || event.toolKind === 'move' || EDIT_TOOLS.has(event.name)
  if (!edits) return []
  const found = new Set<string>()
  for (const location of event.locations ?? []) found.add(location.path)
  let input: unknown
  try {
    input = event.input ? JSON.parse(event.input) : undefined
  } catch {
    input = undefined
  }
  if (input && typeof input === 'object')
    for (const key of ['file_path', 'notebook_path', 'path']) {
      const value = (input as Record<string, unknown>)[key]
      if (typeof value === 'string' && value) found.add(value)
    }
  for (const match of (event.input ?? '').matchAll(PATCH_FILE)) found.add(match[1]!.trim())
  // Codex names a file change's paths only in its summary.
  if (!found.size) for (const part of event.summary.split(', ')) if (part.trim()) found.add(part.trim())
  return [...found].map((path) => resolve(cwd, path))
}

const isShell = (event: ToolUse) => event.toolKind === 'execute' || SHELL_TOOLS.has(event.name)

/** A command that only reads writes nothing: it takes no turn, and no other thread waits for it. */
function readsShell(event: ToolUse): boolean {
  try {
    const command = (JSON.parse(event.input ?? 'null') as { command?: unknown } | null)?.command
    return typeof command === 'string' && readsOnly(command)
  } catch {
    return false
  }
}

/**
 * Tells apart the threads writing in one checkout at once. Edits name their files. A shell command's writes are seen
 * by watching the checkout while two turns overlap there (or, where it can't be watched, by reading its changed files
 * before and after the command), and belong to the thread whose command alone was running. Commands of threads that
 * can wait take turns, so that is the usual case. Only what an open turn could need is kept.
 */
export class WriteLedger {
  private readonly recordings = new Map<string, Recording>()
  private readonly claims: { sessionId: string; path: string; at: number }[] = []
  private readonly shells = new Map<string, Span>()
  private readonly ended: Span[] = []
  private readonly changes = new Map<string, number[]>()
  private readonly watchers = new Map<string, FSWatcher>()
  /** Checkouts that should be watched now; one missing from `watchers` couldn't be. */
  private wanted = new Set<string>()
  private readonly noticed = new Set<string>()
  /** Commands holding for their turn, by session and tool call. */
  private readonly holding = new Set<string>()
  private wakers: (() => void)[] = []
  private readonly reading = new Set<Promise<void>>()

  constructor(
    private readonly options: {
      now?: () => number
      watch?: (root: string, changed: (path: string) => void, failed: () => void) => FSWatcher | null
      /** The changed files of a checkout, for one that can't be watched. */
      signature?: (root: string) => Promise<Signature>
      /** Two turns edited the same file at once; called once per pair of turns. */
      clash?: (sessionId: string, otherSessionId: string, path: string) => void
      turnWaitMs?: number
    } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private open(sessionId: string): Recording | undefined {
    for (const recording of this.recordings.values())
      if (recording.sessionId === sessionId && recording.to === null) return recording
  }

  private wake() {
    const wakers = this.wakers
    this.wakers = []
    for (const wake of wakers) wake()
  }

  /** A turn of a chat session starts recording its changes in these checkouts. */
  begin(reviewId: string, sessionId: string, roots: string[], from = this.now()): void {
    this.recordings.set(reviewId, { sessionId, roots: roots.map((root) => resolve(root)), from, to: null })
    this.watchOverlaps()
  }

  /** The turn's changes are being compared now: what happens after this belongs to the next turn. */
  end(reviewId: string, to = this.now()): void {
    const recording = this.recordings.get(reviewId)
    if (!recording || recording.to !== null) return
    recording.to = to
    for (const [key, span] of this.shells)
      if (span.sessionId === recording.sessionId) this.closeSpan(key, span, to, recording)
    this.watchOverlaps()
    this.wake()
  }

  /** Drops a compared turn and whatever no open turn can still need. */
  forget(reviewId: string): void {
    const done = this.recordings.get(reviewId)
    if (done) done.compared = true
    const open = [...this.recordings.values()].filter((recording) => !recording.compared)
    const oldest = Math.min(...open.map((recording) => recording.from))
    for (const [id, recording] of this.recordings)
      if (recording.compared && recording.to !== null && recording.to < oldest) this.recordings.delete(id)
    const keep = <T>(items: T[], time: (item: T) => number) => {
      const kept = items.filter((item) => time(item) >= oldest)
      items.splice(0, items.length, ...kept)
    }
    keep(this.claims, (claim) => claim.at)
    keep(this.ended, (span) => span.to!)
    for (const [path, times] of this.changes) {
      const kept = times.filter((time) => time >= oldest)
      if (kept.length) this.changes.set(path, kept)
      else this.changes.delete(path)
    }
    if (!open.length) this.noticed.clear()
  }

  /** A chat's (or its sub-agent's) tool call, in that chat's working folder. */
  observe(sessionId: string, cwd: string, event: AgentEvent): void {
    const recording = this.open(sessionId)
    if (!recording) return
    const at = this.now()
    if (event.kind === 'tool-use') {
      for (const path of writtenPaths(event, cwd)) {
        this.claims.push({ sessionId, path, at })
        this.clash(sessionId, recording, path)
      }
      const key = `${sessionId}\0${event.toolUseId}`
      // A command holding for its turn starts when it gets it.
      if (isShell(event) && !readsShell(event) && !this.shells.has(key) && !this.holding.has(key))
        this.start(key, sessionId, recording, at)
    } else if (event.kind === 'tool-result') this.finish(sessionId, event, at)
  }

  /** The person saved this file in Ramu's own editor. */
  personWrote(path: string, at = this.now()): void {
    if ([...this.recordings.values()].some((recording) => recording.to === null))
      this.claims.push({ sessionId: PERSON, path: resolve(path), at })
  }

  private start(key: string, sessionId: string, recording: Recording, at: number) {
    const span: Span = { sessionId, from: at, to: null }
    const unwatched = this.unwatched(recording)
    if (unwatched.length) span.before = this.read(unwatched)
    this.shells.set(key, span)
  }

  private finish(sessionId: string, event: ToolResult, at: number) {
    const key = `${sessionId}\0${event.toolUseId}`
    const span = this.shells.get(key)
    if (!span) return
    // A command moved to the background keeps writing until its turn ends, but no longer holds the others back.
    if (event.running) {
      span.background = true
      this.wake()
      return
    }
    this.closeSpan(key, span, at, this.open(sessionId))
    this.wake()
  }

  private closeSpan(key: string, span: Span, to: number, recording: Recording | undefined) {
    this.shells.delete(key)
    const ended = { ...span, to }
    this.ended.push(ended)
    if (!span.before || !recording) return
    const before = span.before
    const reading = (async () => {
      const [start, end] = await Promise.all([before, this.read(this.unwatched(recording, true))])
      for (const path of new Set([...start.keys(), ...end.keys()]))
        if (start.get(path) !== end.get(path)) this.changed(path, to)
    })()
      .catch(() => {})
      .finally(() => this.reading.delete(reading))
    this.reading.add(reading)
  }

  /** Whether a running command of another chat, in a checkout this one shares, holds this chat's commands back. */
  private blocker(sessionId: string, recording: Recording): string | null {
    for (const span of this.shells.values()) {
      if (span.sessionId === sessionId || span.background) continue
      const other = this.open(span.sessionId)
      if (other && sharesRoot(other.roots, recording.roots)) return span.sessionId
    }
    return null
  }

  /**
   * Holds a command until no other chat's command runs in a checkout this chat shares, so whatever a command writes has
   * one author. Waits at most `turnWaitMs`, or until `signal` aborts; `waiting` is told who it waits for, once.
   */
  async commandTurn(
    sessionId: string,
    toolUseId: string,
    signal?: AbortSignal,
    waiting?: (otherSessionId: string) => void,
  ): Promise<boolean> {
    const key = `${sessionId}\0${toolUseId}`
    if (!this.open(sessionId)) return false
    this.holding.add(key)
    // A command reported before its hook ran has not started yet.
    const early = this.shells.get(key)
    if (early) this.shells.delete(key)
    const deadline = this.now() + (this.options.turnWaitMs ?? TURN_WAIT_MS)
    let waited = false
    try {
      for (;;) {
        const recording = this.open(sessionId)
        const other = recording ? this.blocker(sessionId, recording) : null
        if (!other || signal?.aborted) break
        const left = deadline - this.now()
        if (left <= 0) break
        if (!waited) waiting?.(other)
        waited = true
        await new Promise<void>((resume) => {
          const timer = setTimeout(resume, left)
          const done = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', done)
            resume()
          }
          signal?.addEventListener('abort', done)
          this.wakers.push(done)
        })
      }
    } finally {
      this.holding.delete(key)
    }
    const recording = this.open(sessionId)
    if (recording && !this.shells.has(key)) this.start(key, sessionId, recording, this.now())
    return waited
  }

  private clash(sessionId: string, recording: Recording, path: string) {
    for (const [id, other] of this.recordings) {
      if (other.sessionId === sessionId || other.to !== null || !sharesRoot(other.roots, recording.roots)) continue
      if (
        !this.claims.some(
          (claim) => claim.sessionId === other.sessionId && claim.path === path && claim.at >= other.from,
        )
      )
        continue
      const mine = [...this.recordings].find(([, entry]) => entry === recording)![0]
      const pair = [mine, id].sort().join('\0')
      if (this.noticed.has(pair)) continue
      this.noticed.add(pair)
      this.options.clash?.(sessionId, other.sessionId, path)
    }
  }

  private overlapping(recording: Recording): Recording[] {
    const to = recording.to ?? Number.POSITIVE_INFINITY
    return [...this.recordings.values()].filter(
      (other) =>
        other.sessionId !== recording.sessionId &&
        sharesRoot(other.roots, recording.roots) &&
        other.from < to &&
        (other.to ?? Number.POSITIVE_INFINITY) > recording.from,
    )
  }

  /** The turn's checkouts that should be watched now but can't be. `anyway`: read them even after the overlap ends. */
  private unwatched(recording: Recording, anyway = false): string[] {
    return recording.roots.filter((root) => (anyway || this.wanted.has(root)) && !this.watchers.has(root))
  }

  private async read(roots: string[]): Promise<Signature> {
    const all: Signature = new Map()
    for (const root of roots)
      for (const [path, mark] of await (this.options.signature ?? changedFiles)(root)) all.set(path, mark)
    return all
  }

  /** Watches each checkout while two chats' turns are open in it, and only then. */
  private watchOverlaps() {
    const open = [...this.recordings.values()].filter((recording) => recording.to === null)
    const wanted = new Set<string>()
    for (const recording of open)
      if (this.overlapping(recording).some((other) => other.to === null))
        for (const root of recording.roots) wanted.add(root)
    this.wanted = wanted
    for (const [root, watcher] of this.watchers)
      if (!wanted.has(root)) {
        watcher.close()
        this.watchers.delete(root)
      }
    for (const root of wanted) {
      if (this.watchers.has(root)) continue
      const watcher = (this.options.watch ?? watchFolder)(
        root,
        (path) => this.changed(path),
        () => {
          // Too many folders for the system's watch limit, or the folder went away: commands are read instead.
          this.watchers.get(root)?.close()
          this.watchers.delete(root)
        },
      )
      if (watcher) this.watchers.set(root, watcher)
    }
  }

  /** A file under a watched checkout changed now. */
  changed(path: string, at = this.now()): void {
    if (IGNORED.test(path)) return
    const times = this.changes.get(path) ?? []
    if (times.includes(at)) return
    times.push(at)
    times.sort((a, b) => a - b)
    if (times.length > TIMES_KEPT) times.shift()
    this.changes.set(path, times)
  }

  /** Every command's changed files have been read. */
  async settled(): Promise<void> {
    while (this.reading.size) await Promise.all([...this.reading])
  }

  /** Who wrote each of these absolute paths during the turn, which must have ended. */
  authorship(reviewId: string, paths: string[]): Map<string, Authorship> {
    const result = new Map<string, Authorship>()
    const recording = this.recordings.get(reviewId)
    if (!recording) {
      for (const path of paths) result.set(path, { kind: 'mine' })
      return result
    }
    const others = this.overlapping(recording)
    const me = recording.sessionId
    const from = recording.from
    const to = recording.to ?? this.now()
    const sessions = new Set([me, ...others.map((other) => other.sessionId)])
    const savedByYou = (path: string) =>
      this.claims.some(
        (claim) => claim.sessionId === PERSON && claim.path === path && claim.at >= from && claim.at <= to,
      )
    if (!others.length) {
      // Alone in the checkout, every change is this turn's; one the person also saved is theirs to undo.
      for (const path of paths) result.set(path, savedByYou(path) ? { kind: 'mine', byYou: true } : { kind: 'mine' })
      return result
    }
    const spans = [...this.ended, ...this.shells.values()].filter((span) => sessions.has(span.sessionId))
    const runningAt = (time: number) =>
      new Set(
        spans
          .filter((span) => span.from <= time && time <= (span.to ?? Number.POSITIVE_INFINITY) + SETTLE_MS)
          .map((span) => span.sessionId),
      )
    const openAt = (time: number) =>
      new Set(
        [recording, ...others]
          .filter((entry) => entry.from <= time && time <= (entry.to ?? Number.POSITIVE_INFINITY))
          .map((entry) => entry.sessionId),
      )
    for (const path of paths) {
      const claimed = new Set(
        this.claims
          .filter((claim) => claim.path === path && sessions.has(claim.sessionId) && claim.at >= from && claim.at <= to)
          .map((claim) => claim.sessionId),
      )
      const byYou = savedByYou(path)
      const times = (this.changes.get(path) ?? []).filter((time) => time >= from && time <= to + SETTLE_MS)
      const writers = new Set(claimed)
      let unexplained = false
      for (const time of times) {
        const running = runningAt(time)
        const alone = running.size === 1 ? [...running][0]! : null
        // A command's write counts unless another thread said it wrote this very file.
        if (alone && (!claimed.size || claimed.has(alone))) writers.add(alone)
        else if (!claimed.size && openAt(time).size > 1) unexplained = true
      }
      const otherWriters = [...writers].filter((session) => session !== me)
      const you = byYou ? { byYou: true as const } : {}
      if (writers.has(me))
        result.set(
          path,
          otherWriters.length ? { kind: 'shared', with: otherWriters, ...you } : { kind: 'mine', ...you },
        )
      else if (otherWriters.length) result.set(path, { kind: 'other', by: otherWriters[0]! })
      else if (byYou) result.set(path, { kind: 'you' })
      // Unseen, it changed while this turn was the only one open; seen, nobody can say whose it is.
      else result.set(path, unexplained ? { kind: 'unknown' } : { kind: 'mine' })
    }
    return result
  }

  close(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.wake()
  }
}

function watchFolder(root: string, changed: (path: string) => void, failed: () => void): FSWatcher | null {
  try {
    const watcher = fsWatch(root, { recursive: true, persistent: false }, (_type, name) => {
      if (name) changed(join(root, name.toString()))
    })
    watcher.on('error', failed)
    return watcher
  } catch {
    return null
  }
}

/** A Git checkout's changed and new files, each by size and modification time; empty for any other folder. */
async function changedFiles(root: string): Promise<Signature> {
  const git = (args: string[]) =>
    exec('git', args, { cwd: root, maxBuffer: 16_000_000, timeout: 15_000 }).then((out) => out.stdout)
  const top = (await git(['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  if (!top) return new Map()
  const listed = (await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => ''))
    .split('\0')
    .filter(Boolean)
  const paths: string[] = []
  for (let index = 0; index < listed.length && paths.length < SIGNATURE_FILES; index++) {
    const entry = listed[index]!
    paths.push(join(top, entry.slice(3)))
    // A rename names its source next, which is no longer on disk.
    if (entry[0] === 'R' || entry[0] === 'C') index++
  }
  const marks = await Promise.all(
    paths.map(async (path) => {
      const info = await stat(path).catch(() => null)
      return [path, info ? `${info.size}:${info.mtimeMs}` : 'gone'] as const
    }),
  )
  return new Map(marks)
}
