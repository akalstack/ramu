// What an agent shows and asks mid-run: live tool output, injected tools, connector forms, and asynchronous questions.
import { fakeAgent, showChat, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('agent-input')
const { page, api, until, check } = ramu
const providers = [
  ['claude-code', fakeAgent.claude],
  ['codex', fakeAgent.codex],
]
const events = (session) => api('agent.events', session.id)
const has = async (session, predicate) => (await events(session)).some(predicate)
const state = async (session) => (await api('agent.get', session.id)).state

ramu.test('live command output stays running until the command completes', async () => {
  const chat = await startChat(ramu, {
    title: 'Codex live tool output',
    prompt: '[live codex tools]',
    settings: { ...fakeAgent.codex, access: 'edits' },
    state: 'needs-input',
  })
  await showChat(ramu, chat)
  const view = page.locator('.agent-view:visible')
  await view.getByRole('button', { name: 'Running pwd', exact: true }).click()
  await view.getByText(/First output line\nSecond output line/).waitFor()
  check((await view.locator('.tool-icon.running').count()) > 0, 'Live command output keeps the tool running')
  await view.getByRole('button', { name: 'Changes in this turn', exact: true }).click()
  await view.getByText(/--- a\/app.ts/).waitFor()
  check(
    (await view.getByText('Old provisional patch', { exact: true }).count()) === 0,
    'Live turn diff replaces the earlier snapshot',
  )
  await ramu.shot('codex-live-tools')
  await api('agent.replyPermission', chat.session.id, 'fake-codex-permission', true)
  await until(async () => (await state(chat.session)) === 'idle', 'live tool fixture to finish')
  check(
    (await events(chat.session)).filter((e) => e.kind === 'tool-result').length === 1,
    'Completed tool output replaces the streamed result',
  )
  await until(async () => (await view.locator('.tool-icon.running').count()) === 0, 'running indicator to clear')
})

ramu.test('both providers create scoped schedules through injected tools', async () => {
  for (const [provider, settings] of providers) {
    const { task, session } = await startChat(ramu, {
      title: `${provider} tools`,
      prompt: '[schedule tool]',
      settings,
      state: null,
    })
    await until(() => has(session, (e) => e.kind === 'schedule'), 'schedule tool result')
    check(
      (await api('schedules.list')).some((s) => s.sourceTaskId === task.id && s.projectId === 'no-project'),
      `${provider} creates a scoped schedule`,
    )
  }
})

ramu.test('connector forms keep drafts, validate, and return typed values', async () => {
  const chat = await startChat(ramu, {
    title: 'Connector input',
    prompt: '[mcp form]',
    settings: fakeAgent.codex,
    state: null,
  })
  await until(() => has(chat.session, (e) => e.kind === 'elicitation'), 'connector form')
  await showChat(ramu, chat)
  let form = page.locator('.elicitation-card:visible')
  await form.getByLabel('Answer: Worker count', { exact: true }).fill('2')
  await form.getByLabel('No', { exact: true }).check()
  await form.getByLabel('Jakarta', { exact: true }).check()
  const request = (await events(chat.session)).find((e) => e.kind === 'elicitation')
  await until(
    () =>
      has(
        chat.session,
        (e) => e.kind === 'question-state' && e.requestId === request.requestId && e.drafts.count === '2',
      ),
    'connector drafts saved',
  )
  await ramu.relaunch()
  await page
    .locator('.task-row')
    .filter({ has: page.getByText(chat.task.title, { exact: true }) })
    .click()
  form = page.locator('.elicitation-card:visible')
  await form.waitFor()
  check(
    (await form.getByLabel('Answer: Worker count', { exact: true }).inputValue()) === '2' &&
      (await form.getByLabel('No', { exact: true }).isChecked()),
    'Connector form drafts survive closing and reopening the app',
  )
  await form.getByLabel('Answer: Worker count', { exact: true }).fill('999')
  await form.getByRole('button', { name: 'Submit', exact: true }).click()
  await form.getByRole('alert').waitFor()
  check((await state(chat.session)) === 'needs-input', 'Invalid connector form keeps the request pending')
  await form.getByLabel('Answer: Worker count', { exact: true }).fill('2')
  await ramu.shot('connector-form')
  await form.getByRole('button', { name: 'Submit', exact: true }).click()
  await until(async () => (await state(chat.session)) === 'idle', 'connector input to release the turn')
  check(
    await has(
      chat.session,
      (e) =>
        e.kind === 'text' &&
        e.text.includes('"count":2') &&
        e.text.includes('"enabled":false') &&
        e.text.includes('"region":"id"'),
    ),
    'Connector form returns typed values and underlying option IDs',
  )
  await api('agent.submit', chat.session.id, '[mcp url]', 'queue')
  await until(() => has(chat.session, (e) => e.kind === 'elicitation' && e.mode === 'url'), 'connector link request')
  const link = page
    .locator('.elicitation-card:visible')
    .filter({ has: page.getByRole('link', { name: 'Open link', exact: true }) })
  await link.waitFor()
  check(
    (await link.getByRole('link', { name: 'Open link', exact: true }).getAttribute('href')) ===
      'https://example.com/connect',
    'Connector link requests offer an explicit browser link',
  )
  await link.getByRole('button', { name: 'Decline', exact: true }).click()
  await until(async () => (await state(chat.session)) === 'idle', 'declined request to release')
  check(
    await has(chat.session, (e) => e.kind === 'request-resolved' && e.outcome === 'declined'),
    'Declining a connector request sends no fabricated answers',
  )
})

const openQuestions = async (chat) => {
  await showChat(ramu, chat)
  await page.locator('.question-card:visible, .question-row:visible').first().waitFor()
}
const answerBoth = async (card) => {
  await card.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).fill('SQLite')
  await card.getByRole('button', { name: 'Next', exact: true }).click()
  await card.getByRole('textbox', { name: 'Answer: Which region?', exact: true }).fill('Jakarta')
  await card.getByRole('button', { name: 'Send answers together', exact: true }).click()
}

ramu.test('related questions are answered together after the run finished', async () => {
  for (const [provider, settings] of providers) {
    const chat = await startChat(ramu, {
      title: `${provider} related questions`,
      prompt: '[questions together]',
      settings,
    })
    const asked = (await events(chat.session)).find((e) => e.kind === 'question')
    check(asked?.responseMode === 'message', `${provider} finishes independent work with questions pending`)
    await openQuestions(chat)
    await page.getByRole('button', { name: 'Questions · 1', exact: true }).click()
    check(
      await page.getByLabel('Pending questions', { exact: true }).isVisible(),
      'Pending question list links to the group',
    )
    const card = page.locator('.question-dock .question-card:visible').first()
    check(
      (await page.locator('.question-row.pending:visible').count()) === 1,
      'The transcript keeps a row where the agent asked',
    )
    await card.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).fill('SQLite')
    await card.getByRole('button', { name: 'Next', exact: true }).click()
    check(
      await card.getByRole('button', { name: 'Send answers together', exact: true }).isDisabled(),
      'A related group requires all answers',
    )
    await until(
      () => has(chat.session, (e) => e.kind === 'question-state' && e.drafts?.database === 'SQLite'),
      'question draft saved',
    )
    await ramu.shot(`${provider}-questions`)
    const { pid } = await api('background.status')
    await ramu.relaunch(async () => {
      // The Claude run also survives a daemon crash.
      if (provider === 'claude-code') {
        process.kill(pid, 'SIGKILL')
        await ramu.sleep(300)
      }
    })
    await openQuestions(chat)
    check(
      (await page.locator('.question-card:visible').first().locator('.option.selected').innerText()).includes('SQLite'),
      provider === 'claude-code'
        ? 'Pending questions and drafts survive a daemon crash'
        : 'Question drafts survive reopening the app',
    )
    const restored = page.locator('.question-card:visible').first()
    await restored.getByRole('button', { name: 'Next', exact: true }).click()
    await restored.getByRole('textbox', { name: 'Answer: Which region?', exact: true }).fill('Jakarta')
    await restored.getByRole('button', { name: 'Send answers together', exact: true }).click()
    await until(
      () =>
        has(
          chat.session,
          (e) => e.kind === 'request-resolved' && e.requestId === asked.requestId && e.outcome === 'answered',
        ),
      'related reply to resolve',
    )
    await until(async () => {
      const list = await events(chat.session)
      return (
        list.some((e) => e.kind === 'user' && e.text.includes('SQLite') && e.text.includes('Jakarta')) &&
        list.filter((e) => e.kind === 'result').length >= 2 &&
        (await state(chat.session)) === 'idle'
      )
    }, 'late answers to finish a new turn')
    check(true, `${provider} receives the related answers together in the original chat`)
  }
})

ramu.test('independent questions can be answered one by one or dismissed', async () => {
  const chat = await startChat(ramu, { title: 'Independent questions', prompt: '[questions independent]' })
  await openQuestions(chat)
  const card = page.locator('.question-card:visible').first()
  await card.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).fill('SQLite')
  await card.getByRole('button', { name: 'Send answer', exact: true }).first().click()
  await until(
    () => has(chat.session, (e) => e.kind === 'question-state' && e.answers?.database === 'SQLite'),
    'independent reply saved',
  )
  // The dock moves on to the next open question once its send settles.
  await card.getByRole('textbox', { name: 'Answer: Which region?', exact: true }).waitFor()
  check(
    await card.getByRole('textbox', { name: 'Answer: Which region?', exact: true }).isEnabled(),
    'Independent questions stay answerable',
  )
  await card.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.locator('.question-row:visible').getByText('Dismissed', { exact: true }).waitFor()
})

ramu.test('obsolete questions keep their reason visible', async () => {
  const chat = await startChat(ramu, { title: 'Obsolete questions', prompt: '[questions obsolete]' })
  await openQuestions(chat)
  check(
    await page
      .locator('.question-row:visible')
      .getByText('No longer needed: The requested work no longer needs a database.', { exact: true })
      .isVisible(),
    'Obsolete questions show why they are no longer needed',
  )
})

ramu.test('with async questions off, the run blocks until the group is answered', async () => {
  const preferences = await api('settings.app.get')
  await api('settings.app.set', { ...preferences, asyncQuestions: false })
  try {
    const chat = await startChat(ramu, {
      title: 'Questions wait when disabled',
      prompt: '[questions together]',
      state: 'needs-input',
    })
    await openQuestions(chat)
    const card = page.locator('.question-card:visible').first()
    check(
      (await card.getByRole('button', { name: 'Dismiss', exact: true }).count()) === 0,
      'Blocking questions cannot be dismissed',
    )
    await answerBoth(card)
    await until(async () => (await state(chat.session)) === 'idle', 'blocking tool to continue')
  } finally {
    await api('settings.app.set', preferences)
  }
  ramu.noErrors()
})
