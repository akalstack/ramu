import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OCU_VERSION, ocuUpdateStatus, setupOcu, ocuPermissions } from '../src/computer/ocu'

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

it.skipIf(process.platform !== 'darwin')(
  'launches doctor and reports missing installs or launch failures',
  async () => {
    const start = vi.fn(async () => {})
    await setupOcu('/managed/ocu', start)
    expect(start).toHaveBeenCalledWith('/managed/ocu', ['doctor'])
    await expect(setupOcu(null, start)).rejects.toThrow('Install Open Computer Use first.')
    start.mockRejectedValueOnce(new Error('Could not launch setup'))
    await expect(setupOcu('/managed/ocu', start)).rejects.toThrow('Could not launch setup')
  },
)

it.skipIf(process.platform !== 'darwin')(
  'reads permissions without onboarding and never infers readiness from installation',
  async () => {
    const read = vi.fn(async () =>
      JSON.stringify({ allGranted: true, accessibilityTrusted: true, screenCaptureGranted: true }),
    )
    await expect(ocuPermissions('/managed/ocu', read)).resolves.toMatchObject({ allGranted: true })
    expect(read).toHaveBeenCalledWith('/managed/ocu', ['doctor', '--json'])
    read.mockResolvedValueOnce(
      JSON.stringify({ allGranted: false, accessibilityTrusted: true, screenCaptureGranted: false }),
    )
    await expect(ocuPermissions('/managed/ocu', read)).resolves.toMatchObject({
      allGranted: false,
      screenCaptureGranted: false,
    })
    read.mockResolvedValueOnce('{}')
    await expect(ocuPermissions('/managed/ocu', read)).resolves.toBeNull()
    read.mockRejectedValueOnce(new Error('Unavailable'))
    await expect(ocuPermissions('/managed/ocu', read)).resolves.toBeNull()
  },
)
