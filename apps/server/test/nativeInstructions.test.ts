import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { includeReferences, inspectNativeInstructions } from '../src/rules/nativeInstructions'

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-native-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('finds includes outside code fences and inline code only', () => {
  expect(includeReferences('See @docs/a.md and `@skip.md`\n```\n@fenced.md\n```\n@~/x/b.md')).toEqual([
    'docs/a.md',
    '~/x/b.md',
  ])
})

it('inventories AGENTS.md, CLAUDE.md, nested files and rules folders with activation', () => {
  const home = temp()
  const repo = temp()
  mkdirSync(join(repo, 'pkg'))
  mkdirSync(join(repo, '.claude', 'rules'), { recursive: true })
  mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(repo, 'AGENTS.md'), '# Agents\nUse pnpm.')
  writeFileSync(join(repo, 'pkg', 'AGENTS.md'), 'Package notes')
  writeFileSync(join(repo, 'node_modules', 'dep', 'AGENTS.md'), 'ignored')
  writeFileSync(join(repo, '.claude', 'rules', 'api.md'), '---\npaths:\n  - "src/api/**"\n---\nAPI rules')
  const { files } = inspectNativeInstructions('p', [{ label: 'repo', path: repo }], home)
  expect(files.map((file) => [file.kind, file.nested])).toEqual([
    ['AGENTS.md', ''],
    ['rules-file', join('.claude', 'rules')],
    ['AGENTS.md', 'pkg'],
  ])
  const rule = files.find((file) => file.kind === 'rules-file')!
  expect(rule).toMatchObject({ activation: 'path-matched', frontmatterKeys: ['paths'], readBy: ['claude-code'] })
  expect(files[0]).toMatchObject({ activation: 'always', readBy: ['codex', 'opencode', 'cursor'] })
})

it('follows includes only inside the project and reports cycles, missing and outside links', () => {
  const home = temp()
  const repo = temp()
  const outside = temp()
  writeFileSync(join(outside, 'secret.md'), 'private')
  writeFileSync(join(repo, 'CLAUDE.md'), '@a.md\n@missing.md\n@../escape.md\n@link.md')
  writeFileSync(join(repo, 'a.md'), 'A\n@CLAUDE.md')
  symlinkSync(join(outside, 'secret.md'), join(repo, 'link.md'))
  const [file] = inspectNativeInstructions('p', [{ label: 'repo', path: repo }], home).files
  expect(file!.includes.map((include) => [include.reference, include.status])).toEqual([
    ['a.md', 'read'],
    ['CLAUDE.md', 'cycle'],
    ['missing.md', 'missing'],
    ['../escape.md', 'missing'],
    ['link.md', 'outside-allowed-folders'],
  ])
})

it('shows user-level files and refuses a symlinked instruction file that leaves the project', () => {
  const home = temp()
  const repo = temp()
  const outside = temp()
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'Personal')
  writeFileSync(join(outside, 'x.md'), 'x')
  symlinkSync(join(outside, 'x.md'), join(repo, 'AGENTS.md'))
  const { files } = inspectNativeInstructions('p', [{ label: 'repo', path: repo }], home)
  expect(files.find((file) => file.scope === 'user')).toMatchObject({ kind: 'CLAUDE.md', text: 'Personal' })
  expect(files.find((file) => file.scope === 'project')?.problem).toMatch(/outside the project/)
})
