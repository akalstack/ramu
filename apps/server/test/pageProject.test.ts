import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makePageProject } from '../src/interactive/pageProject'
import { HostFolders } from '../src/remote/hostFolders'
import type { HandlerContext } from '../src/ipc/types'

let base: string
let outside: string
const roots = process.env.RAMU_BROWSE_ROOTS
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-export-')))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-outside-')))
  process.env.RAMU_BROWSE_ROOTS = base
})
afterEach(() => {
  if (roots === undefined) delete process.env.RAMU_BROWSE_ROOTS
  else process.env.RAMU_BROWSE_ROOTS = roots
  rmSync(base, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const remembered: string[] = []
function context(kind: 'design' | 'app', projectRoot?: string) {
  const startInProject = vi.fn(async () => ({ taskId: 't1', sessionId: 's1' }))
  const addProjectFromFolder = vi.fn(async () => ({ project: { id: 'p-new' } }))
  const markGrewInto = vi.fn()
  const ctx = {
    pages: {
      get: () => ({ id: 'a', title: 'Pricing', version: 2, kind, grants: {}, capabilities: {} }),
      document: () => ({
        reference: { id: 'a', version: 2, kind, title: 'Pricing', network: { resources: [], connect: [] } },
        html: kind === 'design' ? '<div class="ramu-canvas">frames</div>' : '<h1>Pricing</h1>',
        preview: null,
        files: kind === 'design' ? [{ path: 'design.json', content: '{"frames":[]}' }] : undefined,
      }),
      markGrewInto,
    },
    pageAi: { settingsFor: () => ({ provider: 'codex' }) },
    agents: { validateSettings: async () => {} },
    agentThreads: { startInProject },
    hostFolders: new HostFolders(() => []),
    workspace: {
      addProjectFromFolder,
      newProjectParent: () => base,
      rememberProjectParent: (folder: string) => remembered.push(folder),
      listProjects: () => (projectRoot ? [{ id: 'p1', name: 'shop', root: projectRoot, createdAt: 0 }] : []),
      listRepositories: () => [],
    },
  } as unknown as HandlerContext
  return { ctx, startInProject, addProjectFromFolder, markGrewInto }
}

const briefOf = (start: ReturnType<typeof vi.fn>) =>
  (start.mock.calls[0] as unknown as [{ title: string; prompt: string }])[0]

it('starts a project from a design with its frames as the reference, and asks for screens that match', async () => {
  const { ctx, startInProject } = context('design')
  const made = await makePageProject(ctx, 'a')
  expect(made.folder).toBe(join(base, 'pricing'))
  expect(readFileSync(join(made.folder, 'design', 'design.json'), 'utf8')).toBe('{"frames":[]}')
  expect(readFileSync(join(made.folder, 'design', 'frames.html'), 'utf8')).toContain('frames')
  expect(existsSync(join(made.folder, 'index.html'))).toBe(false)
  expect(briefOf(startInProject).title).toBe('Build Pricing')
  expect(briefOf(startInProject).prompt).toContain('keep design/ as the design reference')
})

it('puts a new project in the chosen parent under the chosen name, numbering it when the folder holds files', async () => {
  const { ctx, addProjectFromFolder } = context('app')
  const parent = join(base, 'work')
  mkdirSync(join(parent, 'pricing-site'), { recursive: true })
  writeFileSync(join(parent, 'pricing-site', 'keep.txt'), 'mine')
  const made = await makePageProject(ctx, 'a', { kind: 'new', parent, name: 'pricing-site' })
  expect(made.folder).toBe(join(parent, 'pricing-site-2'))
  expect(readFileSync(join(parent, 'pricing-site', 'keep.txt'), 'utf8')).toBe('mine')
  expect(readFileSync(join(made.folder, 'index.html'), 'utf8')).toBe('<h1>Pricing</h1>')
  expect(addProjectFromFolder).toHaveBeenCalledWith(made.folder)
  // The chosen place is where the next project goes too.
  expect(remembered).toEqual([realpathSync(parent)])
})

it('refuses a new project parent outside the host browse roots', async () => {
  const { ctx } = context('app')
  await expect(makePageProject(ctx, 'a', { kind: 'new', parent: outside })).rejects.toThrow(/outside the host/)
  expect(existsSync(join(outside, 'pricing'))).toBe(false)
})

it('exports into a folder of an existing project without adding a project, and starts a thread there', async () => {
  const root = join(base, 'shop')
  mkdirSync(root)
  const { ctx, addProjectFromFolder, startInProject, markGrewInto } = context('app', root)
  const made = await makePageProject(ctx, 'a', { kind: 'project', projectId: 'p1', folder: 'src/pricing' })
  expect(made.folder).toBe(join(root, 'src', 'pricing'))
  expect(made.projectId).toBe('p1')
  expect(readFileSync(join(made.folder, 'index.html'), 'utf8')).toBe('<h1>Pricing</h1>')
  expect(addProjectFromFolder).not.toHaveBeenCalled()
  expect(briefOf(startInProject).prompt).toContain('src/pricing/ holds the sources')
  expect(markGrewInto).toHaveBeenCalledWith('a', { projectId: 'p1', taskId: 't1' })
})

it('exports into a project without a thread when asked, and never writes through a link out of the project', async () => {
  const root = join(base, 'shop')
  mkdirSync(root)
  symlinkSync(outside, join(root, 'escape'))
  const { ctx, startInProject } = context('app', root)
  const made = await makePageProject(ctx, 'a', { kind: 'project', projectId: 'p1', startThread: false })
  expect(made.thread).toBeNull()
  expect(made.folder).toBe(join(root, 'pricing'))
  expect(startInProject).not.toHaveBeenCalled()
  await expect(makePageProject(ctx, 'a', { kind: 'project', projectId: 'p1', folder: 'escape/x' })).rejects.toThrow(
    /inside the project/,
  )
  expect(existsSync(join(outside, 'x', 'index.html'))).toBe(false)
})

it('accepts only a project-relative folder of plain names and a bounded parent', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const methods = registerArtifactHandlers({ pages: {}, pageAi: {}, activity: { run: () => {} }, host: {} } as never)
  const parse = (destination: unknown) => methods['artifacts.makeProject']!.args.safeParse(['a', destination]).success
  expect(parse({ kind: 'project', projectId: 'p1', folder: 'src/pricing' })).toBe(true)
  expect(parse({ kind: 'project', projectId: 'p1', folder: '../outside' })).toBe(false)
  expect(parse({ kind: 'project', projectId: 'p1', folder: '/etc' })).toBe(false)
  expect(parse({ kind: 'project', projectId: 'p1', folder: 'src/.hidden' })).toBe(false)
  expect(parse({ kind: 'new', parent: '/work', name: 'shop' })).toBe(true)
  expect(parse({ kind: 'new', name: 'a/b' })).toBe(false)
  expect(parse({ kind: 'new', parent: 'x'.repeat(4097) })).toBe(false)
  expect(parse({ kind: 'elsewhere' })).toBe(false)
})
