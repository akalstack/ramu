// Goals: the turn limit and automatic mode in Settings, goal detection through MCP, and pausing, resuming and clearing from chat.
import assert from 'node:assert/strict'
import { fakeAgent, openSettings, saveSettings, select, showChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('goals')
const waitForGoal = (id, predicate) =>
  ramu
    .until(async () => {
      const goal = await ramu.api('agent.goal', id)
      return predicate(goal) ? { goal } : null
    }, 'the goal never reached the expected state')
    .then(({ goal }) => goal)
let paused

ramu.test('the turn limit defaults to 10 and can be set to Unlimited', async () => {
  const { page } = ramu
  // Start predictably even if the machine's language is not English, and keep recaps out of the way.
  await ramu.api('settings.app.set', { ...(await ramu.api('settings.app.get')), language: 'en', recapsEnabled: false })
  await ramu.reload()
  assert.deepEqual((await ramu.api('settings.app.get')).goals, { mode: 'auto', maxTurns: 10 })
  await openSettings(ramu, 'Goals & delegation')
  assert.equal(await page.getByRole('combobox', { name: 'Maximum continuation turns', exact: true }).innerText(), '10')
  await select(ramu, 'Maximum continuation turns', 'Unlimited')
  await ramu.shot('settings-unlimited')
  await saveSettings(ramu)
  assert.deepEqual((await ramu.api('settings.app.get')).goals, { mode: 'auto', maxTurns: null })
})

ramu.test('Cancel discards a change', async () => {
  const { page } = ramu
  await openSettings(ramu, 'Goals & delegation')
  await page.getByRole('switch', { name: 'Automatic goals', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await ramu.api('settings.app.get')).goals.mode, 'auto')
})

ramu.test('an agent detects a goal through MCP, continues once and reports completion', async () => {
  const task = await ramu.api('tasks.create', { projectId: 'no-project', title: 'Goal smoke', mode: 'current' })
  const session = await ramu.api('agent.start', task.id, 'Verify goals [goal tool]', fakeAgent.codex)
  const goal = await waitForGoal(session.id, (goal) => goal?.status === 'completed')
  assert.equal(goal.turns, 1)
  assert.equal(goal.objective, 'Verify the goal smoke fixture [goal tool]')
})

ramu.test('turning Automatic goals off saves manual mode', async () => {
  const { page } = ramu
  await openSettings(ramu, 'Goals & delegation')
  await page.getByRole('switch', { name: 'Automatic goals', exact: true }).click()
  await saveSettings(ramu)
  assert.equal((await ramu.api('settings.app.get')).goals.mode, 'manual')
})

ramu.test('Stop pauses a goal, Resume restarts it, and Clear removes it after a reload', async () => {
  const { page } = ramu
  const task = await ramu.api('tasks.create', { projectId: 'no-project', title: 'Paused goal', mode: 'current' })
  const session = await ramu.api('agent.start', task.id, '/goal Keep working on the fixture', fakeAgent.codex)
  await ramu.api('agent.stop', session.id)
  assert.equal((await ramu.api('agent.goal', session.id)).status, 'paused')
  paused = { task, session }
  await showChat(ramu, paused)
  const bar = page.locator('.goal-bar:visible')
  await bar.getByText('Goal paused', { exact: true }).waitFor()
  await ramu.shot('chat-paused')
  await bar.getByRole('button', { name: 'Resume goal', exact: true }).click()
  await waitForGoal(session.id, (goal) => goal?.turns >= 1)
  await ramu.api('agent.stop', session.id)

  await showChat(ramu, paused)
  assert.equal((await ramu.api('agent.goal', session.id)).status, 'paused')
  await page.locator('.goal-bar:visible').getByRole('button', { name: 'Clear goal', exact: true }).click()
  await page.locator('.goal-bar:visible').waitFor({ state: 'detached' })
  assert.equal(await ramu.api('agent.goal', session.id), null)
  ramu.noErrors()
})
