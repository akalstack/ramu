// The advisor: enabling it in Settings, consulting it from Claude and Codex chats, and how a consultation shows in chat.
import assert from 'node:assert/strict'
import { fakeAgent, openSettings, saveSettings, showChat, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('advisor')
const codexAdvisor = {
  enabled: true,
  wait: false,
  step: { id: 'advisor', provider: 'codex', model: 'fake-codex', effort: 'high' },
}
let saved
let chat

/** Delivers an agent event to the renderer the way a live consultation does, without a model call. */
const push = (event) =>
  ramu.app.evaluate(
    ({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0].webContents.send('agent:event', payload),
    {
      sessionId: chat.session.id,
      event,
    },
  )

ramu.test('the advisor is off until it is enabled in Settings', async () => {
  const { page } = ramu
  assert.equal((await ramu.api('settings.app.get')).advisor?.enabled, false)
  await openSettings(ramu, 'Goals & delegation')
  await page.locator('.advisor-settings').waitFor()
  const advisorSwitch = page.getByRole('switch', { name: 'Advisor', exact: true })
  const inset = async () => {
    await ramu.sleep(180) // the thumb slides
    return advisorSwitch.evaluate((el) => {
      const track = el.getBoundingClientRect()
      const thumb = el.querySelector('[data-slot="switch-thumb"]').getBoundingClientRect()
      return {
        left: thumb.left - track.left,
        right: track.right - thumb.right,
        top: thumb.top - track.top,
        bottom: track.bottom - thumb.bottom,
      }
    })
  }
  const off = await inset()
  await advisorSwitch.click()
  const on = await inset()
  for (const gap of [off, on])
    assert.ok(
      Object.values(gap).every((value) => value >= 2),
      `the thumb stays inside its track: ${JSON.stringify(gap)}`,
    )
  assert.ok(Math.abs(off.left - on.right) < 0.5, 'checked and unchecked insets are symmetrical')
  await ramu.shot('settings')
  await saveSettings(ramu)
  saved = await ramu.api('settings.app.get')
  ramu.check(
    saved.advisor.enabled && saved.advisor.step?.model,
    `saving turns the advisor on with a model (${saved.advisor.step?.provider}:${saved.advisor.step?.model})`,
  )
})

for (const provider of ['claude-code', 'codex']) {
  ramu.test(`${provider} chats consult a Codex advisor, waiting or in the background`, async () => {
    await ramu.api('settings.app.set', { ...saved, advisor: codexAdvisor })
    const settings = provider === 'codex' ? fakeAgent.codex : fakeAgent.claude
    const waited = await startChat(ramu, {
      title: `${provider} waits for advice`,
      prompt: '[advisor] plan the change',
      settings,
      state: null,
    })
    await ramu.until(
      async () => ['idle', 'failed'].includes((await ramu.api('agent.get', waited.session.id)).state),
      'the blocking advisor call never finished',
    )
    assert.equal((await ramu.api('agent.get', waited.session.id)).state, 'idle')

    const later = await startChat(ramu, {
      title: `${provider} keeps working`,
      prompt: '[advisor async] plan the change',
      settings,
      state: null,
    })
    const advice = await ramu.until(
      async () =>
        (await ramu.api('agent.events', later.session.id)).find(
          (e) => e.kind === 'user' && e.text.startsWith("Advice from Ramu's advisor"),
        ),
      'no async advice arrived',
    )
    assert.ok(advice.text.includes('fake-codex · Codex') && advice.text.includes('Is the plan sound?'))
    await ramu.until(
      async () => (await ramu.api('agent.get', later.session.id)).state === 'idle',
      'the advice turn never finished',
    )
    const card = (await ramu.api('agent.events', later.session.id))
      .filter((e) => e.kind === 'agent' && e.taskType === 'advisor')
      .at(-1)
    assert.ok(card?.status === 'completed' && card.background)
    ramu.check(true, `${provider} consults the advisor and receives its advice`)
    if (provider === 'claude-code') chat = { ...later, card }
  })
}

ramu.test('chat shows the consultation as one compact row that follows its progress', async () => {
  const { page } = ramu
  const { card } = chat
  await showChat(ramu, chat)
  await page.locator('.advice-delivered:visible').waitFor()
  const row = page.locator('.transcript .advisor-activity')
  await row.filter({ hasText: 'Advisor finished' }).waitFor()
  assert.equal(await page.locator('.transcript .advisor-activity.completed').count(), 1)

  await push({ ...card, status: 'running', endedAt: undefined })
  await page.locator('.transcript .advisor-activity.running').waitFor()
  assert.equal(await page.locator('.transcript .advisor-activity.running [data-slot="spinner"]').count(), 1)
  assert.match(await row.textContent(), /Consulting advisor/)
  await ramu.shot('consulting')
  await push({ ...card, status: 'failed', error: 'Advisor unavailable' })
  await page.locator('.transcript .advisor-activity.failed').waitFor()
  assert.equal(await row.count(), 1, 'progress updates reuse one row')
  await push({ ...card, status: 'stopped' })
  await page.locator('.transcript .advisor-activity.stopped').waitFor()
  await push(card)
  await page.locator('.transcript .advisor-activity.completed').waitFor()
  ramu.check(true, 'the advisor row shows running, failed, stopped and finished states')
})

ramu.test('opening the consultation shows its question and answer, and Agents lists it', async () => {
  const { page } = ramu
  await page.locator('.transcript .advisor-activity').click()
  const panel = page.locator('.agent-panel')
  await panel.waitFor()
  assert.ok(await panel.locator('.msg.assistant').filter({ hasText: 'Verify the tests' }).isVisible())
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })

  await page.locator('.agents-chip').filter({ hasText: 'Agents' }).click()
  await panel.locator('.agent-task-card').filter({ hasText: 'Advisor' }).first().waitFor()
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })

  await page.locator('.advice-delivered:visible').click()
  await panel.waitFor()
  assert.ok(
    await panel.locator('.msg.user').filter({ hasText: 'Is the plan sound?' }).isVisible(),
    'the panel shows the question',
  )
  assert.ok(await panel.locator('.msg.assistant').filter({ hasText: 'Verify the tests' }).isVisible(), 'and the answer')
  await ramu.shot('panel')
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })
  ramu.check(true, 'the advisor panel reads like a chat')
})

ramu.test('advisor, delivered advice and goal rows share one compact style', async () => {
  const { page } = ramu
  assert.equal(await page.locator('.advice-delivered:visible').count(), 1, 'delivered advice is a compact row')
  assert.equal(
    await page.locator('.msg.user').filter({ hasText: "Advice from Ramu's advisor" }).count(),
    0,
    'not a user bubble',
  )
  assert.equal(
    await page.locator('.transcript .msg.assistant .msg-actions').count(),
    1,
    'only the latest reply has timestamp and copy controls',
  )

  await push({
    kind: 'goal',
    goal: {
      id: 'design-goal',
      objective: 'Check shared activity rows',
      status: 'completed',
      turns: 1,
      reason: '',
      updatedAt: Date.now(),
    },
  })
  const goalRow = page.locator('.goal-done .chat-activity-row')
  await goalRow.click()
  await page.locator('.goal-done .goal-details').waitFor()
  await goalRow.click()
  const styles = await page.evaluate(() =>
    ['.advisor-activity', '.advice-delivered', '.goal-done .chat-activity-row'].map((selector) => {
      const style = getComputedStyle(document.querySelector(selector))
      return Object.fromEntries(
        ['padding', 'gap', 'fontSize', 'fontWeight', 'borderRadius', 'backgroundColor', 'minHeight'].map((key) => [
          key,
          style[key],
        ]),
      )
    }),
  )
  assert.ok(
    styles.every((style) => JSON.stringify(style) === JSON.stringify(styles[0])),
    'rows share spacing, typography and surface',
  )
  assert.equal(styles[0].backgroundColor, 'rgba(0, 0, 0, 0)', 'on the transparent tool-row surface')
  await ramu.shot('chat')
  ramu.check(true, 'compact activity rows are consistent')
})

ramu.test(
  'an advisor turn keeps failed and unfinished tools visible and tucks routine ones into the summary',
  async () => {
    const { page } = ramu
    for (const toolUseId of ['routine-smoke', 'failed-smoke', 'unfinished-smoke'])
      await push({ kind: 'tool-use', toolUseId, name: 'Bash', summary: toolUseId })
    await push({ kind: 'tool-result', toolUseId: 'routine-smoke', isError: false, summary: 'Routine output retained' })
    await push({ kind: 'tool-result', toolUseId: 'failed-smoke', isError: true, summary: 'Failure details retained' })
    await push({ kind: 'text', text: 'Final answer stays visible.' })
    await push({ kind: 'result', isError: false, text: 'done' })
    const failed = page.locator('.transcript [data-tool-use-id="failed-smoke"]')
    await failed.locator('[data-slot="collapsible-trigger"]').waitFor({ state: 'visible' })
    assert.equal(await failed.locator('.tool-state').textContent(), 'Failed')
    await failed.locator('[data-slot="collapsible-trigger"]').click()
    assert.ok(await failed.getByText('Failure details retained', { exact: true }).isVisible())
    assert.ok(await page.locator('.transcript [data-tool-use-id="unfinished-smoke"] .tool-state').isVisible())
    assert.ok(await page.getByText('Final answer stays visible.', { exact: true }).isVisible())
    await page.locator('.turn-summary-toggle').last().click()
    const routine = page.locator('.transcript [data-tool-use-id="routine-smoke"]')
    await routine.locator('[data-slot="collapsible-trigger"]').click()
    assert.ok(await routine.getByText('Routine output retained', { exact: true }).isVisible())
    ramu.check(true, 'failed and unfinished tools stay visible; routine calls are kept inside completed work')
  },
)

ramu.test('with the advisor off, chats do not get the tool', async () => {
  await ramu.api('settings.app.set', { ...saved, advisor: { ...saved.advisor, enabled: false } })
  const { session } = await startChat(ramu, { title: 'Advisor off', prompt: '[advisor] plan the change', state: null })
  await ramu.until(
    async () => ['idle', 'failed'].includes((await ramu.api('agent.get', session.id)).state),
    'the chat never settled',
  )
  assert.ok((await ramu.api('agent.events', session.id)).some((e) => e.kind === 'error' && /advisor/i.test(e.message)))
  ramu.noErrors()
})
