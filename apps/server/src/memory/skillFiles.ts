import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { ManagedSkill } from '@ramu/shared/types'

export function safeSkillPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length < 500 &&
    !path.includes('\\') &&
    !path.includes(':') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'))
  )
}
export const isSkillScript = (path: string, mode = 0) =>
  path.split('/').includes('scripts') ||
  /\.(?:sh|bash|zsh|fish|py|pyc|js|mjs|cjs|ts|tsx|jsx|rb|pl|ps1|bat|cmd|exe|dll|so|dylib|wasm|jar)$/i.test(path) ||
  !!(mode & 0o111)

export function readSkillFolder(root: string): {
  markdown: string
  files: Record<string, string>
  scripts: Set<string>
} {
  const files: Record<string, string> = {},
    scripts = new Set<string>()
  let bytes = 0,
    count = 0
  function walk(dir: string, prefix = '', depth = 0) {
    if (depth > 16) throw new Error('Skill folders are nested too deeply.')
    for (const name of readdirSync(dir)) {
      const path = prefix ? `${prefix}/${name}` : name
      if (!safeSkillPath(path)) throw new Error(`Unsafe skill path: ${path}`)
      const full = join(dir, name),
        stat = lstatSync(full)
      if (++count > 1000) throw new Error('Skill exceeds 1000 entries.')
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error('Skill folders cannot contain symlinks or special files.')
      if (stat.isDirectory()) {
        walk(full, path, depth + 1)
        continue
      }
      if (stat.size > 10 * 1024 * 1024 || (bytes += stat.size) > 25 * 1024 * 1024)
        throw new Error('Skill exceeds download limits (10 MiB per file, 25 MiB total, 1000 files).')
      files[path] = readFileSync(full).toString('base64')
      if (isSkillScript(path, stat.mode)) scripts.add(path)
    }
  }
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Invalid skill folder.')
  walk(root)
  scripts.delete('SKILL.md')
  if (!files['SKILL.md']) throw new Error('Skill is missing SKILL.md.')
  return { markdown: Buffer.from(files['SKILL.md'], 'base64').toString('utf8'), files, scripts }
}

export function skillMetadata(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(markdown)
  if (!match) throw new Error('SKILL.md must have name and description in YAML frontmatter.')
  const metadata = parse(match[1]!, { maxAliasCount: 0 }) as Record<string, unknown>
  if (
    !metadata ||
    typeof metadata.name !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) ||
    metadata.name.length > 64 ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 4000
  )
    throw new Error('Skill needs a short kebab-case name and a description.')
  return { name: metadata.name, description: metadata.description.trim(), content: match[2]!, metadata }
}

/** Reconcile Ramu-owned files without rewriting unchanged references during provider reads. */
export function writeInstalledSkill(dir: string, name: string, skill: ManagedSkill): void {
  if (!skill.installation) return
  const { metadata } = skillMetadata(skill.installation.markdown)
  const wanted = new Map<string, Buffer>()
  for (const [path, data] of Object.entries(skill.installation.files)) {
    if (!safeSkillPath(path)) throw new Error('Invalid installed skill path.')
    if (path !== 'SKILL.md') wanted.set(path, Buffer.from(data, 'base64'))
  }
  wanted.set(
    'SKILL.md',
    Buffer.from(`---\n${stringify({ ...metadata, name, description: skill.description })}---\n${skill.content}\n`),
  )
  try {
    if (lstatSync(dir).isSymbolicLink()) throw new Error('Skill destination cannot be a link.')
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  mkdirSync(dir, { recursive: true })
  const clean = (folder: string, prefix = '') => {
    for (const entry of readdirSync(folder)) {
      const path = prefix ? `${prefix}/${entry}` : entry,
        full = join(folder, entry),
        stat = lstatSync(full)
      const keep = stat.isDirectory() ? [...wanted.keys()].some((key) => key.startsWith(`${path}/`)) : wanted.has(path)
      if (stat.isSymbolicLink() || !keep) rmSync(full, { recursive: true, force: true })
      else if (stat.isDirectory()) clean(full, path)
    }
  }
  clean(dir)
  for (const [path, bytes] of wanted) {
    const target = join(dir, path)
    try {
      if (readFileSync(target).equals(bytes)) continue
    } catch {
      /* Missing or changed. */
    }
    mkdirSync(dirname(target), { recursive: true })
    const temporary = join(dirname(target), `.${randomUUID()}.tmp`)
    writeFileSync(temporary, bytes, { mode: 0o600 })
    renameSync(temporary, target)
  }
}
