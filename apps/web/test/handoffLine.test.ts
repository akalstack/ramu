import { expect, it } from 'vitest'
import { handoffLine } from '../src/views/agent/handoffLine'

const t = (text: string, values: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))

it('says what was carried, from where, and what was shortened', () => {
  expect(
    handoffLine({ cause: 'limit', mode: 'full', from: 'claude-code', fromSeq: 1, toSeq: 412, shortened: 3 }, t),
  ).toBe('Carried events 1–412 from Claude (compacted handoff, 3 old results shortened)')
})

it('names a delta and what was left out', () => {
  expect(handoffLine({ cause: 'switch', mode: 'delta', from: 'codex', fromSeq: 300, toSeq: 412, omitted: 5 }, t)).toBe(
    'Carried events 300–412 from Codex (new events only, 5 events left out)',
  )
})

it('distinguishes checkpoint and omitted history from an intact full handoff', () => {
  expect(handoffLine({ cause: 'switch', mode: 'full', toSeq: 30, checkpointSeq: 20 }, t)).toBe(
    'Carried events 1–30 (compacted handoff, checkpoint through event 20)',
  )
  expect(handoffLine({ cause: 'switch', mode: 'full', toSeq: 30, omitted: 4 }, t)).toBe(
    'Carried events 1–30 (compacted handoff, 4 events left out)',
  )
})

it('omits the source when it is unknown, and shows nothing before the handoff is built', () => {
  expect(handoffLine({ cause: 'rewind', mode: 'full', toSeq: 20 }, t)).toBe('Carried events 1–20 (full handoff)')
  expect(handoffLine({ cause: 'limit', mode: 'full', from: 'codex' }, t)).toBeNull()
  expect(handoffLine(undefined, t)).toBeNull()
})
