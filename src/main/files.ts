// File access scoped to a binding's working directory.
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import type { DirEntry, FileContent, SaveResult, SearchMatch, SearchOptions, SearchResults, ReplaceFilePreview } from '../shared/types'

export class PathEscapeError extends Error {}

/** Ripgrep respects ignore files, skips binary files and never follows symlinks. */
export function searchText(root: string, repoId: string, options: SearchOptions, limit: number): Promise<SearchResults> {
  const args = ['--json', '--color', 'never', '--hidden', '--max-filesize', '2M']
  if (!options.caseSensitive) args.push('--ignore-case')
  if (options.wholeWord) args.push('--word-regexp')
  if (!options.regex) args.push('--fixed-strings')
  for (const pattern of options.include.split(',').map((entry) => entry.trim()).filter(Boolean)) args.push('--glob', pattern)
  for (const pattern of options.exclude.split(',').map((entry) => entry.trim()).filter(Boolean)) args.push('--glob', `!${pattern}`)
  args.push('--glob', '!**/.git/**', '--glob', '!**/.git', '--', options.query, '.')
  return new Promise((resolve, reject) => {
    const executable = ['/opt/homebrew/bin/rg', '/usr/local/bin/rg'].find((path) => existsSync(path)) ?? 'rg'
    const child = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const matches: SearchMatch[] = []
    let pending = '', stderr = '', limited = false, timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 15_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(0, 4000) })
    child.stdout.on('data', (chunk: string) => {
      if (limited) return
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        let event: { type: string; data: { path: { text?: string }; lines: { text?: string }; line_number: number; submatches: { start: number; end: number }[] } }
        try { event = JSON.parse(line) } catch {
          clearTimeout(timer); child.kill(); reject(new Error('Could not read search results.')); return
        }
        if (event.type !== 'match' || !event.data.path.text || !event.data.lines.text) continue
        const data = event.data, text = data.lines.text!.replace(/[\r\n]+$/, ''), bytes = Buffer.from(text)
        for (const hit of data.submatches) {
          const start = bytes.subarray(0, hit.start).toString('utf8').length
          const end = bytes.subarray(0, hit.end).toString('utf8').length
          const previewStart = Math.max(0, start - 60), previewEnd = Math.min(text.length, start + 180)
          matches.push({ repoId, path: data.path.text!.replace(/^\.\//, ''), line: data.line_number, column: start + 1, endColumn: end + 1, text: text.slice(previewStart, previewEnd), start: start - previewStart, end: Math.min(end, previewEnd) - previewStart })
          if (matches.length >= limit) { limited = true; child.kill(); return }
        }
      }
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' ? 'Project search requires ripgrep (rg) to be installed and available on PATH.' : error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error('Search timed out. Narrow the repository or include filter.'))
      if (!limited && code !== 0 && code !== 1) return reject(new Error(stderr.trim() || 'Project search failed.'))
      resolve({ matches, limited })
    })
  })
}

export function hashOf(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function replacementPlan(root: string, repoId: string, options: SearchOptions, replacement: string, matches: SearchMatch[]): Promise<{ preview: ReplaceFilePreview; content: string }[]> {
  const grouped = new Map<string, SearchMatch[]>()
  for (const match of matches) if (match.repoId === repoId) grouped.set(match.path, [...(grouped.get(match.path) ?? []), match])
  const regex = options.regex ? new RegExp(options.query.replace(/\(\?P</g, '(?<'), `u${options.caseSensitive ? '' : 'i'}`) : null
  const plans: { preview: ReplaceFilePreview; content: string }[] = []
  let bytes = 0
  for (const [path, hits] of grouped) {
    const file = await readText(root, path)
    bytes += Buffer.byteLength(file.content)
    if (bytes > 20_000_000) throw new Error('Replacement spans too much content. Narrow the include filter or repository.')
    const starts = [0]
    for (let index = 0; index < file.content.length; index++) if (file.content[index] === '\n') starts.push(index + 1)
    let content = file.content, before = '', after = ''
    for (const hit of [...hits].sort((a, b) => b.line - a.line || b.column - a.column)) {
      const lineStart = starts[hit.line - 1]
      if (lineStart === undefined) throw new Error('Files changed during search. Refresh before replacing.')
      const start = lineStart + hit.column - 1, end = lineStart + hit.endColumn - 1
      const text = file.content.slice(start, end)
      let insert = replacement
      if (!regex && (options.caseSensitive ? text !== options.query : text.toLocaleLowerCase() !== options.query.toLocaleLowerCase())) throw new Error('Files changed during search. Refresh before replacing.')
      if (regex) {
        const match = regex.exec(text)
        if (!match || match.index !== 0 || match[0].length !== text.length) throw new Error('This expression cannot be expanded for replacement. Simplify the regular expression.')
        insert = text.replace(regex, replacement)
      }
      before = text.slice(0, 160); after = insert.slice(0, 160)
      content = content.slice(0, start) + insert + content.slice(end)
    }
    plans.push({ preview: { repoId, path, hash: file.hash, count: hits.length, before, after }, content })
  }
  return plans
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolves a binding-relative path to an absolute path inside `root`, rejecting `..`
 * escapes, absolute paths, symlinks that point outside the root, and the .git directory.
 * `root` must already be canonical.
 */
export async function resolveInRoot(root: string, relPath: string): Promise<string> {
  if (isAbsolute(relPath)) throw new PathEscapeError(`Expected a relative path, got ${relPath}`)
  const target = normalize(join(root, relPath))
  if (!isInside(root, target)) throw new PathEscapeError(`${relPath} is outside ${root}`)
  const segments = relative(root, target).split(sep)
  if (segments.includes('.git')) throw new PathEscapeError('Access to .git is not allowed')
  // Canonicalize the deepest existing ancestor so a symlink cannot redirect outside the root.
  let probe = target
  while (!existsSync(probe)) probe = dirname(probe)
  const real = await realpath(probe)
  if (!isInside(root, real)) throw new PathEscapeError(`${relPath} resolves outside ${root}`)
  if (relative(root, real).split(sep).includes('.git')) throw new PathEscapeError('Access to .git is not allowed')
  return join(real, relative(probe, target))
}

/** Mutating an entry acts on the selected symlink itself, after validating its scope. */
export async function resolveEntryInRoot(root: string, path: string): Promise<string> {
  await resolveInRoot(root, path)
  return normalize(join(root, path))
}

export async function listDir(root: string, relPath: string): Promise<DirEntry[]> {
  const abs = await resolveInRoot(root, relPath)
  const entries = await readdir(abs, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.git' && (e.isDirectory() || e.isFile() || e.isSymbolicLink()))
    .map((e): DirEntry => ({
      name: e.name,
      path: relPath ? `${relPath.split(sep).join('/')}/${e.name}` : e.name,
      kind: e.isDirectory() ? 'dir' : 'file',
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
}

/** Quick open and file mentions also work in folders with no Git metadata. */
export async function listFolderFiles(root: string, limit = 50_000): Promise<string[]> {
  const paths: string[] = [], pending = ['']
  let scanned = 0
  while (pending.length && paths.length < limit && scanned < 100_000) {
    const dir = pending.pop()!
    const entries = await readdir(join(root, dir), { withFileTypes: true })
    for (const entry of entries) {
      if (++scanned > 100_000 || paths.length >= limit) break
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = dir ? `${dir}/${entry.name}` : entry.name
      // Never traverse symlinks into another chat or outside the working folder.
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) paths.push(path)
    }
  }
  return paths.sort()
}

export async function createEntry(root: string, path: string, kind: 'file' | 'dir'): Promise<void> {
  if (!path.trim()) throw new Error('Enter a file or folder name.')
  const absolute = await resolveInRoot(root, path)
  if (absolute === root) throw new Error('Choose a name inside this repository.')
  if (kind === 'dir') await mkdir(absolute)
  else await writeFile(absolute, '', { flag: 'wx' })
}

export async function renameEntry(root: string, path: string, destination: string): Promise<void> {
  const source = await resolveEntryInRoot(root, path), target = await resolveEntryInRoot(root, destination)
  if (source === root || target === root) throw new Error('The repository root cannot be renamed.')
  if (existsSync(target)) throw new Error('A file or folder already exists with that name.')
  await rename(source, target)
}

/** Copies a file or folder to `destination` (never over something that exists, never a folder into itself). */
export async function copyEntry(root: string, path: string, destination: string): Promise<void> {
  const source = await resolveEntryInRoot(root, path), target = await resolveEntryInRoot(root, destination)
  if (source === root || target === root) throw new Error('The repository root cannot be copied.')
  if (existsSync(target)) throw new Error('A file or folder already exists with that name.')
  if (target === source || target.startsWith(source + sep)) throw new Error('A folder cannot be copied into itself.')
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
}

export async function readText(root: string, relPath: string): Promise<FileContent> {
  const buf = await readFile(await resolveInRoot(root, relPath))
  return { content: buf.toString('utf8'), hash: hashOf(buf) }
}

/** Markdown assets use the same repository boundary as the editor. */
export async function readImage(root: string, relPath: string): Promise<string> {
  const types: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon' }
  const mime = types[extname(relPath).toLowerCase()]
  if (!mime) throw new Error('Unsupported image format.')
  const path = await resolveInRoot(root, relPath)
  if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('Preview images must be smaller than 10 MB.')
  const bytes = await readFile(path)
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Preview images must be smaller than 10 MB.')
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/**
 * Writes only if the file on disk still matches `baseHash` (the hash the editor loaded).
 * A mismatch means an agent, terminal or external tool changed it; the caller must reconcile.
 */
export async function writeText(root: string, relPath: string, content: string, baseHash: string | null): Promise<SaveResult> {
  const abs = await resolveInRoot(root, relPath)
  const disk = existsSync(abs) ? hashOf(await readFile(abs)) : null
  if (disk !== baseHash) return { ok: false, reason: 'changed-on-disk', diskHash: disk ?? '' }
  await writeFile(abs, content, 'utf8')
  return { ok: true, hash: hashOf(Buffer.from(content, 'utf8')) }
}
