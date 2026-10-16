import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { LearningService } from '../src/memory/learning'
import type { AgentService } from '../src/agent'
import type { MemoryService } from '../src/memory/memory'
import { ExternalSkills, SKILLS_CLI_VERSION } from '../src/memory/externalSkills'
import { readSkillFolder, safeSkillPath } from '../src/memory/skillFiles'
let db: Db, root: string, source: string, ws: Workspace, learning: LearningService, service: ExternalSkills
let staging = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-installed-test-'))
  source = join(root, 'source')
  mkdirSync(join(source, 'references'), { recursive: true })
  mkdirSync(join(source, 'scripts'))
  writeFileSync(
    join(source, 'SKILL.md'),
    '---\nname: fixture\ndescription: A reusable test skill\nallowed-tools: Read\n---\nRead references/check.md.\n',
  )
  writeFileSync(join(source, 'references/check.md'), 'original reference')
  writeFileSync(join(source, 'scripts/run.py'), 'raise Exception("must never execute")')
  db = openDb(':memory:')
  ws = new Workspace(db, join(root, 'worktrees'))
  learning = new LearningService(db, ws, {} as AgentService, {} as MemoryService, join(root, 'managed'), () => {})
  service = new ExternalSkills(learning, ws)
  vi.spyOn(service as unknown as { run(args: string[], cwd: string): Promise<string> }, 'run').mockImplementation(
    async (args, cwd) => {
      staging = cwd
      expect(cwd.startsWith(tmpdir())).toBe(true)
      expect(args.slice(-4)).toEqual(['-a', 'codex', '--copy', '-y'])
      const dir = join(cwd, '.agents', 'skills', 'fixture')
      mkdirSync(dir, { recursive: true })
      cpSync(source, dir, { recursive: true })
      return ''
    },
  )
})
afterEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve))
  db.close()
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const stage = () => service.stage({ source, projectId: null })
it('stages without importing, requires the owning confirmation, skips scripts and exports references to every provider', async () => {
  const preview = await stage()
  expect(learning.skills()).toEqual([])
  expect(existsSync(staging)).toBe(false)
  expect(preview.files.find((f) => f.path === 'scripts/run.py')?.script).toBe(true)
  expect(() => service.confirm(preview.id, false, 'foreign')).toThrow('belongs to another')
  const installed = service.confirm(preview.id, false)
  expect(installed.installation!.cliVersion).toBe(SKILLS_CLI_VERSION)
  expect(installed.installation!.files['scripts/run.py']).toBeUndefined()
  for (const provider of ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const) {
    const dir = learning.exportDir(null, provider, root)!
    const skill = join(dir, 'skills', 'ramu-fixture')
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toContain('allowed-tools: Read')
    expect(readFileSync(join(skill, 'references/check.md'), 'utf8')).toBe('original reference')
    expect(existsSync(join(skill, 'scripts/run.py'))).toBe(false)
  }
  expect(() => service.confirm(preview.id, true)).toThrow('expired')
})
it('updates from source with a diff, removes stale references, and rejects stale approvals', async () => {
  const first = service.confirm((await stage()).id, true)
  expect(first.installation!.files['scripts/run.py']).toBeDefined()
  rmSync(join(source, 'scripts'), { recursive: true })
  writeFileSync(join(source, 'references/check.md'), 'updated reference')
  const preview = await service.update(first.id)
  expect(preview.changes).toMatchObject({ changed: ['references/check.md'], removed: ['scripts/run.py'] })
  expect(learning.skills()[0]!.revision).toBe(1)
  const second = service.confirm(preview.id, false)
  const dir = learning.exportDir(null, 'codex', root)!
  expect(readFileSync(join(dir, 'skills/ramu-fixture/references/check.md'), 'utf8')).toBe('updated reference')
  expect(existsSync(join(dir, 'skills/ramu-fixture/scripts/run.py'))).toBe(false)
  const pending = await service.update(second.id)
  learning.control(second.id, 'disable')
  expect(() => service.confirm(pending.id, false)).toThrow('changed while awaiting')
})
it('disables and removes the skill from both the catalog and provider exports', async () => {
  const skill = service.confirm((await stage()).id, false)
  const dir = learning.exportDir(null, 'codex', root)!
  learning.control(skill.id, 'disable')
  expect(learning.catalog(null)).toEqual([])
  expect(existsSync(join(learning.exportDir(null, 'codex', root)!, 'skills/ramu-fixture'))).toBe(false)
  learning.control(skill.id, 'restore')
  service.remove(skill.id)
  expect(learning.skills()).toEqual([])
  expect(existsSync(join(learning.exportDir(null, 'codex', root)!, 'skills/ramu-fixture'))).toBe(false)
  expect(existsSync(join(dir, 'skills/ramu-fixture'))).toBe(false)
})
it('rejects symlinks, traversal, invalid names and oversized files before an import', async () => {
  for (const path of ['../x', '/x', 'x/../../y', 'C:/x', 'x\\y', '.env', 'x//y'])
    expect(safeSkillPath(path)).toBe(false)
  symlinkSync(join(source, 'references/check.md'), join(source, 'outside.md'))
  await expect(stage()).rejects.toThrow('symlinks')
  rmSync(join(source, 'outside.md'))
  writeFileSync(join(source, 'SKILL.md'), '---\nname: ../../unsafe\ndescription: test\n---\nbody')
  await expect(stage()).rejects.toThrow('kebab-case')
  expect(learning.skills()).toEqual([])
  writeFileSync(join(source, 'too-big.md'), Buffer.alloc(10 * 1024 * 1024 + 1))
  expect(() => readSkillFolder(source)).toThrow('limits')
})
it('moves scopes without exposing a project skill to another project and never auto-archives installs', async () => {
  const project = ws.createProject('Fixture'),
    other = ws.createProject('Other')
  const skill = service.confirm((await stage()).id, false)
  service.move(skill.id, project.id)
  expect(learning.catalog(other.id)).toEqual([])
  expect(learning.catalog(project.id)[0]!.name).toBe('fixture')
  // Even an unpinned installed skill is excluded from automatic archive hygiene.
  learning.write({ ...learning.skills()[0]!, pinned: false, updatedAt: 1, lastUsedAt: 1 })
  ;(learning as unknown as { hygiene(): void }).hygiene()
  expect(learning.skills()[0]!.status).toBe('active')
})
