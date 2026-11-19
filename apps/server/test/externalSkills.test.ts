import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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
it('stages without importing, requires the owning confirmation, and exports its files and scripts to every provider', async () => {
  const preview = await stage()
  expect(learning.skills()).toEqual([])
  expect(existsSync(staging)).toBe(false)
  expect(preview.files.find((f) => f.path === 'scripts/run.py')?.script).toBe(true)
  expect(() => service.confirm(preview.id, {}, 'foreign')).toThrow('belongs to another')
  const installed = service.confirm(preview.id)
  expect(installed.installation!.cliVersion).toBe(SKILLS_CLI_VERSION)
  expect(installed.installation!.files['scripts/run.py']).toBeDefined()
  for (const provider of ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const) {
    const dir = learning.exportDir(null, provider, root)!
    const skill = join(dir, 'skills', 'ramu-fixture')
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toContain('allowed-tools: Read')
    expect(readFileSync(join(skill, 'references/check.md'), 'utf8')).toBe('original reference')
    expect(existsSync(join(skill, 'scripts/run.py'))).toBe(true)
  }
  expect(() => service.confirm(preview.id)).toThrow('expired')
})
it('installs to the project and agents chosen in the review, and an update keeps them', async () => {
  const project = ws.createProject('Fixture')
  const preview = await stage()
  expect(() => service.confirm(preview.id, { providers: [] })).toThrow('at least one agent')
  const installed = service.confirm(preview.id, { projectId: project.id, providers: ['codex', 'claude-code'] })
  expect(installed).toMatchObject({ projectId: project.id, providers: ['claude-code', 'codex'] })
  const update = await service.stage({ source, projectId: project.id, updatingId: installed.id })
  const updated = service.confirm(update.id, { projectId: null, providers: ['cursor'] })
  expect(updated).toMatchObject({ projectId: project.id, providers: ['claude-code', 'codex'] })
  const everywhere = service.confirm((await stage()).id, {
    projectId: null,
    providers: ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'],
  })
  expect(everywhere.providers).toBeUndefined()
})
it('gives a safety read the instructions and every text file, scripts included', async () => {
  const preview = await stage()
  const { name, files } = service.auditFiles({ stageId: preview.id })
  expect(name).toBe('fixture')
  expect(files.map((file) => file.path).sort()).toEqual(['SKILL.md', 'references/check.md', 'scripts/run.py'])
  expect(files.find((file) => file.path === 'scripts/run.py')!.text).toContain('must never execute')
  expect(() => service.auditFiles({ stageId: preview.id }, 'foreign')).toThrow('expired')
})
it('updates from source with a diff, removes stale references, and rejects stale approvals', async () => {
  const first = service.confirm((await stage()).id)
  expect(first.installation!.files['scripts/run.py']).toBeDefined()
  rmSync(join(source, 'scripts'), { recursive: true })
  writeFileSync(join(source, 'references/check.md'), 'updated reference')
  const preview = await service.update(first.id)
  expect(preview.changes).toMatchObject({ changed: ['references/check.md'], removed: ['scripts/run.py'] })
  expect(learning.skills()[0]!.revision).toBe(1)
  const second = service.confirm(preview.id)
  const dir = learning.exportDir(null, 'codex', root)!
  expect(readFileSync(join(dir, 'skills/ramu-fixture/references/check.md'), 'utf8')).toBe('updated reference')
  expect(existsSync(join(dir, 'skills/ramu-fixture/scripts/run.py'))).toBe(false)
  const pending = await service.update(second.id)
  learning.control(second.id, 'disable')
  expect(() => service.confirm(pending.id)).toThrow('changed while awaiting')
})
it('disables and removes the skill from both the catalog and provider exports', async () => {
  const skill = service.confirm((await stage()).id)
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
  const skill = service.confirm((await stage()).id)
  service.move(skill.id, project.id)
  expect(learning.catalog(other.id)).toEqual([])
  expect(learning.catalog(project.id)[0]!.name).toBe('fixture')
  // Even an unpinned installed skill is excluded from automatic archive hygiene.
  learning.write({ ...learning.skills()[0]!, pinned: false, updatedAt: 1, lastUsedAt: 1 })
  ;(learning as unknown as { hygiene(): void }).hygiene()
  expect(learning.skills()[0]!.status).toBe('active')
})
it('creates an authored skill that learning never changes, and copies instead of editing an installed one', async () => {
  const mine = service.create({
    name: 'review-checklist',
    description: 'Before merging',
    content: 'Check tests.',
    projectId: null,
  })
  expect(mine).toMatchObject({ pinned: true, changedBy: 'user', revision: 1, status: 'active' })
  expect(mine.installation).toBeUndefined()
  expect(() => service.create({ name: 'review-checklist', description: 'd', content: 'c', projectId: null })).toThrow(
    'already exists',
  )
  expect(() => service.create({ name: 'Bad Name', description: 'd', content: 'c', projectId: null })).toThrow(
    'lowercase',
  )
  expect(() => service.create({ name: 'x', description: 'd', content: 'c', projectId: 'nope' })).toThrow(
    'Unknown project',
  )
  const edited = service.edit(mine.id, { content: 'Check tests and docs.' }, 1)
  expect(edited).toMatchObject({ revision: 2, content: 'Check tests and docs.', description: 'Before merging' })
  expect(() => service.edit(mine.id, { content: 'late' }, 1)).toThrow('changed since')
  const installed = service.confirm((await stage()).id)
  expect(() => service.edit(installed.id, { content: 'x' }, installed.revision)).toThrow('Copy it first')
  const copy = service.fork(installed.id)
  expect(copy).toMatchObject({
    name: 'fixture-copy',
    pinned: true,
    changedBy: 'user',
    content: installed.content.trim(),
  })
  expect(copy.installation).toBeUndefined()
  expect(learning.skills().find((s) => s.id === installed.id)).toMatchObject({ revision: installed.revision })
  // A second copy picks the next free name instead of failing.
  expect(service.fork(installed.id).name).toBe('fixture-copy-2')
  expect(service.fork(installed.id, 'mine').name).toBe('mine')
  service.remove(copy.id)
  expect(learning.skills().some((s) => s.id === copy.id)).toBe(false)
})

it('reads the MCP tools a skill asks for from allowed-tools, ignoring built-in tools', async () => {
  const { skillMcpTools } = await import('../src/memory/skillFiles')
  const doc = (line: string) => `---\nname: x\ndescription: y\n${line}\n---\nBody`
  expect(skillMcpTools(doc('allowed-tools: Read, mcp__github__create_issue mcp__linear__list'))).toEqual([
    'mcp__github__create_issue',
    'mcp__linear__list',
  ])
  expect(skillMcpTools(doc('allowed-tools:\n  - Bash\n  - mcp__a__b\n  - mcp__a__b'))).toEqual(['mcp__a__b'])
  expect(skillMcpTools(doc('description2: none'))).toEqual([])
  expect(skillMcpTools('no frontmatter')).toEqual([])
})

it('copies every file with its scripts, preserves provider scope and exports an editable independent snapshot', async () => {
  {
    const installed = service.confirm((await stage()).id)
    learning.setProviders(installed.id, ['codex'])
    const copy = service.fork(installed.id)
    expect(copy).toMatchObject({ revision: 1, providers: ['codex'], pinned: true })
    expect(copy.installation).toBeUndefined()
    expect(copy.bundle?.files['references/check.md']).toBe(Buffer.from('original reference').toString('base64'))
    expect(!!copy.bundle?.files['scripts/run.py']).toBe(true)
    expect(copy.bundle?.files).not.toBe(installed.installation!.files)
    const edited = service.edit(copy.id, { content: 'My instructions: read references/check.md.' }, 1)
    expect(edited.bundle).toEqual(copy.bundle)
    const dir = learning.exportDir(null, 'codex', root)!
    const folder = join(dir, 'skills', 'ramu-fixture-copy')
    const markdown = readFileSync(join(folder, 'SKILL.md'), 'utf8')
    expect(markdown).toContain('name: ramu-fixture-copy')
    expect(markdown).toContain('allowed-tools: Read')
    expect(markdown).toContain('My instructions: read references/check.md.')
    expect(readFileSync(join(folder, 'references/check.md'), 'utf8')).toBe('original reference')
    expect(existsSync(join(folder, 'scripts/run.py'))).toBe(true)
    expect(existsSync(join(learning.exportDir(null, 'claude-code', root)!, 'skills/ramu-fixture-copy'))).toBe(false)

    writeFileSync(join(source, 'references/check.md'), 'updated source')
    service.confirm((await service.update(installed.id)).id)
    service.remove(installed.id)
    expect(readFileSync(join(folder, 'references/check.md'), 'utf8')).toBe('original reference')
    const again = service.fork(copy.id)
    expect(again.bundle).toEqual(copy.bundle)
    expect(again.providers).toEqual(['codex'])
    service.remove(copy.id)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(existsSync(folder)).toBe(false)

    // Force a fresh provider export from persisted records, rather than reusing files left by the first service.
    rmSync(join(root, 'managed', 'export'), { recursive: true, force: true })
    const restored = new LearningService(
      db,
      ws,
      {} as AgentService,
      {} as MemoryService,
      join(root, 'managed'),
      () => {},
    )
    const restoredFolder = join(restored.exportDir(null, 'codex', root)!, 'skills', `ramu-${again.name}`)
    expect(readFileSync(join(restoredFolder, 'references/check.md'), 'utf8')).toBe('original reference')
    expect(readFileSync(join(restoredFolder, 'SKILL.md'), 'utf8')).toContain('My instructions:')
    service.remove(again.id)
    writeFileSync(join(source, 'references/check.md'), 'original reference')
  }
})

it('keeps a maximum-length installed name and its copy in distinct bounded provider folders', async () => {
  const name = 'a'.repeat(64)
  writeFileSync(join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: Long name\n---\nRead references/check.md.`)
  const installed = service.confirm((await stage()).id)
  const copy = service.fork(installed.id)
  const dir = join(learning.exportDir(null, 'codex', root)!, 'skills')
  const names = readdirSync(dir)
  expect(names).toHaveLength(2)
  expect(new Set(names).size).toBe(2)
  for (const folder of names) {
    expect(folder.length).toBeLessThanOrEqual(64)
    expect(readFileSync(join(dir, folder, 'SKILL.md'), 'utf8')).toContain(`name: ${folder}`)
    expect(readFileSync(join(dir, folder, 'references/check.md'), 'utf8')).toBe('original reference')
  }
  service.remove(installed.id)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(readdirSync(dir)).toHaveLength(1)
  expect(learning.skills()[0]!.id).toBe(copy.id)
})

it('reviews source updates against the copied revision and preserves user edits and provider scope', async () => {
  const original = service.confirm((await stage()).id)
  learning.setProviders(original.id, ['codex'])
  const copy = service.fork(original.id)
  service.edit(copy.id, { content: 'My custom instructions.' }, copy.revision)
  writeFileSync(
    join(source, 'SKILL.md'),
    '---\nname: fixture\ndescription: Updated description\nallowed-tools: Read\n---\nUpdated source instructions.\n',
  )
  writeFileSync(join(source, 'references/check.md'), 'updated reference')
  const updated = service.confirm((await service.update(original.id)).id)
  const preview = service.copyUpdate(copy.id)
  expect(preview.content).toMatchObject({
    conflict: true,
    local: 'My custom instructions.',
    source: 'Updated source instructions.',
    proposed: 'My custom instructions.',
  })
  expect(preview.description).toMatchObject({ conflict: false, proposed: 'Updated description' })
  expect(preview.files).toContainEqual({ path: 'references/check.md', change: 'changed', conflict: false })
  expect(preview.files.some((file) => file.path === 'scripts/run.py')).toBe(false)
  const result = service.applyCopyUpdate(copy.id, preview.revision, preview.sourceRevision, {
    description: preview.description.proposed,
    content: 'My custom instructions. Updated source instructions.',
    files: {},
  })
  expect(result).toMatchObject({
    name: 'fixture-copy',
    providers: ['codex'],
    revision: 3,
    copiedFrom: { id: original.id, revision: updated.revision },
  })
  const folder = join(learning.exportDir(null, 'codex', root)!, 'skills/ramu-fixture-copy')
  expect(readFileSync(join(folder, 'references/check.md'), 'utf8')).toBe('updated reference')
  expect(readFileSync(join(folder, 'SKILL.md'), 'utf8')).toContain(
    'My custom instructions. Updated source instructions.',
  )
  expect(learning.history(copy.id).find((skill) => skill.revision === 1)?.content).toBe(original.content.trim())
  const next = service.copyUpdate(copy.id)
  expect(next.content.conflict).toBe(false)
  expect(next.content.proposed).toBe(result.content)
})

it('refuses applying a reviewed update after either revision changes or the source disappears', async () => {
  const original = service.confirm((await stage()).id)
  const copy = service.fork(original.id)
  const preview = service.copyUpdate(copy.id)
  const choices = { description: copy.description, content: copy.content, files: {} }
  service.edit(copy.id, { content: 'A concurrent edit.' }, copy.revision)
  expect(() => service.applyCopyUpdate(copy.id, preview.revision, preview.sourceRevision, choices)).toThrow(
    'changed during review',
  )
  const fresh = service.copyUpdate(copy.id)
  learning.control(original.id, 'pin')
  expect(() => service.applyCopyUpdate(copy.id, fresh.revision, fresh.sourceRevision, choices)).toThrow(
    'changed during review',
  )
  service.remove(original.id)
  expect(() => service.copyUpdate(copy.id)).toThrow('removed')
  expect(service.edit(copy.id, { content: 'Still independently editable.' }, fresh.revision).content).toBe(
    'Still independently editable.',
  )
})

it.each(['copy', 'source'] as const)(
  'requires an explicit %s choice for files changed in both versions',
  async (choice) => {
    const original = service.confirm((await stage()).id)
    const copy = service.fork(original.id)
    learning.write({
      ...copy,
      revision: 2,
      bundle: {
        ...copy.bundle!,
        files: { ...copy.bundle!.files, 'references/check.md': Buffer.from('local reference').toString('base64') },
      },
    })
    writeFileSync(join(source, 'references/check.md'), 'source reference')
    service.confirm((await service.update(original.id)).id)
    const preview = service.copyUpdate(copy.id)
    expect(preview.files).toContainEqual({ path: 'references/check.md', change: 'changed', conflict: true })
    const changes = { description: copy.description, content: copy.content, files: {} }
    expect(() => service.applyCopyUpdate(copy.id, preview.revision, preview.sourceRevision, changes)).toThrow(
      'each conflicting file',
    )
    const result = service.applyCopyUpdate(copy.id, preview.revision, preview.sourceRevision, {
      ...changes,
      files: { 'references/check.md': choice },
    })
    expect(Buffer.from(result.bundle!.files['references/check.md']!, 'base64').toString()).toBe(
      choice === 'copy' ? 'local reference' : 'source reference',
    )
  },
)

it('does not infer provenance for old authored skills or follow a source across scopes', async () => {
  const authored = service.create({ name: 'old-copy', description: 'Old', content: 'Old copy', projectId: null })
  expect(() => service.copyUpdate(authored.id)).toThrow('no recorded source revision')
  const original = service.confirm((await stage()).id)
  const copy = service.fork(original.id)
  service.move(original.id, ws.createProject('Other scope').id)
  expect(() => service.copyUpdate(copy.id)).toThrow('another scope')
})

it('reviews added and removed approved files and reconciles the exported copy', async () => {
  const original = service.confirm((await stage()).id)
  const copy = service.fork(original.id)
  rmSync(join(source, 'references/check.md'))
  writeFileSync(join(source, 'references/new.md'), 'new approved reference')
  service.confirm((await service.update(original.id)).id)
  const preview = service.copyUpdate(copy.id)
  expect(preview.files).toEqual(
    expect.arrayContaining([
      { path: 'references/check.md', change: 'removed', conflict: false },
      { path: 'references/new.md', change: 'added', conflict: false },
    ]),
  )
  service.applyCopyUpdate(copy.id, preview.revision, preview.sourceRevision, {
    description: preview.description.proposed,
    content: preview.content.proposed,
    files: {},
  })
  const folder = join(learning.exportDir(null, 'codex', root)!, 'skills/ramu-fixture-copy')
  expect(existsSync(join(folder, 'references/check.md'))).toBe(false)
  expect(readFileSync(join(folder, 'references/new.md'), 'utf8')).toBe('new approved reference')
})

it('bounds complete file-version previews and reports binary versions without interpreting them as text', async () => {
  for (let i = 0; i < 14; i++) writeFileSync(join(source, `references/text-${i}.md`), `base${'x'.repeat(6000)}`)
  writeFileSync(join(source, 'references/binary.dat'), Buffer.from([0, 255, 1]))
  const original = service.confirm((await stage()).id)
  const copy = service.fork(original.id)
  for (let i = 0; i < 14; i++) writeFileSync(join(source, `references/text-${i}.md`), `new ${'y'.repeat(6000)}`)
  writeFileSync(join(source, 'references/binary.dat'), Buffer.from([0, 255, 2, 3]))
  service.confirm((await service.update(original.id)).id)
  const preview = service.copyUpdate(copy.id)
  expect(preview.fileVersions['references/binary.dat']).toEqual({
    before: { bytes: 3 },
    local: { bytes: 3 },
    source: { bytes: 4 },
  })
  const versions = Object.values(preview.fileVersions).flatMap((entry) => Object.values(entry))
  const texts = versions.flatMap((entry) => (entry?.text === undefined ? [] : [entry.text]))
  expect(texts.length).toBeGreaterThan(0)
  expect(texts.every((text) => text.length === 6004)).toBe(true)
  expect(texts.reduce((total, text) => total + Buffer.byteLength(text), 0)).toBeLessThanOrEqual(64 * 1024)
  expect(versions.some((entry) => entry?.bytes === 6004 && entry.text === undefined)).toBe(true)
})

it('refuses oversized source instructions without truncating or changing the copy', async () => {
  const original = service.confirm((await stage()).id)
  const copy = service.fork(original.id)
  writeFileSync(join(source, 'SKILL.md'), `---\nname: fixture\ndescription: Updated\n---\n${'x'.repeat(24001)}`)
  service.confirm((await service.update(original.id)).id)
  expect(() => service.copyUpdate(copy.id)).toThrow('instruction limit')
  expect(learning.skills().find((skill) => skill.id === copy.id)).toEqual(copy)
})
