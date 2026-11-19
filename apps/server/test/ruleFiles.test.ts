import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { RuleInput } from '@ramu/shared/types'
import { openDb } from '../src/db'
import { RuleStore } from '../src/rules/rules'
import { RuleFiles } from '../src/rules/ruleFiles'

let dir: string, repoA: string, repoB: string, claudeHome: string
let rules: RuleStore
let files: RuleFiles
let repositories: { projectId: string; root: string }[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-rule-files-'))
  repoA = join(dir, 'a')
  repoB = join(dir, 'b')
  claudeHome = join(dir, 'claude-home')
  mkdirSync(repoA)
  mkdirSync(repoB)
  rules = new RuleStore(openDb(':memory:'))
  repositories = [
    { projectId: 'p1', root: repoA },
    { projectId: 'p1', root: repoB },
  ]
  files = new RuleFiles(
    { rules: () => rules.list(), repositories: () => repositories, claudeHome: () => claudeHome },
    dir,
  )
})
afterEach(() => {
  chmodSync(repoB, 0o755)
  rmSync(dir, { recursive: true, force: true })
})

const input = (patch: Partial<RuleInput> = {}): RuleInput => ({
  name: 'API handlers',
  body: 'Validate every input with zod.',
  projectId: 'p1',
  providers: [],
  activation: 'paths',
  paths: ['src/api/**', '**/*.test.ts'],
  enabled: true,
  ...patch,
})
const rulesIn = (root: string) => {
  const folder = join(root, '.claude', 'rules')
  return existsSync(folder) ? readdirSync(folder).sort() : []
}

it("writes a project path rule into each of the project's repositories with paths frontmatter and Ramu's marker", () => {
  const rule = rules.save(input())
  const status = files.sync()
  for (const root of [repoA, repoB]) {
    expect(rulesIn(root)).toEqual(['ramu-api-handlers.md'])
    const text = readFileSync(join(root, '.claude', 'rules', 'ramu-api-handlers.md'), 'utf8')
    expect(text).toMatch(/^---\n/)
    expect(text).toContain('paths:\n  - src/api/**\n  - "**/*.test.ts"\n')
    expect(text).toContain(`ramu-rule: ${rule.id}\n---\n`)
    expect(text).toContain('# API handlers\n\nValidate every input with zod.\n')
  }
  expect(status).toEqual([
    {
      ruleId: rule.id,
      targets: [
        { path: join('~', 'a', '.claude', 'rules', 'ramu-api-handlers.md'), kind: 'repository' },
        { path: join('~', 'b', '.claude', 'rules', 'ramu-api-handlers.md'), kind: 'repository' },
      ],
    },
  ])
  expect(rulesIn(claudeHome)).toEqual([])
})

it("writes a host-wide path rule into Claude's own rules folder, never into repositories", () => {
  rules.save(input({ projectId: null }))
  files.sync()
  expect(readdirSync(join(claudeHome, 'rules'))).toEqual(['ramu-api-handlers.md'])
  expect(rulesIn(repoA)).toEqual([])
})

it("renames, disables and deletes only Ramu's own files and leaves the person's rules alone", () => {
  mkdirSync(join(repoA, '.claude', 'rules'), { recursive: true })
  const mine = join(repoA, '.claude', 'rules', 'mine.md')
  const lookalike = join(repoA, '.claude', 'rules', 'ramu-notes.md')
  writeFileSync(mine, '---\npaths:\n  - "docs/**"\n---\nMy own rule.\n')
  writeFileSync(lookalike, 'Not written by Ramu.\n')
  let rule = rules.save(input())
  files.sync()
  rule = rules.save(input({ id: rule.id, baseRevision: rule.revision, name: 'API code' }))
  files.sync()
  expect(rulesIn(repoA)).toEqual(['mine.md', 'ramu-api-code.md', 'ramu-notes.md'])
  rule = rules.save(input({ id: rule.id, baseRevision: rule.revision, name: 'API code', providers: ['codex'] }))
  files.sync()
  expect(rulesIn(repoA)).toEqual(['mine.md', 'ramu-notes.md'])
  rule = rules.save(input({ id: rule.id, baseRevision: rule.revision, name: 'API code' }))
  files.sync()
  rule = rules.save(input({ id: rule.id, baseRevision: rule.revision, name: 'API code', enabled: false }))
  files.sync()
  expect(rulesIn(repoA)).toEqual(['mine.md', 'ramu-notes.md'])
  rule = rules.save(input({ id: rule.id, baseRevision: rule.revision, name: 'API code', paths: ['lib/**'] }))
  files.sync()
  expect(readFileSync(join(repoA, '.claude', 'rules', 'ramu-api-code.md'), 'utf8')).toContain('  - lib/**\n')
  rules.remove(rule.id)
  files.sync()
  expect(rulesIn(repoA)).toEqual(['mine.md', 'ramu-notes.md'])
  expect(readFileSync(mine, 'utf8')).toContain('My own rule.')
  expect(readFileSync(lookalike, 'utf8')).toBe('Not written by Ramu.\n')
})

it('reports a name taken by a file Ramu did not write instead of overwriting it', () => {
  mkdirSync(join(repoA, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(repoA, '.claude', 'rules', 'ramu-api-handlers.md'), 'Hand-written.\n')
  rules.save(input())
  const [status] = files.sync()
  expect(status!.targets[0]!.problem).toMatch(/did not write it/)
  expect(readFileSync(join(repoA, '.claude', 'rules', 'ramu-api-handlers.md'), 'utf8')).toBe('Hand-written.\n')
  expect(status!.targets[1]!.problem).toBeUndefined()
})

it('moves files when a rule changes scope and cleans a repository that left the project', () => {
  let rule = rules.save(input())
  files.sync()
  rule = rules.save(input({ id: rule.id, baseRevision: rule.revision, projectId: null }))
  files.sync()
  expect(rulesIn(repoA)).toEqual([])
  expect(readdirSync(join(claudeHome, 'rules'))).toEqual(['ramu-api-handlers.md'])
  rules.save(input({ id: rule.id, baseRevision: rule.revision }))
  files.sync()
  repositories = [{ projectId: 'p1', root: repoA }]
  files.sync([repoB])
  expect(rulesIn(repoA)).toEqual(['ramu-api-handlers.md'])
  expect(rulesIn(repoB)).toEqual([])
})

it('reports a repository it cannot write and a rules folder that links outside it, without throwing', () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return
  const outside = join(dir, 'outside')
  mkdirSync(outside)
  mkdirSync(join(repoA, '.claude'))
  symlinkSync(outside, join(repoA, '.claude', 'rules'))
  chmodSync(repoB, 0o555)
  rules.save(input())
  const [status] = files.sync()
  expect(status!.targets.map((target) => !!target.problem)).toEqual([true, true])
  expect(status!.targets[0]!.problem).toMatch(/outside/)
  expect(readdirSync(outside)).toEqual([])
  expect(files.status()).toEqual([status])
})
