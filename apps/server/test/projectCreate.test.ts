import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it } from 'vitest'
import { git } from '../src/workspace/git'
import { createProjectFolder, projectFactsText, type RunCommand } from '../src/workspace/projectCreate'
import { projectConfigSchema } from '../src/workspace/projectConfig'
import { customStackPlan } from '@ramu/shared/stacks'

let parent: string
const create = async (at: string, name: string) => {
  const path = join(at, name)
  await mkdir(path)
  return path
}
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'ramu-create-'))
})

it('runs the stack generator in the new folder, records the stack in ramu.json and commits', async () => {
  const ran: string[][] = []
  const run: RunCommand = async (argv, cwd) => {
    ran.push(argv)
    writeFileSync(join(cwd, 'package.json'), '{"name":"shop"}')
  }
  const folder = await createProjectFolder({ parent, name: 'shop', stack: 'vite-react' }, { create, run })
  expect(ran[0]![0]).toBe('npm')
  expect(folder.ran).toHaveLength(2)
  const config = projectConfigSchema.parse(JSON.parse(readFileSync(join(folder.path, 'ramu.json'), 'utf8')))
  expect(config.stack).toEqual({
    id: 'vite-react',
    dev: 'npm run dev',
    build: 'npm run build',
    test: 'npm run lint',
  })
  expect(readFileSync(join(folder.path, '.gitignore'), 'utf8')).toContain('node_modules/')
  expect(await git(folder.path, ['status', '--porcelain'])).toBe('')
  expect(await git(folder.path, ['log', '--format=%s'])).toContain('Start shop with Vite + React')
  expect(projectFactsText(config)).toContain('Build: npm run build')
  expect(projectFactsText(config)).toContain("Deploys: with the hosting platform's own plugin")
  expect(projectFactsText(config)).toContain('a production deploy, however you make it, asks the person')
})

it('removes the folder when the generator fails, so the name can be tried again', async () => {
  const run: RunCommand = async () => {
    throw new Error('npm failed')
  }
  await expect(createProjectFolder({ parent, name: 'site', stack: 'astro' }, { create, run })).rejects.toThrow(
    'npm failed',
  )
  expect(existsSync(join(parent, 'site'))).toBe(false)
})

it('starts a project with no stack as an empty commit, and refuses a name that is not a folder name', async () => {
  const folder = await createProjectFolder({ parent, name: 'notes' }, { create, run: async () => {} })
  expect(folder.stack).toBeNull()
  expect(await git(folder.path, ['log', '--format=%s'])).toContain('Start notes')
  await expect(createProjectFolder({ parent, name: '../x' }, { create, run: async () => {} })).rejects.toThrow(
    /folder name/,
  )
})

it('records a looked-up stack by name, since it has no id of Ramu’s', async () => {
  const folder = await createProjectFolder(
    {
      parent,
      name: 'desk',
      stack: customStackPlan({
        name: 'Tauri',
        summary: 'A Tauri desktop app',
        generator: [['npm', 'create', 'tauri-app@latest', '.']],
        dev: ['npm', 'run', 'tauri', 'dev'],
        sources: ['https://v2.tauri.app/start/create-project/'],
      }),
    },
    { create, run: async () => {} },
  )
  const config = projectConfigSchema.parse(JSON.parse(readFileSync(join(folder.path, 'ramu.json'), 'utf8')))
  expect(config.stack).toEqual({ name: 'Tauri', dev: 'npm run tauri dev' })
  expect(folder).toMatchObject({ stack: null, stackName: 'Tauri' })
  expect(projectFactsText(config)).toContain('Stack: Tauri')
  expect(readFileSync(join(folder.path, '.gitignore'), 'utf8')).toContain('.env')
})

it('runs a generator with the project’s package name filled in', async () => {
  const ran: string[][] = []
  const folder = await createProjectFolder(
    { parent, name: 'barber-shop', stack: 'flutter' },
    {
      create,
      run: async (argv) => {
        ran.push(argv)
      },
    },
  )
  expect(ran).toEqual([['flutter', 'create', '--project-name', 'barber_shop', '.']])
  expect(folder.ran).toEqual(['flutter create --project-name barber_shop .'])
})
