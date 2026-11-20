import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { terminalLinkMessage } from '../src/runtime/terminalLinkMessage.ts'
import { terminalLinkAt } from '../../../packages/shared/src/workspace/terminalLinks.ts'
import { terminalHtml } from '../src/assets/terminal.ts'

test('only well-formed link reports reach the screen', () => {
  assert.deepEqual(terminalLinkMessage({ kind: 'link', link: 'url', text: 'https://a.dev' }), {
    kind: 'url',
    text: 'https://a.dev',
  })
  assert.equal(terminalLinkMessage({ kind: 'link', link: 'shell', text: 'rm -rf /' }), null)
  assert.equal(terminalLinkMessage({ kind: 'link', link: 'path', text: '' }), null)
  assert.equal(terminalLinkMessage({ kind: 'input', data: 'x' }), null)
  assert.equal(terminalLinkMessage(null), null)
})

/** A stub of the parts of xterm the link driver reads: 10 columns by 3 rows, scrolled one row down. */
function surface(rows, wrapped = []) {
  const listeners = {}
  const posted = []
  const term = {
    cols: 10,
    rows: 3,
    options: {},
    selected: false,
    hasSelection() {
      return this.selected
    },
    buffer: {
      active: {
        viewportY: 1,
        getLine: (row) =>
          row < rows.length
            ? {
                isWrapped: wrapped.includes(row),
                translateToString: (trim) => (trim ? rows[row].trimEnd() : rows[row]),
              }
            : undefined,
      },
    },
    element: {
      addEventListener: (type, listener) => (listeners[type] = listener),
      querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 60 }) }),
    },
  }
  const context = { performance: { now: () => 1000 }, URL, decodeURIComponent }
  vm.runInNewContext(readFileSync(new URL('../scripts/terminal-links.js', import.meta.url), 'utf8'), context)
  context.installTerminalLinks(term, (value) => posted.push(JSON.parse(JSON.stringify(value))), terminalLinkAt)
  // Each cell is 10 by 20 pixels.
  const tap = (column, row) => listeners.click({ clientX: column * 10 + 5, clientY: row * 20 + 5 })
  return { term, posted, tap }
}

test('a tap on a printed address or path reports that link, across a wrapped row', () => {
  const { posted, tap } = surface(['$ make    ', 'see https:', '//a.dev/x ', 'src/a.ts:3'], [2])
  tap(1, 0)
  tap(5, 0)
  tap(2, 1)
  tap(4, 2)
  assert.deepEqual(posted, [
    { kind: 'link', link: 'url', text: 'https://a.dev/x' },
    { kind: 'link', link: 'url', text: 'https://a.dev/x' },
    { kind: 'link', link: 'path', text: 'src/a.ts:3' },
  ])
})

test('a tap on plain text, or while text is selected, reports nothing', () => {
  const { term, posted, tap } = surface(['', 'plain text', 'src/a.ts:3'])
  tap(2, 0)
  term.selected = true
  tap(2, 1)
  assert.deepEqual(posted, [])
})

test('OSC 8 hyperlinks open web pages and local files, and nothing else', () => {
  const { term, posted } = surface([''])
  term.options.linkHandler.activate({}, 'https://example.com/docs')
  term.options.linkHandler.activate({}, 'file://laptop/Users/me/My%20Notes.md')
  term.options.linkHandler.activate({}, 'javascript:alert(1)')
  assert.deepEqual(posted, [
    { kind: 'link', link: 'url', text: 'https://example.com/docs' },
    { kind: 'link', link: 'path', text: '/Users/me/My Notes.md' },
  ])
})

test('the generated terminal bundle carries the link driver and parses without lookbehind', () => {
  const script = terminalHtml.slice(terminalHtml.indexOf('<script>') + 8, terminalHtml.lastIndexOf('</script>'))
  assert.doesNotThrow(() => new Function(script))
  assert.match(script, /installTerminalLinks\(term,post,linksModule\.terminalLinkAt\)/)
  const links = script.slice(script.indexOf('const linksModule'), script.indexOf('installTerminalLinks(term'))
  assert.doesNotMatch(links, /\(\?<[=!]/)
})
