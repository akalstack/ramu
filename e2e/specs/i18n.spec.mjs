// Language switching: Cancel, Indonesian UI and native menu, settings search, persistence, editor buffers and Follow system.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { modifier, startRamu } from '../support/index.mjs'

const ramu = await startRamu('i18n', { repos: { 'Language Smoke': { 'notes.txt': 'Original file content\n' } } })
const language = () => ramu.page.locator('html').getAttribute('lang')
const open = async () => {
  await ramu.page.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await ramu.page.locator('.settings-page').waitFor()
}
const selectLanguage = async (value) => {
  await ramu.page.getByRole('combobox', { name: /^(App language|Bahasa aplikasi)$/ }).click()
  await ramu.page.getByRole('option', { name: value, exact: true }).click()
}
// saveSettings waits for the English "Settings saved" text, so Indonesian saves wait on the stored value instead.
const save = async (expected) => {
  await ramu.page.getByRole('button', { name: /^(Save changes|Simpan perubahan)$/ }).click()
  await ramu.until(
    async () => (await ramu.api('settings.app.get')).language === expected,
    `language ${expected} was not saved`,
  )
  // Escape is ignored while the save runs, so keep pressing it until the dialog closes.
  await ramu.until(async () => {
    await ramu.page.keyboard.press('Escape')
    return (await ramu.page.locator('.settings-page').count()) === 0
  }, 'Settings did not close after saving')
}

ramu.test('Cancel leaves the saved language unchanged', async () => {
  const { page } = ramu
  await ramu.api('settings.app.set', { ...(await ramu.api('settings.app.get')), language: 'en', recapsEnabled: false })
  await ramu.reload()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('heading', { name: 'What should we work on?', exact: true }).waitFor()
  await page.locator('[data-composer-input]').first().fill('Draft stays exactly as written: {project} $repo')
  await open()
  await selectLanguage('Bahasa Indonesia')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await language(), 'en')
  assert.equal((await ramu.api('settings.app.get')).language, 'en')
})

ramu.test('Indonesian updates the UI and native menu without losing the draft', async () => {
  const { page, app } = ramu
  await open()
  await selectLanguage('Bahasa Indonesia')
  await save('id')
  await page.getByRole('heading', { name: 'Mau kerjain apa hari ini?', exact: true }).waitFor()
  assert.equal(await language(), 'id')
  assert.equal(
    await page.locator('[data-composer-input]').first().getAttribute('data-draft'),
    'Draft stays exactly as written: {project} $repo',
  )
  await page.getByRole('button', { name: 'Mulai obrolan', exact: true }).waitFor()
  assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.at(-1).label), 'Jendela')
  const roles = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((item) => item.role?.toLowerCase() === 'editmenu')
      .submenu.items.map((item) => item.role?.toLowerCase()),
  )
  for (const role of ['copy', 'paste', 'selectall']) assert.ok(roles.includes(role), `Edit menu keeps ${role}`)
  if (process.platform === 'darwin') assert.ok(roles.includes('pasteandmatchstyle'))
  await ramu.shot('home-indonesian')
})

ramu.test(
  'Settings stays usable in Indonesian: small windows do not overflow and search finds translated labels',
  async () => {
    const { page, app } = ramu
    const resize = (width, height) =>
      app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height])
    await open()
    assert.equal(
      await page.getByRole('combobox', { name: 'Bahasa aplikasi', exact: true }).innerText(),
      'Bahasa Indonesia',
    )
    await ramu.shot('settings-indonesian')
    await resize(900, 700)
    await ramu.shot('settings-indonesian-small')
    assert.ok(
      await page.locator('.settings-page-content').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'no horizontal overflow',
    )
    await resize(1440, 900)
    await page.getByRole('textbox', { name: 'Cari pengaturan', exact: true }).fill('Bahasa')
    await page.locator('.settings-result').filter({ hasText: 'Bahasa' }).first().click()
    await page.getByRole('combobox', { name: 'Bahasa aplikasi', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Batal', exact: true }).click()
  },
)

ramu.test('the language persists across an app restart', async () => {
  await ramu.relaunch()
  await ramu.page.emulateMedia({ reducedMotion: 'reduce' })
  await ramu.page.getByRole('heading', { name: 'Mau kerjain apa hari ini?', exact: true }).waitFor()
  assert.equal((await ramu.api('settings.app.get')).language, 'id')
})

ramu.test('switching language preserves unsaved editor buffers and project names', async () => {
  const { page } = ramu
  const repo = ramu.repos['Language Smoke']
  const { project } = await ramu.api('projects.addFolder', repo)
  await ramu.reload()
  await page.getByRole('button', { name: `Buka ${project.name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /notes.txt/ })
    .click()
  const editor = page.locator('.monaco-editor .view-lines').first()
  await editor.getByText('Original file content', { exact: true }).waitFor()
  await editor.click()
  await page.keyboard.press(`${modifier}+a`)
  await page.keyboard.insertText('Unsaved editor buffer stays intact')
  await editor.getByText('Unsaved editor buffer stays intact', { exact: true }).waitFor()
  await open()
  await selectLanguage('English')
  await save('en')
  await page.getByRole('button', { name: 'Explorer', exact: true }).waitFor()
  await editor.getByText('Unsaved editor buffer stays intact', { exact: true }).waitFor()
  assert.equal(readFileSync(join(repo, 'notes.txt'), 'utf8'), 'Original file content\n')
  assert.equal(await language(), 'en')
})

ramu.test('Follow system uses the OS language, and an explicit choice overrides it', async () => {
  const { page, app } = ramu
  await app.evaluate(({ app }) => {
    app.getPreferredSystemLanguages = () => ['id-ID', 'en-US']
  })
  await open()
  await selectLanguage('Follow system')
  await save('system')
  await page.getByRole('button', { name: 'Explorer', exact: true }).waitFor()
  assert.equal(await language(), 'id')
  await open()
  await selectLanguage('English')
  await save('en')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  assert.equal(await language(), 'en')
  ramu.noErrors()
})
