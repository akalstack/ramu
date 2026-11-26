import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { terminalSelectionMessage } from '../src/runtime/terminalSelection.ts'
import { terminalBlockAt } from '../../../packages/shared/src/workspace/terminalBlocks.ts'
import { terminalHtml } from '../src/assets/terminal.ts'

const CELL = { width: 10, height: 20 }

/** A stub of the parts of xterm the selection driver uses: 20 columns, rows on screen from `viewportY`. */
function surface(lines, { viewportY = 0, rows = lines.length, blockRanges = [] } = {}) {
  const cols = 20
  const text = lines.map((line) => line.padEnd(cols))
  const listeners = { message: [], pointerdown: [] }
  const posted = []
  const hooks = { selectionChange: [] }
  let range = null
  const term = {
    cols,
    rows,
    element: {
      querySelector: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: cols * CELL.width, height: rows * CELL.height }),
      }),
    },
    buffer: { active: { viewportY, length: text.length, getLine: (row) => ({ translateToString: () => text[row] }) } },
    select(col, row, length) {
      range = { col, row, length }
      hooks.selectionChange.forEach((hook) => hook())
    },
    clearSelection() {
      range = null
      hooks.selectionChange.forEach((hook) => hook())
    },
    hasSelection: () => !!range,
    getSelection() {
      if (!range) return ''
      let out = ''
      for (let i = 0; i < range.length; i++) {
        const at = range.row * cols + range.col + i
        const row = Math.floor(at / cols)
        out += (text[row] ?? '')[at % cols] ?? ''
        if (at % cols === cols - 1 && i < range.length - 1) out += '\n'
      }
      return out
    },
    onRender() {},
    onScroll() {},
    onResize() {},
    onSelectionChange: (hook) => hooks.selectionChange.push(hook),
  }
  const blocks = { blocks: () => blockRanges }
  const target = {
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
  }
  const context = { window: target, document: target, JSON, requestAnimationFrame: () => 1 }
  vm.runInNewContext(readFileSync(new URL('../scripts/terminal-select.js', import.meta.url), 'utf8'), context)
  const driver = context.installTerminalSelect(
    term,
    (value) => posted.push(JSON.parse(JSON.stringify(value))),
    blocks,
    terminalBlockAt,
  )
  return {
    driver,
    posted,
    last: () => posted.at(-1),
    send: (value) => listeners.message.forEach((listener) => listener({ data: JSON.stringify(value) })),
    touch: () => listeners.pointerdown.forEach((listener) => listener({})),
    /** The middle of a cell, in the page's pixels. */
    at: (col, row) => [col * CELL.width + CELL.width / 2, row * CELL.height + CELL.height / 2],
  }
}

test('a long press selects the whole path or word under the finger, and the phone gets where its ends are', () => {
  const view = surface(['$ cat /tmp/a.txt', 'hello world'])
  view.driver.selectWordAt(...view.at(9, 0))
  assert.deepEqual(view.last(), {
    kind: 'selection',
    active: true,
    text: '/tmp/a.txt',
    start: { x: 60, y: 0 },
    end: { x: 160, y: 0 },
    lineHeight: 20,
    block: false,
  })
})

test('a long press on blank space selects nothing', () => {
  const view = surface(['$ ls', ''])
  view.driver.selectWordAt(...view.at(10, 1))
  assert.equal(view.posted.length, 0)
})

test('dragging a handle stretches the selection across rows, and past the other end the two swap', () => {
  const view = surface(['one two', 'three four'])
  view.driver.selectWordAt(...view.at(4, 0))
  assert.equal(view.last().text, 'two')
  // The end handle to just after "three".
  view.send({ kind: 'selection-grab', handle: 'end' })
  view.send({ kind: 'selection-move', handle: 'end', x: 50, y: 30 })
  assert.equal(view.last().text, 'two' + ' '.repeat(13) + '\nthree')
  // The end handle dragged before the start: it becomes the start, and the old start the end.
  view.send({ kind: 'selection-move', handle: 'end', x: 0, y: 10 })
  assert.equal(view.last().text, 'one t')
  // The finger keeps its handle after the swap: dragging on measures from the same fixed end.
  view.send({ kind: 'selection-move', handle: 'end', x: 20, y: 10 })
  assert.equal(view.last().text, 'ne t')
})

test('a tap anywhere, or Copy asking for it, lets the selection go', () => {
  const view = surface(['echo hi'])
  view.driver.selectWordAt(...view.at(1, 0))
  view.touch()
  assert.deepEqual(view.last(), { kind: 'selection', active: false })
  view.driver.selectWordAt(...view.at(1, 0))
  view.send({ kind: 'selection-clear' })
  assert.deepEqual(view.last(), { kind: 'selection', active: false })
})

test('Select command takes the command the selection is in, with its output', () => {
  const view = surface(['$ make', 'building', 'built', '$ ls'], {
    blockRanges: [
      { start: 0, end: 2 },
      { start: 3, end: 3 },
    ],
  })
  view.driver.selectWordAt(...view.at(2, 1))
  assert.equal(view.last().block, true)
  view.send({ kind: 'selection-block' })
  const selected = view.last()
  assert.match(selected.text, /^\$ make\s+\nbuilding\s+\nbuilt/)
  assert.equal(selected.block, false)
})

test('an end scrolled out of view has no handle', () => {
  const view = surface(['first', 'second', 'third'], { viewportY: 1, rows: 2 })
  view.send({ kind: 'selection-all' })
  assert.equal(view.last().start, null)
  assert.deepEqual(view.last().end, { x: 200, y: 20 })
})

test("only a well-formed report reaches the phone's handles", () => {
  const report = { kind: 'selection', active: true, text: 'ls', start: { x: 1, y: 2 }, end: null, lineHeight: 18 }
  assert.deepEqual(terminalSelectionMessage(report), {
    text: 'ls',
    start: { x: 1, y: 2 },
    end: null,
    lineHeight: 18,
    block: false,
  })
  assert.equal(terminalSelectionMessage({ kind: 'selection', active: false }), null)
  assert.equal(terminalSelectionMessage({ ...report, text: '   ' }), null)
  assert.equal(terminalSelectionMessage({ ...report, lineHeight: 0 }), undefined)
  assert.equal(terminalSelectionMessage({ ...report, text: 3 }), undefined)
  assert.equal(terminalSelectionMessage({ kind: 'input', data: 'x' }), undefined)
  assert.equal(terminalSelectionMessage(null), undefined)
})

test('the generated terminal bundle selects on a released hold', () => {
  const script = terminalHtml.slice(terminalHtml.indexOf('<script>') + 8, terminalHtml.lastIndexOf('</script>'))
  assert.doesNotThrow(() => new Function(script))
  assert.match(script, /installTerminalSelect\(term,post,blocks,blocksModule\.terminalBlockAt\)/)
  assert.match(script, /selecting\.selectWordAt\)/)
})
