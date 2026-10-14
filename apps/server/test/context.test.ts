import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discoverSkills, withContext } from '../src/context'
import type { Workspace } from '../src/workspace'
let root: string, cwd: string, ws: Workspace
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-context-')); cwd = join(root, 'project'); mkdirSync(cwd); cwd = realpathSync(cwd)
  ws = { getBinding: (_task: string, repo: string) => { if (repo !== 'repo') throw new Error('Repository outside scope'); return { cwd, repoName: 'Project' } }, agentScope: () => ({ cwd, additionalDirs: [], covers: [cwd] }) } as unknown as Workspace
  writeFileSync(join(cwd, 'notes.md'), 'Saved content')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('sends the unsaved buffer and names its origin without changing disk content', async () => {
  const result = await withContext(ws, 'task', 'Use the open tab', [{ repoId: 'repo', path: 'notes.md', source: 'tab', content: 'Unsaved content' }])
  expect(result).toContain('Unsaved content'); expect(result).toContain('tab, editor buffer'); expect(result).not.toContain('Saved content')
})
it('validates scope and paths even when contents were supplied by the renderer', async () => {
  writeFileSync(join(root, 'private.md'), 'Outside scope'); symlinkSync(join(root, 'private.md'), join(cwd, 'escape.md'))
  for (const path of ['../private.md', 'escape.md']) await expect(withContext(ws, 'task', 'Read it', [{ repoId: 'repo', path, source: 'mention', content: 'Supplied' }])).rejects.toThrow()
  await expect(withContext(ws, 'task', 'Read it', [{ repoId: 'other', path: 'notes.md', source: 'mention' }])).rejects.toThrow('outside scope')
})
it('marks bounded context as truncated instead of silently pretending it is complete', async () => {
  const result = await withContext(ws, 'task', 'Summarize', [{ repoId: 'repo', path: 'notes.md', source: 'tab', content: 'a'.repeat(70000) }])
  expect(result).toContain('"truncated":true'); expect(result.length).toBeLessThan(61000)
})
it('lists inactive tabs without reading their content, including binary files', async () => {
  writeFileSync(join(cwd, 'binary.bin'), Buffer.from([0, 1, 2]))
  const result = await withContext(ws, 'task', 'Read relevant files', [
    { repoId: 'repo', path: 'notes.md', source: 'tab', referenceOnly: true, content: 'Must not be sent' },
    { repoId: 'repo', path: 'binary.bin', source: 'tab', referenceOnly: true },
  ])
  expect(result).toContain('Project/notes.md')
  expect(result).toContain('Project/binary.bin')
  expect(result).toContain('"referenceOnly":true')
  expect(result).not.toContain('Saved content')
  expect(result).not.toContain('Must not be sent')
})
it('sends selected diff text with its range and side instead of reading a full diff', async () => {
  const result = await withContext(ws, 'task', 'Explain this selection', [{ repoId: 'repo', path: 'notes.md', source: 'tab', diff: { staged: false }, content: 'Selected unsaved text', selection: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 5, side: 'modified' } }])
  expect(result).toContain('Selected unsaved text')
  expect(result).toContain('"startLine":2')
  expect(result).toContain('"side":"modified"')
  expect(result).not.toContain('Saved content')
})
it('still includes full explicit file content and validates reference-only paths', async () => {
  const result = await withContext(ws, 'task', 'Explain the mentioned file', [{ repoId: 'repo', path: 'notes.md', source: 'mention', referenceOnly: true }])
  expect(result).toContain('Saved content')
  await expect(withContext(ws, 'task', 'Read tabs', [{ repoId: 'repo', path: '../private.md', source: 'tab', referenceOnly: true }])).rejects.toThrow()
})
it('discovers nearest project skills first and shows folded descriptions', async () => {
  const skill = (base: string, description: string) => { const folder = join(base, '.agents', 'skills', 'ramu-test-context-skill'); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'SKILL.md'), `---\nname: ramu-test-context-skill\ndescription: >\n  ${description}\n  Continue the description.\n---\nInstructions\n`) }
  skill(root, 'Parent skill.'); skill(cwd, 'Project skill.')
  const entry = discoverSkills(ws.agentScope('task')).find((s) => s.name === 'ramu-test-context-skill')!
  expect(entry.path).toContain(join(cwd, '.agents')); expect(entry.description).toBe('Project skill. Continue the description.')
  const prompt = await withContext(ws, 'task', '$ramu-test-context-skill', [], [{ name: entry.name, description: 'Managed copy', path: '/managed/copy/SKILL.md' }])
  expect(prompt).toContain(entry.path)
  expect(prompt).not.toContain('/managed/copy/SKILL.md')
})
