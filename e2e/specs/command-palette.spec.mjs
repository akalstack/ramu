// Command palette navigation: global commands without a project, one command per settings section, and chat panel commands.
import assert from 'node:assert/strict'
import { fakeAgent, modifier, palette, showChat, showTask, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('command-palette', {
  repos: {
    demo: {
      'src/notes.ts': 'export const first = 1\nexport const second = 2\nexport const needle_alpha_marker = 3\n',
      'docs/other.md': '# Other\nA line with needle_bravo_marker inside it\n',
      'many.txt': Array.from({ length: 20 }, (_, i) => `repeat_token_line ${i}`).join('\n') + '\n',
    },
  },
})

/** Runs a command by its title through the palette. */
async function run(label) {
  const dialog = await palette(ramu, `>${label}`)
  await dialog.getByRole('option').filter({ hasText: label }).click()
  await dialog.waitFor({ state: 'detached' })
}

ramu.test('Show schedules and New schedule work without a project', async () => {
  const { page } = ramu
  await page.keyboard.press(`${modifier}+b`)
  await page.locator('.shell.no-sidebar').waitFor()
  await run('Show schedules')
  await page.locator('.shell:not(.no-sidebar)').waitFor()
  await page.locator('.automation-page').getByRole('heading', { name: 'Schedules', exact: true }).waitFor()
  await run('New schedule')
  await page.locator('.schedule-editor').waitFor()
  await page.getByRole('button', { name: 'Close schedule editor', exact: true }).click()
  await run('Show home')
  await page.getByRole('heading', { name: 'What should we work on?', exact: true }).waitFor()
  await run('New schedule')
  await page.locator('.schedule-editor').waitFor()
  assert.equal((await ramu.api('schedules.list')).length, 0, 'opening the editor schedules nothing')
})

ramu.test('every settings section has a palette command', async () => {
  const { page } = ramu
  const sections = [
    'Appearance',
    'Editor & Terminal',
    'Git',
    'Keyboard shortcuts',
    'Chats',
    'Providers & models',
    'Access & Fallback',
    'Goals & delegation',
    'Memory & skills',
    'Background & updates',
    'Remote access',
  ]
  for (const section of sections) {
    await run(`Open ${section} settings`)
    await page.locator('.settings-page-content').getByRole('heading', { name: section, exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.settings-page').waitFor({ state: 'detached' })
  }
  await run('Model sets and reasoning defaults')
  await page.locator('.settings-page-content').getByRole('heading', { name: 'Model sets', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
})

ramu.test('commands only appear when they apply', async () => {
  const { page } = ramu
  const add = await palette(ramu, '>Add project')
  assert.equal(await add.getByRole('option').filter({ hasText: 'Add project…' }).count(), 1)
  await page.keyboard.press('Escape')
  const aside = await palette(ramu, '>Toggle aside')
  assert.equal(
    await aside.getByRole('option').filter({ hasText: 'Toggle aside' }).count(),
    0,
    'chat commands need a visible chat',
  )
  await page.keyboard.press('Escape')
})

ramu.test('chat panel commands open Agents and Aside, and Aside keeps its shortcut', async () => {
  const { page } = ramu
  const prefs = await ramu.api('settings.app.get')
  await ramu.api('settings.app.set', {
    ...prefs,
    advisor: {
      enabled: true,
      wait: true,
      step: { id: 'advisor', provider: 'codex', model: 'fake-codex', effort: 'high' },
    },
  })
  const chat = await startChat(ramu, {
    title: 'Palette chat',
    prompt: '[advisor] Say hello',
    settings: fakeAgent.claude,
    state: null,
  })
  await showChat(ramu, chat)
  await page.locator('.agents-chip[aria-pressed]:visible').waitFor()
  await run('Show agents')
  await page.locator('.agent-panel .agent-task-card').filter({ hasText: 'Advisor' }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.agent-panel').waitFor({ state: 'detached' })
  await run('Toggle aside')
  await page.locator('.aside-panel').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.aside-panel').waitFor({ state: 'detached' })
  await page.keyboard.press(`${modifier}+Shift+a`)
  await page.locator('.aside-panel').waitFor()
  await page.keyboard.press('Escape')
  ramu.noErrors()
})

const options = (dialog) => dialog.getByRole('option')
const contentHeader = (dialog) => dialog.getByText('Text in files', { exact: true })

ramu.test('searching inside files shows path:line and a snippet, and Enter opens the file at that line', async () => {
  const { page } = ramu
  const { project } = await ramu.api('projects.addFolder', ramu.repos.demo)
  const task = await ramu.api('tasks.create', { projectId: project.id, title: 'Palette content', mode: 'current' })
  await ramu.api('tasks.setup', task.id)
  await showTask(ramu, task, { views: [], activeViewId: null })

  // Without a prefix the content source waits for three characters; with # two are enough.
  const dialog = await palette(ramu, 'ne')
  await ramu.sleep(600)
  assert.equal(await contentHeader(dialog).count(), 0, 'two characters do not search file contents')
  await dialog.locator('[data-slot=command-input]').fill('needle_alpha')
  await contentHeader(dialog).waitFor()
  const hit = options(dialog).filter({ hasText: 'needle_alpha_marker' })
  await hit.waitFor()
  assert.equal(await hit.count(), 1)
  assert.match(await hit.textContent(), /src\/notes\.ts:3/, 'the row shows path:line')
  assert.equal(await hit.locator('mark').textContent(), 'needle_alpha', 'the match is highlighted in its snippet')
  await dialog.locator('[data-slot=command-input]').fill('#needle_alpha')
  await hit.waitFor()
  await page.keyboard.press('Enter')
  await dialog.waitFor({ state: 'detached' })
  await page.locator('.view-tab.active', { hasText: 'notes.ts' }).waitFor()
  const cursorLine = () =>
    page.evaluate(() => {
      const current = document.querySelector('.monaco-editor .current-line')?.getBoundingClientRect()
      if (!current) return null
      const line = [...document.querySelectorAll('.monaco-editor .view-line')].find(
        (el) => Math.abs(el.getBoundingClientRect().top - current.top) < 2,
      )
      return line?.textContent ?? null
    })
  await ramu.until(async () => (await cursorLine())?.includes('needle_alpha_marker'), 'the cursor never reached line 3')
  ramu.noErrors()
})

ramu.test('a result group shows its first rows, then the rest on Show more', async () => {
  const dialog = await palette(ramu, '#repeat_token_line')
  await contentHeader(dialog).waitFor()
  await options(dialog).filter({ hasText: 'many.txt:1' }).waitFor()
  const rows = options(dialog).filter({ hasText: 'repeat_token_line' })
  assert.equal(await rows.count(), 8, 'the first eight matches show')
  await options(dialog).filter({ hasText: 'Show 12 more' }).click()
  await ramu.until(async () => (await rows.count()) === 20, 'Show more did not reveal every match')
  await ramu.page.keyboard.press('Escape')
})

ramu.test('rapid typing never leaves results for an older query on screen', async () => {
  const { page } = ramu
  const dialog = await palette(ramu)
  const input = dialog.locator('[data-slot=command-input]')
  const alpha = options(dialog).filter({ hasText: 'needle_alpha_marker' })
  const bravo = options(dialog).filter({ hasText: 'needle_bravo_marker' })
  await input.fill('#needle_alpha')
  await alpha.waitFor()
  // Replace the settled query at once, and again after the debounce so the old request is already in flight.
  await input.fill('#needle_bra')
  await input.fill('#needle_alp')
  await ramu.sleep(300)
  await input.fill('#needle_bravo')
  await bravo.waitFor()
  await ramu.sleep(800)
  assert.equal(await alpha.count(), 0, 'a result for the older query is still listed')
  assert.equal(await bravo.count(), 1)
  assert.match(await bravo.textContent(), /docs\/other\.md:2/)
  // Typing past the content source's minimum and clearing the input drops its group entirely.
  await input.fill('')
  await contentHeader(dialog).waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
  ramu.noErrors()
})
