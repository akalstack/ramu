import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'

test('a background command note keeps the whole command to open, as a goal note does', () => {
  const script = 'pnpm -s lapor > /tmp/out.json; python3 -c "\nimport json\nprint(1)\n"'
  const rows = transcript([
    { kind: 'background-command-end', command: script, failed: false },
    { kind: 'background-command-end', command: 'make', failed: true },
    { kind: 'background-terminal-stop', command: 'pnpm dev' },
  ])
  const notes = rows.filter((item) => item.kind === 'note' && item.command)
  assert.deepEqual(
    notes.map((note) => note.command),
    [
      { text: script, state: 'finished' },
      { text: 'make', state: 'failed' },
      { text: 'pnpm dev', state: 'stop' },
    ],
  )
  // Search and previews still read one line.
  assert.equal(notes[0].title, 'Background command finished: pnpm -s lapor > /tmp/out.json; python3 -c " …')
})
