// The background service: schedules, work that finishes while the app is closed, and recovery after restarts.
import { fakeAgent, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('background')
const { page, api, until, check } = ramu
const eventsOf = (session) => api('agent.events', session.id)
const state = async (session) => (await api('agent.get', session.id)).state
const awaitingApproval = (session) => until(async () => (await state(session)) === 'needs-input', 'approval request')
const restartSettings = { ...fakeAgent.claude, access: 'edits', autoFallback: true, serviceTier: 'standard' }
// The background service outlives the window; killing it simulates a crash.
const crashAndReopen = () =>
  ramu.relaunch(async () => {
    process.kill((await api('background.status')).pid, 'SIGKILL')
    await ramu.sleep(300)
  })

ramu.test('the Schedules page creates a one-time schedule', async () => {
  await page.getByRole('button', { name: 'Schedules', exact: true }).click()
  await page.getByRole('button', { name: 'New schedule', exact: true }).last().click()
  await page.getByLabel('Name', { exact: true }).fill('One-time smoke run')
  await page.getByLabel('What should the agent do?').fill('Summarize daily work')
  await page.getByRole('combobox', { name: 'Frequency', exact: true }).click()
  await page.getByRole('option', { name: 'Once', exact: true }).click()
  await page.getByRole('combobox', { name: 'Scope', exact: true }).click()
  await page.getByRole('option', { name: 'No project', exact: true }).click()
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click()
  await page.getByRole('heading', { name: 'One-time smoke run' }).waitFor()
  await ramu.shot('schedules')
  check((await api('schedules.list'))[0].rule.kind === 'once', 'Schedules UI creates a one-time schedule')
})

ramu.test('chats and schedules complete while the app is closed', async () => {
  const { session } = await startChat(ramu, {
    title: 'Survives app close',
    prompt: 'Continue in background',
    settings: { ...fakeAgent.claude, access: 'edits' },
    state: 'needs-input',
  })
  const request = (await eventsOf(session)).findLast((e) => e.kind === 'permission-request')
  const schedule = await api('schedules.save', {
    name: 'Closed app execution',
    prompt: 'Run without an open window',
    projectId: 'no-project',
    timezone: 'Asia/Jakarta',
    rule: { kind: 'once', at: new Date(Date.now() + 2000).toISOString() },
    missedPolicy: 'latest',
    settings: { ...fakeAgent.claude, access: 'full' },
  })
  const { pid } = await api('background.status')
  await ramu.closeApp()
  await api('agent.replyPermission', session.id, request.requestId, true)
  await until(async () => (await state(session)) === 'idle', 'chat to finish with the app closed')
  // The scheduler ticks every 5 s, so a run can take two ticks to start and complete.
  await until(
    async () => (await api('schedules.runs', schedule.id)).some((r) => r.status === 'completed'),
    'schedule run',
    { attempts: 300 },
  )
  check(
    (await api('schedules.list')).find((s) => s.id === schedule.id).state === 'completed',
    'One-time schedule runs once while closed',
  )
  await ramu.launch()
  check((await api('background.status')).pid === pid, 'Reopening reconnects to the same service')
  check(
    (await eventsOf(session)).some((e) => e.kind === 'result'),
    'Background output survives close and reopen',
  )
})

ramu.test('a crashed service continues the interrupted chat with a fresh approval', async () => {
  const { session } = await startChat(ramu, {
    title: 'Restart recovery',
    prompt: 'Continue the interrupted work',
    settings: restartSettings,
    state: 'needs-input',
  })
  await crashAndReopen()
  await until(
    async () =>
      (await eventsOf(session)).some((e) => e.kind === 'recovery') && (await state(session)) === 'needs-input',
    'interrupted chat to continue',
  )
  const events = await eventsOf(session)
  check(
    events.filter((e) => e.kind === 'user').length === 1 && events.filter((e) => e.kind === 'recovery').length === 1,
    'Service restart continues the chat without duplicating its user message',
  )
  check(events.filter((e) => e.kind === 'permission-request').length === 2, 'Recovery asks for a fresh approval')
  ramu.session = session
})

ramu.test('a clean service restart preserves unfinished chats', async () => {
  const session = ramu.session
  await ramu.closeApp()
  await api('background.restart')
  await until(
    () =>
      api('background.status').then(
        () => false,
        () => true,
      ),
    'service to finish its clean restart',
  )
  await ramu.launch()
  await until(
    async () =>
      (await eventsOf(session)).filter((e) => e.kind === 'recovery').length === 2 &&
      (await state(session)) === 'needs-input',
    'chat to continue after clean restart',
  )
  check(
    (await eventsOf(session)).filter((e) => e.kind === 'user').length === 1,
    'Clean restart keeps unfinished chats for app updates',
  )
  await api('agent.stop', session.id)
})

ramu.test('with continuation off, interrupted chats wait for manual recovery', async () => {
  const preferences = await api('settings.app.get')
  await api('settings.app.set', { ...preferences, resumeChatsOnRestart: false })
  const { session } = await startChat(ramu, {
    title: 'Manual recovery',
    prompt: 'Leave this interrupted',
    settings: restartSettings,
    state: 'needs-input',
  })
  await crashAndReopen()
  check(
    (await state(session)) === 'restored' && !(await eventsOf(session)).some((e) => e.kind === 'recovery'),
    'Interrupted chats stay available for manual recovery',
  )
  await api('settings.app.set', preferences)
  ramu.noErrors()
})
