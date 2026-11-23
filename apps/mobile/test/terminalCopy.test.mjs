import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { terminalBlockSummary, terminalCopyMessage } from '../src/runtime/terminalCopy.ts'
import { terminalRowsText } from '../../../packages/shared/src/workspace/terminalBlocks.ts'
import { terminalHtml } from '../src/assets/terminal.ts'

test('only a well-formed capture reaches the copy sheet, with at most five commands', () => {
  const capture = terminalCopyMessage({
    kind: 'capture',
    id: 3,
    selection: 'abc',
    blocks: ['$ ls\na', 7, '', '1', '2', '3', '4', '5'],
    screen: '$ ',
    recent: 12,
  })
  assert.deepEqual(capture, { id: 3, selection: 'abc', blocks: ['$ ls\na', '1', '2'], screen: '$ ', recent: '' })
  assert.equal(terminalCopyMessage({ kind: 'capture', id: 'x' }), null)
  assert.equal(terminalCopyMessage({ kind: 'input', data: 'x' }), null)
  assert.equal(terminalCopyMessage(null), null)
})

test('a command block reads as its command and the last line it printed', () => {
  assert.deepEqual(terminalBlockSummary('$ make\nbuilding\nbuilt\n'), { command: '$ make', output: 'built' })
  assert.deepEqual(terminalBlockSummary('$ cd src'), { command: '$ cd src', output: null })
})

/** A stub of the parts of xterm the copy driver reads: two rows on screen, scrolled one row down. */
function surface(rows) {
  const listeners = []
  const posted = []
  const pasted = []
  const buffer = {
    viewportY: 1,
    length: rows.length,
    getLine: (row) =>
      row < rows.length
        ? { isWrapped: false, translateToString: (trim) => (trim ? rows[row].trimEnd() : rows[row]) }
        : undefined,
  }
  const term = {
    rows: 2,
    buffer: { active: buffer },
    getSelection: () => '',
    paste: (text) => pasted.push(text),
  }
  const blocks = { blocks: () => [{ start: 0, end: 1 }], text: () => '$ ls\na.txt' }
  const target = { addEventListener: (_type, listener) => listeners.push(listener) }
  const context = { window: target, document: target, JSON }
  vm.runInNewContext(readFileSync(new URL('../scripts/terminal-copy.js', import.meta.url), 'utf8'), context)
  context.installTerminalCopy(term, (value) => posted.push(JSON.parse(JSON.stringify(value))), terminalRowsText, blocks)
  const send = (value) => listeners[0]({ data: JSON.stringify(value) })
  return { posted, pasted, send }
}

test('the terminal page answers a capture from its own buffer and pastes through xterm', () => {
  const { posted, pasted, send } = surface(['$ ls', 'a.txt', '$ ', ''])
  send({ kind: 'capture', id: 1 })
  send({ kind: 'paste', data: 'echo a\necho b' })
  send({ kind: 'capture', id: 'nope' })
  assert.deepEqual(posted, [
    { kind: 'capture', id: 1, selection: '', blocks: ['$ ls\na.txt'], screen: 'a.txt\n$', recent: '$ ls\na.txt\n$' },
  ])
  assert.deepEqual(pasted, ['echo a\necho b'])
})

test('the generated terminal bundle tracks command blocks and carries the copy driver', () => {
  const script = terminalHtml.slice(terminalHtml.indexOf('<script>') + 8, terminalHtml.lastIndexOf('</script>'))
  assert.doesNotThrow(() => new Function(script))
  assert.match(script, /blocksModule\.trackTerminalBlocks\(term\)/)
  assert.match(script, /installTerminalCopy\(term,post,blocksModule\.terminalRowsText,blocks\)/)
})
