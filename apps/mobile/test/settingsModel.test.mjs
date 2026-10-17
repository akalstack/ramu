import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_ROWS,
  SETTINGS_SECTIONS,
  allowedOptions,
  applyValue,
  buildEdit,
  isOutdated,
  patchSetting,
  searchSettings,
  setHostSetting,
  visibleGroups,
} from '../src/runtime/settingsModel.ts'

const setting = (path, value, schema = {}) => ({ path, value, schema })
const snapshot = (...settings) => ({ protocol: 1, settings })

test('every section has a page, rows only exist for known sections, and sections are unique', () => {
  const ids = SETTINGS_SECTIONS.map((section) => section.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of Object.keys(SETTINGS_ROWS)) assert.ok(ids.includes(id), id)
})

test('no two rows edit the same setting, so a setting is never shown twice', () => {
  const paths = Object.values(SETTINGS_ROWS).flatMap((groups) =>
    groups.flatMap((group) => group.rows.map((row) => row.path)),
  )
  assert.deepEqual(
    paths.filter((path, index) => paths.indexOf(path) !== index),
    [],
  )
})

test('rows the host does not offer are hidden, so an older host still works', () => {
  const groups = visibleGroups('git', [setting('autoPull', true), setting('commitStyle', 'conventional')])
  assert.deepEqual(
    groups.flatMap((group) => group.rows.map((row) => row.path)),
    ['autoPull', 'commitStyle'],
  )
  assert.deepEqual(visibleGroups('git', []), [])
})

test('a dependent row appears only while its condition holds', () => {
  const settings = [setting('commitStyle', 'conventional'), setting('commitInstructions', '')]
  const paths = (value) =>
    visibleGroups('git', settings, (path) => (path === 'commitStyle' ? value : undefined)).flatMap((group) =>
      group.rows.map((row) => row.path),
    )
  assert.ok(!paths('conventional').includes('commitInstructions'))
  assert.ok(paths('custom').includes('commitInstructions'))
})

test("the server's own choices and range win over the phone's list, and the value in force is never hidden", () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ]
  assert.deepEqual(allowedOptions(options, { enum: ['a'] }, 'a'), [{ value: 'a', label: 'A' }])
  const numbers = [3, 10, 50].map((value) => ({ value, label: String(value) }))
  assert.deepEqual(
    allowedOptions(numbers, { minimum: 5, maximum: 20 }, 10).map((o) => o.value),
    [10],
  )
  // A custom turn limit set on the desktop stays selectable.
  assert.deepEqual(
    allowedOptions(numbers, undefined, 7).map((o) => o.value),
    [7, 3, 10, 50],
  )
})

test('an edit carries the server schema and the value the host last confirmed', () => {
  const schema = { type: 'boolean' }
  const entry = setting('autoPull', true, schema)
  assert.deepEqual(buildEdit(entry, false), { path: 'autoPull', schema, before: true, value: false })
  const next = applyValue(snapshot(entry, setting('pullMode', 'rebase')), 'autoPull', false)
  assert.deepEqual(
    next.settings.map((s) => s.value),
    [false, 'rebase'],
  )
})

test('saving patches through the portable API and returns the new snapshot', async () => {
  const calls = []
  const confirmed = snapshot(setting('goals.mode', 'auto', { enum: ['auto', 'manual'] }))
  const result = snapshot(setting('goals.mode', 'manual'))
  const host = async (method, edits) => {
    calls.push([method, edits])
    return result
  }
  assert.equal(await patchSetting(host, confirmed, 'goals.mode', 'manual'), result)
  assert.deepEqual(calls, [
    [
      'settings.app.patch',
      [{ path: 'goals.mode', schema: { enum: ['auto', 'manual'] }, before: 'auto', value: 'manual' }],
    ],
  ])
  await assert.rejects(patchSetting(host, confirmed, 'nope', 1), /no “nope” setting/)
})

test('setHostSetting reads the host first, then patches it', async () => {
  const calls = []
  const invoke = async (computer, method, ...args) => {
    calls.push([computer, method])
    return method === 'settings.app.snapshot'
      ? snapshot(setting('warnModelChange', true))
      : snapshot(setting('warnModelChange', args[0][0].value))
  }
  await setHostSetting(invoke, 'pc', 'warnModelChange', false)
  assert.deepEqual(calls, [
    ['pc', 'settings.app.snapshot'],
    ['pc', 'settings.app.patch'],
  ])
})

test('only an unknown-method error means the host needs updating', () => {
  assert.ok(isOutdated(new Error('Unknown method settings.app.snapshot')))
  assert.ok(!isOutdated(new Error('Network request failed')))
})

test('search finds host and phone settings by title, words and section', () => {
  const hit = (query, settings = null) => searchSettings(query, settings).map((entry) => entry.title)
  assert.ok(hit('pull').includes('Automatic pull'))
  assert.ok(hit('haptic').includes('Haptic feedback'))
  assert.ok(hit('dynamic island').includes('Live Activities'))
  assert.ok(hit('git commit').includes('Commit messages'))
  assert.deepEqual(hit('   '), [])
  assert.deepEqual(hit('zzzz'), [])
})

test('search leaves out rows the host does not have, but keeps phone settings', () => {
  const settings = [setting('autoPull', true)]
  const titles = searchSettings('a', settings).map((entry) => entry.title)
  assert.ok(titles.includes('Automatic pull'))
  assert.ok(!titles.includes('Pull behavior'))
  assert.ok(titles.includes('Haptic feedback'))
})
