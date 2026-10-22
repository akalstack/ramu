import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OCU_VERSION, ocuUpdateStatus } from '../src/computer/ocu'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-ocu-update-'))
  vi.stubEnv('RAMU_TOOLS_DIR', root)
  vi.stubEnv('RAMU_OCU_PATH', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})
function installed(version: string, versioned = false) {
  const dir = join(root, ...(versioned ? [`ocu-${OCU_VERSION}`] : []), 'node_modules/open-computer-use')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }))
}
it('does not advertise an update before a managed installation exists', () => {
  expect(ocuUpdateStatus()).toMatchObject({
    installedVersion: null,
    supportedVersion: OCU_VERSION,
    updateAvailable: false,
  })
})
it('offers the tested release for an old installation and clears the notice after a versioned install', () => {
  installed('1.0.0')
  expect(ocuUpdateStatus()).toMatchObject({ installedVersion: '1.0.0', updateAvailable: true })
  installed(OCU_VERSION, true)
  expect(ocuUpdateStatus()).toMatchObject({ installedVersion: OCU_VERSION, updateAvailable: false })
})
it('leaves custom executable updates to the owning host', () => {
  installed('1.0.0')
  vi.stubEnv('RAMU_OCU_PATH', '/custom/ocu')
  expect(ocuUpdateStatus()).toMatchObject({ managed: false, updateAvailable: false })
})
