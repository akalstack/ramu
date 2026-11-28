import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { terminalHtml } from '../src/assets/terminal.ts'

const source = readFileSync(new URL('../scripts/terminal-delete.js', import.meta.url), 'utf8')
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/** The terminal's hidden text field: its value and caret, and the events the keyboard sends it. */
function field() {
  const target = new EventTarget()
  target.value = ''
  target.setSelectionRange = (start) => (target.caret = start)
  target.fire = (type, init = {}) => target.dispatchEvent(Object.assign(new Event(type), init))
  return target
}

function install() {
  const context = { setTimeout, Event, EventTarget }
  vm.runInNewContext(`${source};this.install=installTerminalDelete`, context)
  const box = field()
  let sent = 0
  context.install(box, () => sent++)
  return { box, sent: () => sent }
}

test('the field keeps something for a held ⌫ to repeat on, and puts it back after each delete', async () => {
  const { box } = install()
  const pad = box.value
  assert.ok(pad.length >= 8, 'invisible characters for the keyboard to delete')
  assert.equal(box.caret, pad.length)
  box.value = pad.slice(1)
  box.fire('input', { inputType: 'deleteContentBackward' })
  await tick()
  assert.equal(box.value, pad)
})

test('a delete that came with no key event is sent once; one xterm read from its key is not sent again', async () => {
  const { box, sent } = install()
  box.fire('input', { inputType: 'deleteContentBackward' })
  await tick()
  assert.equal(sent(), 1)
  box.fire('keydown', { key: 'Backspace', keyCode: 8 })
  box.fire('input', { inputType: 'deleteContentBackward' })
  await tick()
  assert.equal(sent(), 1)
})

test('a word being composed is left alone until it is done', async () => {
  const { box, sent } = install()
  box.fire('compositionstart')
  box.value = 'ka'
  box.fire('input', { inputType: 'deleteContentBackward' })
  await tick()
  assert.equal(box.value, 'ka')
  assert.equal(sent(), 0)
  box.fire('compositionend')
  await tick()
  assert.notEqual(box.value, 'ka')
})

test('the terminal surface installs it on xterm’s field', () => {
  assert.match(terminalHtml, /installTerminalDelete\(field,/)
  assert.doesNotMatch(terminalHtml, /beat=setInterval\(del,70\)/)
})
