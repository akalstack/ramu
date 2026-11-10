import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_GROUPS,
  SETTINGS_ROWS,
  SETTINGS_SECTIONS,
  allowedOptions,
  applyValue,
  buildEdit,
  limitChoiceEdits,
  limitChoiceState,
  patchSetting,
  patchSettings,
  providerEnabledEdits,
  providerSwitches,
  rowDefaultEdits,
  searchSettings,
  sectionById,
  setHostSetting,
  splitAdvanced,
  visibleGroups,
} from '../src/runtime/settingsModel.ts'

const setting = (path, value, schema = {}) => ({ path, value, schema })
const snapshot = (...settings) => ({ protocol: 1, settings })

test('model selection offers the host-supported flow and patches only that choice', async () => {
  const field = setting('$models.defaultBarMode', 'model', { type: 'string', enum: ['model', 'effort'] })
  const groups = visibleGroups('models', [field])
  const row = groups.flatMap((group) => group.rows).find((row) => row.path === field.path)
  assert.deepEqual(row.options, [
    { value: 'model', label: 'Steps' },
    { value: 'effort', label: 'Model then effort' },
  ])
  const calls = []
  await patchSetting(
    async (method, edits) => {
      calls.push({ method, edits })
      return snapshot({ ...field, value: 'effort' })
    },
    snapshot(field),
    field.path,
    'effort',
  )
  assert.deepEqual(calls, [{ method: 'settings.app.patch', edits: [{ ...field, before: 'model', value: 'effort' }] }])
  assert.equal(
    visibleGroups('models', [])
      .flatMap((group) => group.rows)
      .some((row) => row.path === field.path),
    false,
  )
})

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

test('only an unknown-method error means the host needs updating', () => {})

test('search finds host and phone settings by title, words and section', () => {
  const hit = (query, settings = null) => searchSettings(query, settings).map((entry) => entry.title)
  assert.ok(hit('pull').includes('Automatic pull'))
  assert.ok(hit('haptic').includes('Haptic feedback'))
  assert.ok(hit('dynamic island').includes('Live Activities'))
  assert.ok(hit('git commit').includes('Style'))
  assert.deepEqual(hit('   '), [])
  assert.deepEqual(hit('zzzz'), [])
})

test('search opens test devices by the words people use, and archived threads as the Threads filter', () => {
  assert.equal(searchSettings('simulator', null)[0].section, 'devices')
  assert.equal(searchSettings('emulator', null)[0].section, 'devices')
  assert.ok(searchSettings('fallback', null).every((hit) => hit.section === 'models'))
  assert.deepEqual(searchSettings('archived', null)[0], { view: 'archived', title: 'Archived threads' })
  assert.equal(sectionById('devices').scope, 'host')
})

test('search leaves out rows the host does not have, but keeps phone settings', () => {
  const settings = [setting('autoPull', true)]
  const titles = searchSettings('a', settings).map((entry) => entry.title)
  assert.ok(titles.includes('Automatic pull'))
  assert.ok(!titles.includes('Pull behavior'))
  assert.ok(titles.includes('Haptic feedback'))
})

const limitRow = () => SETTINGS_ROWS.models.flatMap((group) => group.rows).find((row) => row.kind === 'limit')
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

test('a host with the limit settings gets the limit choice', () => {
  const rows = (settings) => visibleGroups('models', settings).flatMap((group) => group.rows)
  const both = [setting('defaultAutoFallback', true), setting('fallback.autoResume', true)]
  const modern = rows(both).find((row) => row.path === 'defaultAutoFallback')
  assert.equal(modern.kind, 'limit')
  assert.equal(modern.title, 'When a usage limit is reached')
  // Only the resume setting, or neither: there is nothing to edit.
  assert.ok(!rows([setting('fallback.autoResume', true)]).some((row) => row.path === 'defaultAutoFallback'))
  assert.ok(!rows([]).some((row) => row.path === 'defaultAutoFallback'))
  const title = (settings) =>
    searchSettings('fallback', settings)
      .filter((hit) => hit.section === 'models')
      .map((hit) => hit.title)
  assert.ok(title(both).includes('When a usage limit is reached'))
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

test('browser and automatic update rows appear only when the host offers them', () => {
  const agent = setting('agentBrowser.agentBrowser', 'integrated', { type: 'string', enum: ['integrated', 'provider'] })
  assert.equal(visibleGroups('browser', []).length, 0)
  assert.equal(visibleGroups('browser', [agent])[0].rows[0].path, agent.path)
  const auto = setting('appAutoUpdate', false, { type: 'boolean' })
  const rows = visibleGroups('system', [auto]).flatMap((group) => group.rows)
  assert.deepEqual(
    rows.map((row) => row.path),
    ['appAutoUpdate'],
  )
  assert.ok(SETTINGS_SECTIONS.some((section) => section.id === 'browser'))
})

test('computer use has its own page, found by search, and sub-agent, recall and commit-action rows follow the host', () => {
  assert.ok(SETTINGS_SECTIONS.some((section) => section.id === 'computer' && section.scope === 'host'))
  assert.ok(searchSettings('screen recording', null).some((hit) => hit.section === 'computer'))
  const paths = (section, settings) =>
    visibleGroups(section, settings).flatMap((group) => group.rows.map((row) => row.path))
  assert.deepEqual(
    paths('workflows', [setting('subagents.model', 'thread', { type: 'string', enum: ['thread', 'auto', 'pick'] })]),
    ['subagents.model'],
  )
  assert.deepEqual(paths('memory', [setting('intelligence.crossThreadRecall', true)]), [
    'intelligence.crossThreadRecall',
  ])
  assert.ok(paths('git', [setting('defaultCommitAction', 'commit')]).includes('defaultCommitAction'))
  // Older hosts without the setting simply do not show the row.
  assert.deepEqual(paths('workflows', []), [])
})

test('the phone menu has every desktop section a phone can use, arranged for a phone, under the desktop’s names', async () => {
  const { SETTINGS_MENU } = await import('../../../packages/shared/src/settingsMenu.ts')
  const shown = SETTINGS_SECTIONS.map((section) => section.id)
  // Nothing the phone can use is missing, and nothing only the host's keyboard needs is offered.
  assert.deepEqual(
    SETTINGS_MENU.filter((entry) => entry.phone)
      .map((entry) => entry.id)
      .filter((id) => !shown.includes(id)),
    [],
  )
  for (const hidden of ['editor', 'shortcuts', 'environment', 'archived']) assert.equal(sectionById(hidden), undefined)
  // The desktop's four groups in the desktop's order, then This phone.
  const byGroup = (group) => SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => section.id)
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => group.id),
    ['Personal', 'Agents', 'Agent tools', 'Access & host', 'phone'],
  )
  assert.deepEqual(byGroup('phone'), ['appearance', 'notifications', 'remote', 'account', 'about'])
  assert.deepEqual(byGroup('Personal'), ['chats'])
  assert.deepEqual(byGroup('Agents'), ['providers', 'models', 'agent-setup', 'plugins', 'workflows', 'memory'])
  assert.deepEqual(byGroup('Agent tools'), ['browser', 'computer', 'devices', 'git', 'deploy'])
  assert.deepEqual(byGroup('Access & host'), ['access', 'identities', 'system'])
  // Host pages keep the desktop's names, so a section reads the same on both.
  for (const section of SETTINGS_SECTIONS.filter((entry) => entry.scope === 'host'))
    assert.equal(section.label, SETTINGS_MENU.find((entry) => entry.id === section.id).label)
  assert.equal(sectionById('remote').label, 'Paired computers')
  assert.ok(searchSettings('izin', null, (text) => (text === 'Permissions' ? 'Izin' : text)).length > 0)

  // Media keys live on the Providers page, found by the services' names.
  assert.equal(sectionById('media'), undefined)
  assert.ok(searchSettings('elevenlabs', null, (text) => text).some((hit) => hit.section === 'providers'))
})

test('the advisor and the early switch show their details only while they apply', () => {
  const rows = (settings) =>
    visibleGroups('workflows', settings)
      .concat(visibleGroups('models', settings))
      .flatMap((group) => group.rows)
      .map((row) => row.path)
  const off = [
    setting('advisor.enabled', false),
    setting('advisor.step', null),
    setting('advisor.wait', false),
    setting('defaultAutoFallback', false),
    setting('fallback.autoResume', true),
    setting('fallback.switchAt', null),
  ]
  assert.deepEqual(
    rows(off).filter((path) => path.startsWith('advisor') || path === 'fallback.switchAt'),
    ['advisor.enabled'],
  )
  const on = off.map((entry) =>
    entry.path === 'advisor.enabled' || entry.path === 'defaultAutoFallback' ? { ...entry, value: true } : entry,
  )
  assert.deepEqual(
    rows(on).filter((path) => path.startsWith('advisor') || path === 'fallback.switchAt'),
    ['advisor.enabled', 'advisor.step', 'advisor.wait', 'fallback.switchAt'],
  )
  // The advisor's model is a whole step, kept with its id as the host stores it.
  assert.equal(
    SETTINGS_ROWS.workflows.flatMap((group) => group.rows).find((row) => row.path === 'advisor.step').withId,
    true,
  )
})

test('turning on a provider the host never configured saves its empty path and the switch in one change', async () => {
  const fields = [
    setting('providerBinaries.cursor.binary', undefined, { type: 'string' }),
    setting('providerBinaries.cursor.enabled', undefined, { type: 'boolean' }),
    setting('providerBinaries.codex.binary', '/usr/local/bin/codex', { type: 'string' }),
    setting('providerBinaries.codex.enabled', true, { type: 'boolean' }),
  ]
  const read = (path) => fields.find((field) => field.path === path)?.value
  const absent = providerEnabledEdits(read, 'cursor', false)
  assert.deepEqual(absent, [
    ['providerBinaries.cursor.binary', ''],
    ['providerBinaries.cursor.enabled', false],
  ])
  // A configured provider keeps its own path: only the switch changes.
  assert.deepEqual(providerEnabledEdits(read, 'codex', false), [['providerBinaries.codex.enabled', false]])
  const calls = []
  await patchSettings(
    async (method, edits) => {
      calls.push([method, edits])
      return snapshot()
    },
    snapshot(...fields),
    absent,
  )
  assert.equal(calls.length, 1, 'both values reach the host together, so it never sees an entry without a path')
  assert.deepEqual(
    calls[0][1].map((edit) => [edit.path, edit.before, edit.value]),
    [
      ['providerBinaries.cursor.binary', undefined, ''],
      ['providerBinaries.cursor.enabled', undefined, false],
    ],
  )
})

test('a missing provider switch reads as on, and the last provider on cannot be turned off', () => {
  const values = {
    'providerBinaries.claude-code.enabled': false,
    'providerBinaries.opencode.enabled': false,
    'providerBinaries.cursor.enabled': false,
    'providerBinaries.antigravity.enabled': false,
  }
  const switches = providerSwitches((path) => values[path])
  assert.deepEqual(
    switches.map(({ provider, enabled, locked }) => [provider, enabled, locked]),
    [
      ['claude-code', false, false],
      ['codex', true, true],
      ['opencode', false, false],
      ['cursor', false, false],
      ['antigravity', false, false],
    ],
  )
  // With two on, either may go off.
  assert.ok(providerSwitches(() => undefined).every(({ enabled, locked }) => enabled && !locked))
})

test('each provider can override the agent browser, and Use default removes its override', async () => {
  const field = setting('agentBrowser.providerOverrides.codex', 'provider', {
    type: 'string',
    enum: ['integrated', 'provider'],
  })
  const row = visibleGroups('browser', [field])
    .flatMap((group) => group.rows)
    .find((entry) => entry.path === field.path)
  assert.equal(row.title, 'Codex')
  assert.equal(row.unsetLabel, 'Use default')
  const calls = []
  await patchSetting(
    async (method, edits) => {
      calls.push(edits)
      return snapshot({ ...field, value: undefined })
    },
    snapshot(field),
    field.path,
    undefined,
  )
  assert.deepEqual(calls[0], [{ ...field, before: 'provider', value: undefined }])
})

test('tuning rows sit under Advanced and keep their group, while the rest of the page stays in view', () => {
  const settings = [
    setting('recentChats', 10),
    setting('cleanupArchivedDays', 0),
    setting('autoBackgroundSeconds', 60),
    setting('resumeChatsOnRestart', true),
  ]
  const { main, advanced } = splitAdvanced(visibleGroups('chats', settings))
  const paths = (groups) => groups.flatMap((group) => group.rows.map((row) => row.path))
  assert.deepEqual(paths(main), ['resumeChatsOnRestart'])
  assert.deepEqual(paths(advanced), ['autoBackgroundSeconds', 'recentChats', 'cleanupArchivedDays'])
  assert.deepEqual(
    advanced.map((group) => group.title),
    ['While agents work', 'Thread history'],
  )
})

test("a page's Reset defaults puts back only rows that differ from the host's advertised defaults", () => {
  const settings = [
    setting('recentChats', 5, { type: 'integer', default: 10 }),
    setting('cleanupArchivedDays', 0, { type: 'integer', default: 0 }),
    setting('autoBackgroundSeconds', 30, { type: 'integer' }),
    setting('defaultAutoFallback', false, { type: 'boolean', default: true }),
    setting('fallback.autoResume', false, { type: 'boolean', default: true }),
  ]
  const read = (path) => settings.find((entry) => entry.path === path)?.value
  const rows = [...visibleGroups('chats', settings), ...visibleGroups('models', settings)].flatMap(
    (group) => group.rows,
  )
  assert.deepEqual(rowDefaultEdits(rows, settings, read), [
    ['recentChats', 10],
    ['defaultAutoFallback', true],
    ['fallback.autoResume', true],
  ])
})

test('the phone sets what happens to long idle Claude threads, with the same three choices as the desktop', () => {
  const rows = visibleGroups('chats', [setting('idleCompaction', 'onReturn', { type: 'string' })]).flatMap(
    (group) => group.rows,
  )
  const row = rows.find((entry) => entry.path === 'idleCompaction')
  assert.equal(row.kind, 'choice')
  assert.deepEqual(
    row.options.map((option) => option.value),
    ['onReturn', 'beforeCacheExpires', 'off'],
  )
})
