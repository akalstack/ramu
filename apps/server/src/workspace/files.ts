import { REPLACE_CONTENT_LIMIT } from '@ramu/shared/search/searchLimits'
// File access scoped to a binding's working directory.
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import type {
  DirEntry,
  FileContent,
  SaveResult,
  SearchMatch,
  SearchOptions,
  SearchResults,
  ReplaceFilePreview,
} from '@ramu/shared/types'

export class PathEscapeError extends Error {}

/** Ripgrep respects ignore files, skips binary files and never follows symlinks. */
export function searchText(
  root: string,
  repoId: string,
  options: SearchOptions,
  limit: number,
): Promise<SearchResults> {
  const args = ['--json', '--color', 'never', '--hidden', '--max-filesize', '2M']
  if (!options.caseSensitive) args.push('--ignore-case')
  if (options.wholeWord) args.push('--word-regexp')
  if (!options.regex) args.push('--fixed-strings')
  for (const pattern of options.include
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean))
    args.push('--glob', pattern)
  for (const pattern of options.exclude
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean))
    args.push('--glob', `!${pattern}`)
  args.push('--glob', '!**/.git/**', '--glob', '!**/.git', '--', options.query, '.')
  return new Promise((resolve, reject) => {
    const executable =
      ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg'].find((path) => existsSync(path)) ?? 'rg'
    const child = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const matches: SearchMatch[] = []
    let pending = '',
      stderr = '',
      limited = false,
      timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 15_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(0, 4000)
    })
    child.stdout.on('data', (chunk: string) => {
      if (limited) return
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        let event: {
          type: string
          data: {
            path: { text?: string }
            lines: { text?: string }
            line_number: number
            submatches: { start: number; end: number }[]
          }
        }
        try {
          event = JSON.parse(line)
        } catch {
          clearTimeout(timer)
          child.kill()
          reject(new Error('Could not read search results.'))
          return
        }
        if (event.type !== 'match' || !event.data.path.text || !event.data.lines.text) continue
        const data = event.data,
          text = data.lines.text!.replace(/[\r\n]+$/, ''),
          bytes = Buffer.from(text)
        for (const hit of data.submatches) {
          if (matches.length >= limit) {
            limited = true
            child.kill()
            return
          }
          const start = bytes.subarray(0, hit.start).toString('utf8').length
          const end = bytes.subarray(0, hit.end).toString('utf8').length
          const previewStart = Math.max(0, start - 60),
            previewEnd = Math.min(text.length, start + 180)
          matches.push({
            repoId,
            path: data.path.text!.replace(/^\.\//, ''),
            line: data.line_number,
            column: start + 1,
            endColumn: end + 1,
            text: text.slice(previewStart, previewEnd),
            start: start - previewStart,
            end: Math.min(end, previewEnd) - previewStart,
          })
        }
      }
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        new Error(
          error.code === 'ENOENT'
            ? 'Project search requires ripgrep (rg). Install it (macOS: brew install ripgrep; Debian/Ubuntu: apt install ripgrep) and restart Ramu.'
            : error.message,
        ),
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error('Search timed out. Narrow the repository or include filter.'))
      if (!limited && code !== 0 && code !== 1)
        return reject(new Error(stderr.trim().replace(/^rg: /, '') || 'Project search failed.'))
      resolve({ matches, limited })
    })
  })
}

export function hashOf(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function replacementPlan(
  root: string,
  repoId: string,
  options: SearchOptions,
  replacement: string,
  matches: SearchMatch[],
): Promise<{ preview: ReplaceFilePreview; content: string }[]> {
  const grouped = new Map<string, SearchMatch[]>()
  for (const match of matches)
    if (match.repoId === repoId) {
      const hits = grouped.get(match.path) ?? []
      hits.push(match)
      grouped.set(match.path, hits)
    }
  const regex = options.regex
    ? new RegExp(options.query.replace(/\(\?P</g, '(?<'), `uy${options.caseSensitive ? '' : 'i'}`)
    : null
  const plans: { preview: ReplaceFilePreview; content: string }[] = []
  let bytes = 0
  for (const [path, hits] of grouped) {
    const file = await readText(root, path)
    bytes += Buffer.byteLength(file.content)
    if (bytes > REPLACE_CONTENT_LIMIT)
      throw new Error('Replacement spans too much content. Narrow the include filter or repository.')
    const starts = [0]
    for (let index = 0; index < file.content.length; index++) if (file.content[index] === '\n') starts.push(index + 1)
    let before = '',
      after = '',
      cursor = file.content.length
    const chunks: string[] = []
    for (const hit of [...hits].sort((a, b) => b.line - a.line || b.column - a.column)) {
      const lineStart = starts[hit.line - 1]
      if (lineStart === undefined) throw new Error('Files changed during search. Refresh before replacing.')
      const start = lineStart + hit.column - 1,
        end = lineStart + hit.endColumn - 1
      const text = file.content.slice(start, end)
      let insert = replacement
      if (
        !regex &&
        (options.caseSensitive
          ? text !== options.query
          : text.toLocaleLowerCase() !== options.query.toLocaleLowerCase())
      )
        throw new Error('Files changed during search. Refresh before replacing.')
      if (regex) {
        // Match against the original line so anchors, boundaries and lookarounds
        // retain the context ripgrep used. Sticky matching pins the exact hit.
        const line = file.content.slice(lineStart, starts[hit.line] ?? file.content.length).replace(/[\r\n]+$/, '')
        const offset = hit.column - 1
        regex.lastIndex = offset
        const match = regex.exec(line)
        if (!match || match.index !== offset || match[0] !== text)
          throw new Error('Files changed or the expression cannot be expanded. Review replacement again.')
        regex.lastIndex = offset
        const replaced = line.replace(regex, replacement)
        insert = replaced.slice(offset, replaced.length - (line.length - offset - text.length))
      }
      before = text.slice(0, 160)
      after = insert.slice(0, 160)
      bytes += Buffer.byteLength(insert) - Buffer.byteLength(text)
      if (bytes > REPLACE_CONTENT_LIMIT)
        throw new Error('Replacement produces too much content. Narrow the search or shorten the replacement.')
      if (end > cursor) throw new Error('Search matches overlap. Review replacement again.')
      chunks.push(file.content.slice(end, cursor), insert)
      cursor = start
    }
    chunks.push(file.content.slice(0, cursor))
    const content = chunks.reverse().join('')
    plans.push({ preview: { repoId, path, hash: file.hash, count: hits.length, before, after }, content })
  }
  return plans
}

const MAX_NAME_BYTES = 255
const MAX_PATH_BYTES = 1000
/** Beyond what the filesystem accepts: say so, rather than surfacing ENAMETOOLONG or a null-byte TypeError. */
function assertUsablePath(relPath: string): void {
  if (relPath.includes('\0')) throw new Error('A path cannot contain null characters.')
  for (const segment of relPath.split(/[\\/]/)) {
    if (Buffer.byteLength(segment) > MAX_NAME_BYTES)
      throw new Error(`A file or folder name can be at most ${MAX_NAME_BYTES} bytes long.`)
  }
}

// Control characters and bidirectional overrides make a name read differently from what it is (e.g. "txt.png" for "png.txt").
// eslint-disable-next-line no-control-regex -- matches control characters on purpose
const MISLEADING_NAME = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/
/** New names only: existing files with odd names must stay openable, but Ramu does not create new ones. */
export function assertNewName(relPath: string): void {
  if (MISLEADING_NAME.test(relPath)) throw new Error('Names cannot contain control or text-direction characters.')
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
  assertUsablePath(relPath)
  const target = normalize(join(root, relPath))
  // The OS limits whole paths too (1024 bytes on macOS), and reports it as an opaque ENAMETOOLONG.
  if (Buffer.byteLength(target) > MAX_PATH_BYTES) throw new Error('That path is too long.')
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
  const paths: string[] = [],
    pending = ['']
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
  assertNewName(path)
  const absolute = await resolveInRoot(root, path)
  if (absolute === root) throw new Error('Choose a name inside this repository.')
  if (kind === 'dir') await mkdir(absolute)
  else await writeFile(absolute, '', { flag: 'wx' })
}

export async function renameEntry(root: string, path: string, destination: string): Promise<void> {
  assertNewName(destination)
  const source = await resolveEntryInRoot(root, path),
    target = await resolveEntryInRoot(root, destination)
  if (source === root || target === root) throw new Error('The repository root cannot be renamed.')
  if (existsSync(target)) throw new Error('A file or folder already exists with that name.')
  await rename(source, target)
}

/** Copies a file or folder to `destination` (never over something that exists, never a folder into itself). */
export async function copyEntry(root: string, path: string, destination: string): Promise<void> {
  assertNewName(destination)
  const source = await resolveEntryInRoot(root, path),
    target = await resolveEntryInRoot(root, destination)
  if (source === root || target === root) throw new Error('The repository root cannot be copied.')
  if (existsSync(target)) throw new Error('A file or folder already exists with that name.')
  if (target === source || target.startsWith(source + sep)) throw new Error('A folder cannot be copied into itself.')
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
}

/** Native drops can include directories, which Chromium represents as zero-byte Files. */
export async function describeDroppedPaths(paths: string[]): Promise<{ path: string; kind: 'file' | 'dir' }[]> {
  return Promise.all(
    paths.map(async (path) => {
      if (!isAbsolute(path)) throw new Error('Expected an absolute dropped path.')
      const info = await stat(path)
      if (!info.isDirectory() && !info.isFile()) throw new Error('Drop regular files or folders.')
      return { path, kind: info.isDirectory() ? ('dir' as const) : ('file' as const) }
    }),
  )
}

/** Copy native drops into the chosen folder without overwriting existing entries. */
export async function importEntries(root: string, dir: string, paths: string[]): Promise<string[]> {
  const folder = await resolveInRoot(root, dir)
  if (!(await stat(folder)).isDirectory()) throw new Error('Drop into a folder.')
  const taken = new Set(await readdir(folder)),
    imported: string[] = []
  for (const path of new Set(paths)) {
    if (!isAbsolute(path)) throw new Error('Expected an absolute dropped path.')
    const info = await lstat(path)
    if (!info.isDirectory() && !info.isFile() && !info.isSymbolicLink())
      throw new Error('Drop regular files or folders.')
    const original = basename(path)
    assertNewName(original)
    let name = original
    const dot = original.lastIndexOf('.'),
      stem = dot > 0 ? original.slice(0, dot) : original,
      ext = dot > 0 ? original.slice(dot) : ''
    for (let n = 1; taken.has(name); n++) name = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
    const destination = dir ? `${dir}/${name}` : name
    const target = await resolveEntryInRoot(root, destination),
      source = await realpath(path)
    if (target === source || target.startsWith(source + sep)) throw new Error('A folder cannot be copied into itself.')
    await cp(path, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
    taken.add(name)
    imported.push(destination)
  }
  return imported
}

/** What the editor will open and save. Reads are checked on disk first so a huge file is never loaded into memory. */
export const MAX_EDITABLE_BYTES = 20 * 1024 * 1024

export async function readText(root: string, relPath: string): Promise<FileContent> {
  const abs = await resolveInRoot(root, relPath)
  if ((await stat(abs)).size > MAX_EDITABLE_BYTES)
    throw new Error(
      `This file is larger than ${MAX_EDITABLE_BYTES / 1024 / 1024} MB and is too large to open in the editor.`,
    )
  const buf = await readFile(abs)
  // A NUL byte means binary data: decoding it as UTF-8 would show garbage and corrupt the file on save.
  if (buf.subarray(0, 8192).includes(0)) throw new Error('This is a binary file and cannot be shown as text.')
  return { content: buf.toString('utf8'), hash: hashOf(buf) }
}

/** Markdown assets use the same repository boundary as the editor. */
export async function readImage(root: string, relPath: string): Promise<string> {
  const types: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
  }
  const mime = types[extname(relPath).toLowerCase()]
  if (!mime) throw new Error('Unsupported image format.')
  const path = await resolveInRoot(root, relPath)
  if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('Preview images must be smaller than 10 MB.')
  const bytes = await readFile(path)
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Preview images must be smaller than 10 MB.')
  return `data:${mime};base64,${bytes.toString('base64')}`
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}
const MAX_MEDIA_BYTES = 25 * 1024 * 1024

/** Images, PDFs, audio and video opened from the explorer, as a data URL under the same repository boundary. */
export async function readMedia(
  root: string,
  relPath: string,
): Promise<{ mimeType: string; size: number; url: string }> {
  const mimeType = MEDIA_TYPES[extname(relPath).toLowerCase()]
  if (!mimeType) throw new Error('Unsupported file format.')
  const path = await resolveInRoot(root, relPath)
  const { size } = await stat(path)
  if (size > MAX_MEDIA_BYTES) throw new Error('Files larger than 25 MB cannot be previewed.')
  const bytes = await readFile(path)
  return { mimeType, size: bytes.length, url: `data:${mimeType};base64,${bytes.toString('base64')}` }
}

/**
 * Writes only if the file on disk still matches `baseHash` (the hash the editor loaded).
 * A mismatch means an agent, terminal or external tool changed it; the caller must reconcile.
 */
export async function writeText(
  root: string,
  relPath: string,
  content: string,
  baseHash: string | null,
): Promise<SaveResult> {
  const abs = await resolveInRoot(root, relPath)
  const disk = existsSync(abs) ? hashOf(await readFile(abs)) : null
  if (disk !== baseHash) return { ok: false, reason: 'changed-on-disk', diskHash: disk ?? '' }
  await writeFile(abs, content, 'utf8')
  return { ok: true, hash: hashOf(Buffer.from(content, 'utf8')) }
}
