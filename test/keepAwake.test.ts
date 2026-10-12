import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { KeepAwakeService } from '../src/main/keepAwake'
import { DEFAULT_APP_PREFERENCES } from '../src/shared/types'

it('defaults to off before first background-service installation', () => {
  expect(DEFAULT_APP_PREFERENCES.keepAwake).toBe(false)
  expect(DEFAULT_APP_PREFERENCES.keepAwakeWhen).toBe('plugged-in')
  const service = new KeepAwakeService(() => false)
  try { expect(service.status().active).toBe(false) } finally { service.close() }
})
it.skipIf(process.platform !== 'darwin')('holds and releases a real macOS idle-sleep assertion without requiring login installation', async () => {
  let enabled = true
  const service = new KeepAwakeService(() => enabled, () => 'always')
  try {
    const start = Date.now()
    let asserted = false
    while (Date.now() - start < 3000) {
      const assertions = execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' })
      asserted = assertions.split('\n').some((line) => line.includes(`pid ${service.status().pid}(caffeinate)`) && line.includes('PreventUserIdleSystemSleep'))
      if (asserted) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(asserted).toBe(true)
    enabled = false; service.settingsChanged()
    expect(service.status().active).toBe(false)
  } finally { service.close() }
})
