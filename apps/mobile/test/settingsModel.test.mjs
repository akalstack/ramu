import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_ROWS,
  SETTINGS_SECTIONS,
  allowedOptions,
  applyValue,
  buildEdit,
  isOutdated,
  limitChoiceEdits,
  limitChoiceState,
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

const limitRow = () => SETTINGS_ROWS.access.flatMap((group) => group.rows).find((row) => row.kind === 'limit')
const readFrom = (values) => (path) => values[path]

test('the limit choice replaces the single fallback toggle and edits both stored settings', () => {
  const row = limitRow()
  assert.equal(row.title, 'When a usage limit is reached')
  assert.equal(row.path, 'defaultAutoFallback')
  assert.equal(row.resumePath, 'fallback.autoResume')
  const all = Object.values(SETTINGS_ROWS).flatMap((groups) => groups.flatMap((group) => group.rows))
  assert.ok(!all.some((entry) => entry.title === 'Automatic provider fallback'))
})

test('the limit choice maps the stored pair to three options and shows the hidden fourth only when stored', () => {
  const row = limitRow()
  const state = (fallback, resume) =>
    limitChoiceState(readFrom({ defaultAutoFallback: fallback, 'fallback.autoResume': resume }), row)
  assert.equal(state(true, true).current, 'switch')
  assert.equal(state(false, true).current, 'wait')
  assert.equal(state(false, false).current, 'stop')
  assert.deepEqual(
    state(true, true).options.map((option) => option.label),
    ['Switch to another model', 'Wait on this model', 'Stop and let me decide'],
  )
  const fourth = state(true, false)
  assert.equal(fourth.current, 'switch-then-stop')
  assert.equal(fourth.options.at(-1).label, 'Switch, then stop if none has room')
})

test('picking an option saves both settings, and only the ones that change', () => {
  const row = limitRow()
  const read = readFrom({ defaultAutoFallback: true, 'fallback.autoResume': true })
  assert.deepEqual(limitChoiceEdits('wait', read, row), [['defaultAutoFallback', false]])
  assert.deepEqual(limitChoiceEdits('stop', read, row), [
    ['defaultAutoFallback', false],
    ['fallback.autoResume', false],
  ])
  assert.deepEqual(limitChoiceEdits('switch', read, row), [])
  assert.deepEqual(limitChoiceEdits('switch-then-stop', read, row), [['fallback.autoResume', false]])
})

test('a host with both settings gets the limit choice; one with only the fallback setting gets the old switch instead', () => {
  const rows = (settings) => visibleGroups('access', settings).flatMap((group) => group.rows)
  const both = [setting('defaultAutoFallback', true), setting('fallback.autoResume', true)]
  const modern = rows(both).find((row) => row.path === 'defaultAutoFallback')
  assert.equal(modern.kind, 'limit')
  assert.equal(modern.title, 'When a usage limit is reached')
  // An older host: same setting, the single switch it always had, so nothing is hidden.
  const older = rows([setting('defaultAutoFallback', true)]).find((row) => row.path === 'defaultAutoFallback')
  assert.equal(older.kind, 'toggle')
  assert.equal(older.title, 'Automatic provider fallback')
  assert.match(older.help, /waits and resumes on the same provider/)
  // Only the resume setting, or neither: there is nothing to edit.
  assert.ok(!rows([setting('fallback.autoResume', true)]).some((row) => row.path === 'defaultAutoFallback'))
  assert.ok(!rows([]).some((row) => row.path === 'defaultAutoFallback'))
  const title = (settings) =>
    searchSettings('fallback', settings)
      .filter((hit) => hit.section === 'access')
      .map((hit) => hit.title)
  assert.ok(title(both).includes('When a usage limit is reached'))
  assert.ok(title([setting('defaultAutoFallback', true)]).includes('Automatic provider fallback'))
  assert.ok(!title([setting('defaultAutoFallback', true)]).includes('When a usage limit is reached'))
})

test('the limit choice is found by the words people use for it', () => {
  for (const query of ['fallback', 'wait', 'stop', 'switch', 'resume', 'limit'])
    assert.ok(
      searchSettings(query, null).some((hit) => hit.title === 'When a usage limit is reached'),
      query,
    )
})

test('branch naming shows only the inputs used by the selected strategy', () => {
  const paths = (strategy) =>
    visibleGroups('git', [
      setting('worktreeBranchNaming', strategy),
      setting('worktreeBranchInstructions', 'Use ticket/'),
      setting('worktreeBranchPrefix', 'ramu/'),
    ]).flatMap((group) => group.rows.map((row) => row.path))
  assert.deepEqual(paths('fixed'), ['worktreeBranchNaming', 'worktreeBranchPrefix'])
  assert.deepEqual(paths('semantic'), ['worktreeBranchNaming'])
  assert.deepEqual(paths('custom'), ['worktreeBranchNaming', 'worktreeBranchInstructions'])
})
