import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createInvokeLog } from '../src/main/invokeLog'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const logFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-invoke-log-'))
  dirs.push(dir)
  return join(dir, 'logs', 'desktop-errors.log')
}

it('writes the method, host, code and top of the stack of a failed call', () => {
  const path = logFile()
  const lost = Object.assign(new Error('Connection lost before the host answered'), { code: 'ECONNRESET' })
  createInvokeLog(path, () => Date.UTC(2026, 10, 26, 10, 0, 0)).record('agent.events', undefined, lost)
  const text = readFileSync(path, 'utf8')
  expect(text).toContain(
    '2026-11-26T10:00:00.000Z agent.events on this host failed [ECONNRESET]: Connection lost before the host answered',
  )
  expect(text).toMatch(/\n {4}at /)
})

it('folds the same failure repeated within seconds into a count on its next line', () => {
  const path = logFile()
  let now = 0
  const log = createInvokeLog(path, () => now)
  for (let i = 0; i < 50; i++) log.record('ui.get', 'mac-mini', new Error('Could not connect to the service'))
  now = 6_000
  log.record('ui.get', 'mac-mini', new Error('Could not connect to the service'))
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.includes('failed'))
  expect(lines).toHaveLength(2)
  expect(lines[1]).toContain('on mac-mini failed: Could not connect to the service (repeated 49 more times)')
})

it('moves a full log aside instead of growing without end', () => {
  const path = logFile()
  let now = 0
  const log = createInvokeLog(path, () => (now += 10_000), 200)
  for (let i = 0; i < 5; i++) log.record(`call.${i}`, undefined, 'nope')
  expect(existsSync(`${path}.1`)).toBe(true)
  expect(readFileSync(path, 'utf8').length).toBeLessThan(400)
})
