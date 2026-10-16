// UI flows that several specs share. Each takes the handle from `startRamu`.
import { modifier } from './app.mjs'

/** Agent settings for the simulated providers (`RAMU_FAKE_AGENT`). */
export const fakeAgent = {
  claude: { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false },
  codex: {
    provider: 'codex',
    model: 'fake-codex',
    effort: null,
    serviceTier: 'standard',
    access: 'full',
    autoFallback: false,
  },
}

/** Starts a simulated chat in a new task and waits for it to go idle (or `state`). */
export async function startChat(
  ramu,
  { projectId = 'no-project', title, prompt, settings = fakeAgent.claude, state = 'idle' },
) {
  const task = await ramu.api('tasks.create', { projectId, title, mode: 'current' })
  const session = await ramu.api('agent.start', task.id, prompt, settings)
  if (state)
    await ramu.until(
      async () => (await ramu.api('agent.get', session.id)).state === state,
      `chat "${title}" never became ${state}`,
    )
  return { task, session }
}

/** Opens `task` in the workspace with the given saved view state, then selects it in the sidebar. */
export async function showTask(ramu, task, taskState = {}, workspaceState = {}) {
  const ui = await ramu.api('ui.get')
  await ramu.api('ui.setTask', task.id, taskState)
  await ramu.api('ui.setWorkspace', {
    ...ui.workspace,
    openTaskIds: [...new Set([...ui.workspace.openTaskIds, task.id])],
    activeTaskId: task.id,
    ...workspaceState,
  })
  await ramu.reload()
  await ramu.page
    .locator('.task-row')
    .filter({ has: ramu.page.getByText(task.title, { exact: true }) })
    .click()
}

/** Shows a chat session as the task's only view. */
export const showChat = (ramu, { task, session }, workspaceState) => {
  const id = `chat-${session.id}`
  return showTask(
    ramu,
    task,
    { views: [{ id, kind: 'agent', sessionId: session.id }], activeViewId: id, activeAgentViewId: id },
    workspaceState,
  )
}

/** Opens Settings, optionally on a tab ("Goals & delegation", "Providers & models", "Background & updates", ...). */
export async function openSettings(ramu, tab) {
  await ramu.page.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await ramu.page.locator('.settings-page').waitFor()
  if (tab) await ramu.page.getByRole('button', { name: tab, exact: true }).click()
}

/** Saves the open Settings dialog and closes it. Saving keeps the dialog open and Escape is ignored while a save runs. */
export async function saveSettings(ramu) {
  await ramu.page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await ramu.page.getByText(/Settings saved on/).waitFor()
  // Escape is dropped while the save is still settling, so press it again until the dialog is gone.
  await ramu.until(
    async () => {
      if ((await ramu.page.locator('.settings-page').count()) === 0) return true
      await ramu.page.keyboard.press('Escape')
      await ramu.sleep(300)
      return false
    },
    'the Settings dialog never closed',
    { attempts: 50, interval: 200 },
  )
}

/** Opens the command palette; prefix the query with `>` to search commands instead of files. */
export async function palette(ramu, query = '') {
  await ramu.page.keyboard.press(`${modifier}+Shift+p`)
  const dialog = ramu.page.getByRole('dialog', { name: 'Command palette', exact: true })
  await dialog.waitFor()
  if (query) await dialog.locator('[data-slot=command-input]').fill(query)
  return dialog
}

/** Selects an option from a Radix combobox by its accessible name. */
export async function select(ramu, name, option) {
  await ramu.page.getByRole('combobox', { name, exact: true }).click()
  await ramu.page.getByRole('option', { name: option, exact: true }).click()
}

/** Makes the simulated Claude the default model, so Home can start chats without a signed-in provider. */
export const useFakeModel = (ramu) =>
  ramu.api('settings.models.set', {
    sets: [{ id: 'fake', name: 'Fake', steps: [{ id: 'fake', name: 'Fake Claude', ...fakeAgent.claude }] }],
    defaultSetId: 'fake',
    defaultStepId: 'fake',
    defaultBarMode: 'model',
  })
