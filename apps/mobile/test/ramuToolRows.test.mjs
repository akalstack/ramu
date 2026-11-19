import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'

const use = (toolUseId, name, input) => ({
  kind: 'tool-use',
  toolUseId,
  name,
  summary: '',
  input: JSON.stringify(input),
})
const done = (toolUseId, isError = false) => ({
  kind: 'tool-result',
  toolUseId,
  isError,
  summary: isError ? 'boom' : '{}',
})

test("Ramu's own tools read as what they did, with their facts, not as raw tool names", () => {
  const rows = transcript([
    use('m1', 'mcp__ramu__memory_save', { title: 'Prefers pnpm', kind: 'preference', content: 'Use pnpm' }),
    done('m1'),
  ])
  const row = rows.find((item) => item.kind === 'tool')
  assert.equal(row.ramu.done, 'Saved memory')
  assert.equal(row.ramu.subject, '“Prefers pnpm”')
  assert.deepEqual(
    row.ramu.facts.map((fact) => fact.label),
    ['Kind', 'Content'],
  )
})

test('calls that already have a card in the chat stay out of the tool rows unless they failed', () => {
  const quiet = transcript([use('g1', 'mcp__ramu__set_goal', { objective: 'Ship it' }), done('g1')])
  assert.equal(quiet.filter((item) => item.kind === 'tool').length, 0)
  const failed = transcript([use('g2', 'mcp__ramu__set_goal', { objective: 'Ship it' }), done('g2', true)])
  assert.equal(failed.filter((item) => item.kind === 'tool').length, 1)
})

test("a sub-agent's report back is its own card, not text the person typed", () => {
  const [row] = transcript([{ kind: 'user', text: '[Sub-agent "Sonnet 5.5" finished]\nNothing to review.' }])
  assert.deepEqual(row && { kind: row.kind, name: row.name, verb: row.verb, body: row.body }, {
    kind: 'report',
    name: 'Sonnet 5.5',
    verb: 'finished',
    body: 'Nothing to review.',
  })
})

test('an ability call is one ability row, its tool call hidden even when refused', () => {
  const call = {
    id: 'c',
    ability: 'image_generation',
    tool: 'generate_image',
    status: 'refused',
    refusal: 'unavailable',
    args: { prompt: 'Hero' },
    sent: { prompt: 'Hero', inputs: [] },
    summary: 'No signed-in provider here has image generation.',
  }
  const rows = transcript([
    use('a1', 'mcp__ramu__generate_image', { prompt: 'Hero' }),
    done('a1', true),
    { kind: 'ability', call },
  ])
  assert.deepEqual(
    rows
      .filter((item) => item.kind === 'tool' || item.kind === 'tools' || item.kind === 'ability')
      .map((item) => item.kind),
    ['ability'],
  )
})
