import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { HandlerContext } from '../src/ipc/types'
import { registerWorkspaceHandlers } from '../src/ipc/handlers/workspace'
import { openDb } from '../src/db'
import { HostFolders } from '../src/remote/hostFolders'
import { Workspace } from '../src/workspace/workspace'

let home: string
let ws: Workspace
let methods: ReturnType<typeof registerWorkspaceHandlers>
const previousHome = process.env.HOME

beforeEach(() => {
  // New projects go beside the person's repositories in their home folder, so the test gives them one of its own.
  home = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-projects-create-')))
  process.env.HOME = home
  ws = new Workspace(openDb(':memory:'), join(home, '.worktrees'))
  methods = registerWorkspaceHandlers({
    workspace: ws,
    hostFolders: new HostFolders(() => []),
  } as unknown as HandlerContext)
})
afterEach(() => {
  process.env.HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

const create = (input: unknown) => {
  const args = methods['projects.create']!.args.parse([input]) as [{ name: string }]
  return methods['projects.create']!.run(...args) as Promise<{ project: { id: string; root: string }; path: string }>
}

it('creates, commits and adds a project beside the person’s other repositories', async () => {
  mkdirSync(join(home, 'code', 'existing'), { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: join(home, 'code', 'existing') })
  await ws.addProjectFromFolder(join(home, 'code', 'existing'))

  const made = await create({ name: 'notes' })
  expect(made.path).toBe(join(home, 'code', 'notes'))
  expect(made.project.root).toBe(made.path)
  expect(ws.listProjects().map((project) => project.name)).toContain('notes')
  expect(execFileSync('git', ['log', '--format=%s'], { cwd: made.path }).toString()).toContain('Start notes')
  // The same name again is refused rather than written into the existing folder.
  await expect(create({ name: 'notes' })).rejects.toThrow()
})

it('starts a projects folder, never the home folder itself, when there are no projects yet', async () => {
  expect((await create({ name: 'first' })).path).toBe(join(home, 'Projects', 'first'))
})

it('accepts only a folder name and a known stack', () => {
  const parse = (input: unknown) => methods['projects.create']!.args.safeParse([input]).success
  expect(parse({ name: 'shop', stack: 'nextjs' })).toBe(true)
  expect(parse({ name: '../outside' })).toBe(false)
  expect(parse({ name: 'a/b' })).toBe(false)
  expect(parse({ name: 'x'.repeat(101) })).toBe(false)
  expect(parse({ name: 'shop', stack: 'cobol' })).toBe(false)
  expect(parse({ name: 'shop', parent: 'x'.repeat(4097) })).toBe(false)
  expect(parse({ name: 'shop', extra: true })).toBe(false)
})

it('creates the project in any chosen parent the host can write, unless browse roots hold it', async () => {
  mkdirSync(join(home, 'clients'))
  const made = await create({ name: 'shop', parent: join(home, 'clients') })
  expect(made.path).toBe(join(home, 'clients', 'shop'))
  // The chosen folder is where the next project goes, for every device and agent.
  expect(await methods['projects.defaultParent']!.run()).toBe(join(home, 'clients'))
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-elsewhere-')))
  try {
    expect((await create({ name: 'drive-app', parent: elsewhere })).path).toBe(join(elsewhere, 'drive-app'))
    process.env.RAMU_BROWSE_ROOTS = home
    await expect(create({ name: 'shop2', parent: elsewhere })).rejects.toThrow(/outside the host browse roots/)
  } finally {
    delete process.env.RAMU_BROWSE_ROOTS
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

it('tells the client where a new project goes when none is chosen', async () => {
  expect(await methods['projects.defaultParent']!.run()).toBe(join(home, 'Projects'))
})
