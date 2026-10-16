// Starting chats from Home: native identity, composer menus, skills and file mentions, project-free and project chats.
import assert from 'node:assert/strict'
import { palette, showChat, startChat, startRamu, useFakeModel } from '../support/index.mjs'

const ramu = await startRamu('chat', {
  repos: {
    demo: {
      'notes.md': 'Saved project notes\n',
      'other.ts': 'export const example = 1\n',
      '.agents/skills/smoke-skill/SKILL.md':
        '---\nname: smoke-skill\ndescription: Review the smoke fixture notes\n---\nRead notes.md and summarize it.\n',
    },
  },
})
const { page, api, check } = ramu

ramu.test('the native app identity is Ramu', async () => {
  check((await ramu.app.evaluate(({ app }) => app.getName())) === 'Ramu', 'Native app identity is Ramu')
  if (process.platform === 'darwin')
    check(
      (await ramu.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items[0]?.label)) === 'Ramu',
      'macOS app menu is Ramu',
    )
})

ramu.test('Home is the startup page and honors reduced motion', async () => {
  await useFakeModel(ramu)
  await ramu.reload()
  check(
    await page.getByRole('heading', { name: 'What should we work on?' }).isVisible(),
    'The Threads home page is the startup page',
  )
  const dialog = await palette(ramu)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  check(
    (await dialog.evaluate((el) => getComputedStyle(el).animationName)) === 'none',
    'Reduced motion disables dialog animation',
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.keyboard.press('Escape')
  await ramu.shot('home')
})

ramu.test('composer menus select on click and open on slash', async () => {
  const access = page.getByRole('button', { name: 'Access mode', exact: true }).first()
  await access.click()
  const choices = page.getByRole('menuitemradio')
  await choices.first().waitFor()
  const total = await choices.count()
  let original = 0
  for (let i = 0; i < total; i++) if ((await choices.nth(i).getAttribute('aria-checked')) === 'true') original = i
  const index = original === 0 ? 1 : 0
  await choices.nth(index).click()
  await choices.first().waitFor({ state: 'detached' })
  await access.click()
  check((await choices.nth(index).getAttribute('aria-checked')) === 'true', 'Dropdown menu items select on click')
  await choices.nth(original).click()
  await choices.first().waitFor({ state: 'detached' })
  const composer = page.locator('[data-composer-input]:visible').first()
  await composer.fill('/')
  await composer.press('End')
  await page.getByRole('option', { name: /\/schedule.*Create a schedule/ }).waitFor()
  check(await page.getByRole('listbox').isVisible(), 'Slash opens a command dropdown')
  await composer.press('Escape')
})

ramu.test('a thread starts without any project', async () => {
  await page.locator('[data-composer-input]:visible').first().fill('Hello without a project')
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.locator('.agent-view:visible[data-state="idle"] .msg.assistant').last().waitFor({ timeout: 10_000 })
  const general = (await api('tasks.list')).find((task) => task.projectId === 'no-project')
  check(general, 'Project-free thread starts without any repository')
  check(
    (await page.locator('.agent-view:visible .msg.assistant').count()) === 1,
    'Live and stored transcript events do not duplicate',
  )
  check(
    (await api('agent.scope', general.id)).cwd.includes('chats'),
    'Project-free thread has a dedicated working directory',
  )
})

ramu.test('a project thread offers skills and file mentions', async () => {
  const { project } = await api('projects.addFolder', ramu.repos.demo)
  await ramu.reload()
  const home = page.getByRole('button', { name: 'Home', exact: true })
  if ((await home.getAttribute('aria-pressed')) !== 'true') await home.click()
  await page.getByRole('button', { name: `Open ${project.name}`, exact: true }).click()
  const prompt = page.locator('[data-composer-input]:visible').first()
  await prompt.fill('/smoke')
  await page.getByRole('option', { name: /smoke-skill/ }).waitFor()
  await ramu.shot('skills')
  await prompt.press('Enter')
  check((await prompt.getAttribute('data-draft')).includes('$smoke-skill'), 'Skill selection inserts a skill reference')
  await prompt.fill('@other')
  await page.getByRole('option', { name: /other.ts/ }).waitFor()
  await prompt.press('Enter')
  check(
    (await prompt.getAttribute('data-draft')).includes('other.ts'),
    'File mention selection inserts a file reference',
  )
  await prompt.fill('Summarize the project')
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.locator('.agent-view:visible[data-state="idle"] .msg.assistant').last().waitFor()
  check(
    (await api('tasks.list')).some((task) => task.projectId === project.id),
    'The thread belongs to the project',
  )
  ramu.noErrors()
})

ramu.test(
  'mixed command progress settles from Running to Ran, and thread search steps through the matches',
  async () => {
    const chat = await startChat(ramu, { title: 'Tool progress', prompt: '[tool progress]', state: null })
    await showChat(ramu, chat)
    const group = (label) =>
      page.locator('.tool-group').filter({ has: page.locator('.tool-group-label', { hasText: label }) })
    const running = group('Running 3 commands')
    await running.waitFor()
    // Groups start collapsed, so open this one to read its commands.
    if ((await running.getAttribute('data-open')) === null)
      await running.locator('[data-slot=collapsible-trigger]').first().click()
    await ramu.until(
      async () =>
        (await running.locator('.tool-summary').allTextContents()).filter((t) => t.startsWith('Ran ')).length === 2,
      'two of the three commands never completed',
    )
    assert.deepEqual(await running.locator('.tool-summary').allTextContents(), [
      'Ran echo command-1',
      'Ran echo command-2',
      'Running echo command-3',
    ])
    await ramu.shot('tool-progress-running')
    await ramu.until(
      async () => (await api('agent.events', chat.session.id)).some((event) => event.kind === 'result'),
      'the turn never finished',
    )
    await page.getByRole('button', { name: /Worked for/ }).click()
    const completed = group('Ran 3 commands')
    await completed.waitFor()
    if ((await completed.getAttribute('data-open')) === null)
      await completed.locator('[data-slot=collapsible-trigger]').first().click()
    assert.deepEqual(await completed.locator('.tool-summary').allTextContents(), [
      'Ran echo command-1',
      'Ran echo command-2',
      'Ran echo command-3',
    ])

    const open = page.locator('.agent-header').getByRole('button', { name: 'Find in conversation', exact: true })
    assert.ok(await open.isVisible(), 'the thread header offers search')
    assert.equal(
      await page.locator('.task-header').getByRole('button', { name: 'Find in conversation', exact: true }).count(),
      0,
      'the task header does not',
    )
    await open.click()
    const find = page.getByRole('textbox', { name: 'Find in conversation', exact: true })
    await find.fill('command-')
    await page.locator('.chat-find-count', { hasText: '1 of 3' }).waitFor()
    const findBox = await page.locator('.chat-find-bar').boundingBox()
    const chatBox = await page.locator('.main-chat').boundingBox()
    assert.ok(findBox.width <= 420 && findBox.width < chatBox.width / 2, 'the find panel stays compact')
    await find.press('Enter')
    await page.locator('.chat-find-count', { hasText: '2 of 3' }).waitFor()
    await find.press('Escape')
    await page.locator('.chat-find-bar').waitFor({ state: 'detached' })
    assert.ok(
      await page.locator('[data-composer-input]:visible').evaluate((el) => el === document.activeElement),
      'closing the find panel returns focus to the composer',
    )
    ramu.noErrors()
  },
)
