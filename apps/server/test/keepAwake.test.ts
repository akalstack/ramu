import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeepAwakeService, onMainsPower } from '../src/background/keepAwake'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'

it('defaults to off before first background-service installation', () => {
  expect(DEFAULT_APP_PREFERENCES.keepAwake).toBe(false)
  expect(DEFAULT_APP_PREFERENCES.keepAwakeWhen).toBe('plugged-in')
  const service = new KeepAwakeService(() => false)
  try {
    expect(service.status().active).toBe(false)
  } finally {
    service.close()
  }
})
it.skipIf(process.platform !== 'darwin')(
  'holds and releases a real macOS idle-sleep assertion without requiring login installation',
  async () => {
    let enabled = true
    const service = new KeepAwakeService(
      () => enabled,
      () => 'always',
    )
    try {
      const start = Date.now()
      let asserted = false
      while (Date.now() - start < 3000) {
        const assertions = execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' })
        asserted = assertions
          .split('\n')
          .some(
            (line) =>
              line.includes(`pid ${service.status().pid}(caffeinate)`) && line.includes('PreventUserIdleSystemSleep'),
          )
        if (asserted) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(asserted).toBe(true)
      enabled = false
      service.settingsChanged()
      expect(service.status().active).toBe(false)
    } finally {
      service.close()
    }
  },
)

it('treats a Linux machine as plugged in unless it has a battery and no mains supply online', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-power-'))
  const supply = (name: string, files: Record<string, string>) => {
    mkdirSync(join(root, name))
    for (const [file, value] of Object.entries(files)) writeFileSync(join(root, name, file), `${value}\n`)
  }
  try {
    expect(onMainsPower(join(root, 'missing'))).toBe(true)
    expect(onMainsPower(root)).toBe(true)
    supply('BAT0', { type: 'Battery' })
    supply('AC', { type: 'Mains', online: '0' })
    expect(onMainsPower(root)).toBe(false)
    writeFileSync(join(root, 'AC', 'online'), '1\n')
    expect(onMainsPower(root)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('lets go of the Linux sleep lock on battery under Plugged in only and takes it again on mains', async () => {
  let mains = true
  const service = new KeepAwakeService(
    () => true,
    () => 'plugged-in',
    'linux',
    () => mains,
  )
  try {
    if (!service.supported) return
    expect(service.status().active).toBe(true)
    mains = false
    service.settingsChanged()
    expect(service.status().active).toBe(false)
    mains = true
    service.settingsChanged()
    expect(service.status().active).toBe(true)
  } finally {
    service.close()
  }
})
