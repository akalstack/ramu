import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  NATIVE_INSTRUCTION_PREVIEW_LIMIT,
  type AgentProvider,
  type NativeInstructionFile,
  type NativeInstructionInclude,
  type NativeInstructions,
} from '@ramu/shared/types'

const MAX_FILE = 256 * 1024
const MAX_DEPTH = 2
const MAX_DIRECTORIES = 300
const MAX_FILES = 60
const MAX_INCLUDES = 20
const MAX_INCLUDE_DEPTH = 5
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'vendor', '.venv'])

/** Providers that read each file on their own, from their documentation; Ramu does not verify this at runtime. */
const READERS: Record<NativeInstructionFile['kind'], AgentProvider[]> = {
  'AGENTS.md': ['codex', 'opencode', 'cursor'],
  'CLAUDE.md': ['claude-code'],
  'rules-file': [],
}

const shown = (path: string, home: string) =>
  path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path

/** Reads a regular file inside `allowed`; symbolic links that leave it are refused. */
function readInside(
  path: string,
  allowed: string[],
): { text: string } | { problem: NativeInstructionInclude['status'] } {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return { problem: 'missing' }
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return { problem: 'missing' }
  }
  if (!allowed.some((root) => real === root || real.startsWith(root + sep)))
    return { problem: 'outside-allowed-folders' }
  const target = lstatSync(real)
  if (!target.isFile()) return { problem: 'not-a-file' }
  if (target.size > MAX_FILE) return { problem: 'too-large' }
  return { text: readFileSync(real, 'utf8') }
}

/** `@path` references outside fenced code, in the order they appear. */
export function includeReferences(text: string): string[] {
  const found: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    for (const match of line.replaceAll(/`[^`]*`/g, '').matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+\.[\w]+)/g))
      if (!found.includes(match[1]!)) found.push(match[1]!)
  }
  return found
}

/**
 * Follows includes only inside the allowed folders, with cycle, depth, count and size limits. Nothing remote is fetched
 * and no link outside the allowed folders is followed; those are reported instead.
 */
function followIncludes(
  file: string,
  text: string,
  allowed: string[],
  home: string,
  seen: Set<string>,
  depth: number,
  out: NativeInstructionInclude[],
) {
  for (const reference of includeReferences(text)) {
    if (out.length >= MAX_INCLUDES) {
      out.push({ reference, status: 'limit', characters: 0 })
      return
    }
    const target = reference.startsWith('~/')
      ? join(home, reference.slice(2))
      : isAbsolute(reference)
        ? reference
        : resolve(dirname(file), reference)
    if (depth >= MAX_INCLUDE_DEPTH) {
      out.push({ reference, status: 'too-deep', characters: 0 })
      continue
    }
    let real = target
    try {
      real = realpathSync(target)
    } catch {
      // Reported as missing below.
    }
    if (seen.has(real)) {
      out.push({ reference, status: 'cycle', characters: 0 })
      continue
    }
    const read = readInside(target, allowed)
    if ('problem' in read) {
      out.push({ reference, status: read.problem, characters: 0 })
      continue
    }
    seen.add(real)
    out.push({ reference, status: 'read', characters: read.text.length })
    followIncludes(real, read.text, allowed, home, seen, depth + 1, out)
  }
}

/** Frontmatter keys and how the file says it activates; the body is not interpreted. */
export function instructionFrontmatter(text: string): Pick<NativeInstructionFile, 'frontmatterKeys' | 'activation'> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) return { frontmatterKeys: [], activation: 'always' }
  const keys = [...match[1]!.matchAll(/^([A-Za-z][\w-]*)\s*:/gm)].map((entry) => entry[1]!)
  const pathKeys = keys.some((key) => key === 'paths' || key === 'globs')
  const alwaysApply = /^alwaysApply:\s*true\s*$/m.test(match[1]!)
  return {
    frontmatterKeys: [...new Set(keys)],
    activation: alwaysApply ? 'always' : pathKeys ? 'path-matched' : 'unknown',
  }
}

function describe(
  path: string,
  kind: NativeInstructionFile['kind'],
  scope: NativeInstructionFile['scope'],
  label: string,
  nested: string,
  readBy: AgentProvider[],
  allowed: string[],
  home: string,
): NativeInstructionFile {
  const base = {
    path: shown(path, home),
    kind,
    scope,
    label,
    readBy,
    nested,
    characters: 0,
    text: '',
    truncated: false,
    frontmatterKeys: [],
    activation: 'unknown' as const,
    includes: [],
  }
  const read = readInside(path, allowed)
  if ('problem' in read) {
    const reasons: Partial<Record<typeof read.problem, string>> = {
      missing: 'The file disappeared before it could be read.',
      'outside-allowed-folders': 'This link leads outside the project, so Ramu does not read it.',
      'too-large': 'The file is larger than 256 KiB, so Ramu does not read it.',
      'not-a-file': 'This is not a regular file.',
    }
    return { ...base, problem: reasons[read.problem] ?? 'The file cannot be read.' }
  }
  const includes: NativeInstructionInclude[] = []
  if (kind === 'CLAUDE.md' || kind === 'AGENTS.md') {
    let real = path
    try {
      real = realpathSync(path)
    } catch {
      // The file was read above, so this only guards a race.
    }
    followIncludes(real, read.text, allowed, home, new Set([real]), 0, includes)
  }
  return {
    ...base,
    characters: read.text.length,
    text: read.text.slice(0, NATIVE_INSTRUCTION_PREVIEW_LIMIT),
    truncated: read.text.length > NATIVE_INSTRUCTION_PREVIEW_LIMIT,
    ...instructionFrontmatter(read.text),
    includes,
  }
}

const safeReaddir = (path: string) => {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Inventories instruction files the providers read on their own: `AGENTS.md` and `CLAUDE.md` in each project folder
 * and its subfolders (to a small depth), Claude's and Cursor's rules folders, and the user-level files. Read-only and
 * bounded; nothing is executed, imported, edited or delivered.
 */
export function inspectNativeInstructions(
  projectId: string | null,
  roots: { label: string; path: string }[],
  home = homedir(),
): NativeInstructions {
  const files: NativeInstructionFile[] = []
  const add = (file: NativeInstructionFile) => {
    if (files.length < MAX_FILES) files.push(file)
  }
  const realHome = (() => {
    try {
      return realpathSync(home)
    } catch {
      return home
    }
  })()
  for (const [dir, name, kind, provider] of [
    [join(home, '.claude'), 'CLAUDE.md', 'CLAUDE.md', 'Claude'],
    [join(home, '.codex'), 'AGENTS.md', 'AGENTS.md', 'Codex'],
  ] as const) {
    const path = join(dir, name)
    if (lstatSync(path, { throwIfNoEntry: false }))
      add(describe(path, kind, 'user', provider, '', READERS[kind], [realpathSync(dir)], home))
  }
  for (const root of roots) {
    let real: string
    try {
      real = realpathSync(root.path)
    } catch {
      continue
    }
    let visited = 0
    const walk = (dir: string, depth: number) => {
      if (visited++ >= MAX_DIRECTORIES) return
      const nested = relative(root.path, dir)
      for (const kind of ['AGENTS.md', 'CLAUDE.md'] as const) {
        const path = join(dir, kind)
        if (lstatSync(path, { throwIfNoEntry: false }))
          add(describe(path, kind, 'project', root.label, nested, READERS[kind], [real], home))
      }
      if (depth === 0) {
        for (const [folder, extensions, readers] of [
          [join(dir, '.claude', 'rules'), ['.md'], ['claude-code']],
          [join(dir, '.cursor', 'rules'), ['.md', '.mdc'], ['cursor']],
        ] as const)
          for (const entry of safeReaddir(folder).sort((a, b) => a.name.localeCompare(b.name)))
            if (extensions.some((extension) => entry.name.endsWith(extension)) && !entry.isDirectory())
              add(
                describe(
                  join(folder, entry.name),
                  'rules-file',
                  'project',
                  root.label,
                  relative(root.path, folder),
                  [...readers] as AgentProvider[],
                  [real],
                  home,
                ),
              )
      }
      if (depth >= MAX_DEPTH) return
      for (const entry of safeReaddir(dir).sort((a, b) => a.name.localeCompare(b.name)))
        if (entry.isDirectory() && !entry.isSymbolicLink() && !SKIPPED.has(entry.name) && !entry.name.startsWith('.'))
          walk(join(dir, entry.name), depth + 1)
    }
    walk(root.path, 0)
  }
  return { projectId, files }
}
