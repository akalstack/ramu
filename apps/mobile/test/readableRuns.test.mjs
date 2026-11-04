import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableRuns, readableText } from '../src/runtime/transcript.ts'

test('a message opened for selecting reads like the message, not its Markdown', () => {
  const runs = readableRuns('## The Final Verdict\n\n- **Cursor** ranks #1. Uses `rg`.\n- Ramu [docs](https://x.test)')
  assert.deepEqual(runs, [
    { text: 'The Final Verdict', style: 'heading' },
    { text: '\n\n', style: 'body' },
    { text: '• ', style: 'marker' },
    { text: 'Cursor', style: 'strong' },
    { text: ' ranks #1. Uses ', style: 'body' },
    { text: 'rg', style: 'code' },
    { text: '.\n', style: 'body' },
    { text: '• ', style: 'marker' },
    { text: 'Ramu docs', style: 'body' },
  ])
})

test('code blocks keep their text and drop the fences; snake_case and a*b stay as typed', () => {
  assert.equal(
    readableText('Run:\n\n```sh\npnpm test\n```\n\nuser_id and a*b, *done*'),
    'Run:\n\npnpm test\n\nuser_id and a*b, done',
  )
  assert.equal(readableText('1. one\n2. two'), '1. one\n2. two')
})

test('a selection reads as the message looks, without Markdown marks', () => {
  assert.equal(
    readableText('## Plan\n\nUse **bold**, `code` and [a link](https://x.dev).'),
    'Plan\n\nUse bold, code and a link.',
  )
  assert.equal(readableText('```ts\nconst a = 1\n```'), 'const a = 1')
  assert.equal(readableText('> quoted\n- item'), 'quoted\n• item')
  assert.equal(readableText('snake_case_name stays *emphasis* gone'), 'snake_case_name stays emphasis gone')
})
