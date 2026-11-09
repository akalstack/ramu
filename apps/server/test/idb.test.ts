import { afterEach, beforeEach, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IDB_VERSION, idbInstallCommand, installIdb } from '../src/testDevice/idb'

let tools: string
beforeEach(() => {
  tools = mkdtempSync(join(tmpdir(), 'ramu idb '))
  process.env.RAMU_TOOLS_DIR = tools
})
afterEach(() => {
  delete process.env.RAMU_TOOLS_DIR
  rmSync(tools, { recursive: true, force: true })
})

/** Records each command and, like the real venv and pip, leaves an executable idb behind. */
const recorder = () => {
  const calls: string[][] = []
  const exec = async (file: string, args: string[]) => {
    calls.push([file, ...args])
    if (file.endsWith('/bin/pip')) {
      const bin = join(tools, `idb-${IDB_VERSION}`, 'bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, 'idb'), '#!/bin/sh\n')
      chmodSync(join(bin, 'idb'), 0o755)
    }
    return ''
  }
  return { calls, exec }
}

it('installs the companion with Homebrew and the pinned client in its own environment', async () => {
  const { calls, exec } = recorder()
  let companion: string | null = null
  await installIdb({
    exec: async (file, args) => {
      if (file === '/brew') companion = '/opt/homebrew/bin/idb_companion'
      return exec(file, args)
    },
    brew: '/brew',
    python: '/usr/bin/python3',
    companion: () => companion,
    platform: 'darwin',
  })
  const dir = join(tools, `idb-${IDB_VERSION}`)
  expect(calls).toEqual([
    ['/brew', 'install', 'facebook/fb/idb-companion'],
    ['/usr/bin/python3', '-m', 'venv', dir],
    [join(dir, 'bin/pip'), 'install', '--disable-pip-version-check', `fb-idb==${IDB_VERSION}`],
  ])
})

it('skips what is already installed and asks for Homebrew only when the companion is missing', async () => {
  const { calls, exec } = recorder()
  const options = { exec, brew: null, python: '/usr/bin/python3', platform: 'darwin' as const }
  await installIdb({ ...options, companion: () => '/usr/local/bin/idb_companion' })
  await installIdb({ ...options, companion: () => '/usr/local/bin/idb_companion' })
  expect(calls.filter(([file]) => file?.endsWith('/bin/pip'))).toHaveLength(1)
  await expect(installIdb({ ...options, companion: () => null })).rejects.toThrow('Install Homebrew')
})

it('refuses to install off a Mac', async () => {
  await expect(installIdb({ platform: 'linux' })).rejects.toThrow('only on a Mac')
})

it('offers the same install as a command for the terminal', () => {
  const dir = `"${tools}/idb-${IDB_VERSION}"`
  expect(idbInstallCommand()).toBe(
    `brew install facebook/fb/idb-companion && /usr/bin/python3 -m venv ${dir} && ${dir}/bin/pip install fb-idb==${IDB_VERSION}`,
  )
})
