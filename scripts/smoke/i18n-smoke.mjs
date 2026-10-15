// Language switching and persistence against an isolated Electron profile. No model calls.
// Run after pnpm build: node scripts/smoke/i18n-smoke.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'

const appDir = resolve(import.meta.dirname, '..', '..', 'apps', 'desktop')
const dir = mkdtempSync(join(tmpdir(), 'ramu-language-'))
const profile = join(dir, 'profile'),
  repo = join(dir, 'Language Smoke')
const shots = join(appDir, 'output', 'playwright', 'languages')
mkdirSync(shots, { recursive: true })
mkdirSync(repo)
execFileSync('git', ['init', '-q'], { cwd: repo })
writeFileSync(join(repo, 'notes.md'), 'Original file content\n')
const env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
let app, page
const errors = []
const log = (message) => console.log(`ok - ${message}`)
const invoke = (method, ...args) =>
  page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const launch = async () => {
  app = await electron.launch({ args: [appDir], cwd: appDir, env, timeout: 30_000 })
  page = await app.firstWindow()
  page.on('pageerror', (e) => {
    if (!/^(Canceled|Make sure the ref is set)/.test(e.message)) errors.push(e.message)
  })
  await page.waitForSelector('.shell', { timeout: 20_000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
}
const settings = async () => {
  await page.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await page.locator('.settings-page').waitFor()
}
const selectLanguage = async (value) => {
  await page.getByRole('combobox', { name: /^(App language|Bahasa aplikasi)$/ }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}
const save = async () => {
  await page.getByRole('button', { name: /^(Save changes|Simpan perubahan)$/ }).click()
  // Saving keeps the settings dialog open; Escape closes it.
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
}
const language = () => page.locator('html').getAttribute('lang')
try {
  await launch()
  // Start predictably even if the test machine itself uses Indonesian.
  await invoke('settings.app.set', { ...(await invoke('settings.app.get')), language: 'en', recapsEnabled: false })
  await page.reload()
  await page.waitForSelector('.shell')
  await page.getByRole('heading', { name: 'What should we work on?', exact: true }).waitFor()
  const draft = page.locator('[data-composer-input]').first()
  await draft.fill('Draft stays exactly as written: {project} $repo')
  await settings()
  await selectLanguage('Bahasa Indonesia')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await language(), 'en')
  assert.equal((await invoke('settings.app.get')).language, 'en')
  log('Cancel leaves the saved language unchanged')
  await settings()
  await selectLanguage('Bahasa Indonesia')
  await save()
  await page.getByRole('heading', { name: 'Mau kerjain apa hari ini?', exact: true }).waitFor()
  assert.equal(await language(), 'id')
  assert.equal(await draft.getAttribute('data-draft'), 'Draft stays exactly as written: {project} $repo')
  assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.at(-1).label), 'Jendela')
  const editingRoles = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((item) => item.role?.toLowerCase() === 'editmenu')
      .submenu.items.map((item) => item.role?.toLowerCase()),
  )
  assert.ok(editingRoles.includes('copy') && editingRoles.includes('paste') && editingRoles.includes('selectall'))
  if (process.platform === 'darwin') assert.ok(editingRoles.includes('pasteandmatchstyle'))
  await page.getByRole('button', { name: 'Mulai obrolan', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(shots, 'home-indonesian.png') })
  log('Indonesian updates the UI and native menu without losing the draft')
  await settings()
  await page.getByRole('combobox', { name: 'Bahasa aplikasi', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('combobox', { name: 'Bahasa aplikasi', exact: true }).innerText(),
    'Bahasa Indonesia',
  )
  await page.screenshot({ animations: 'disabled', path: join(shots, 'settings-indonesian.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await page.screenshot({ animations: 'disabled', path: join(shots, 'settings-indonesian-small.png') })
  assert.equal(
    await page.locator('.settings-page-content').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.getByRole('textbox', { name: 'Cari pengaturan', exact: true }).fill('Bahasa')
  await page.locator('.settings-result').filter({ hasText: 'Bahasa' }).first().click()
  await page.getByRole('combobox', { name: 'Bahasa aplikasi', exact: true }).waitFor()
  log('Settings search finds Indonesian labels')
  await page.getByRole('button', { name: 'Batal', exact: true }).click()
  await app.close()
  await launch()
  await page.getByRole('heading', { name: 'Mau kerjain apa hari ini?', exact: true }).waitFor()
  assert.equal((await invoke('settings.app.get')).language, 'id')
  log('Language persists across an app restart')
  const { project } = await invoke('projects.addFolder', repo)
  await page.reload()
  await page.waitForSelector('.shell')
  await page.getByRole('button', { name: `Buka ${project.name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /notes.md/ })
    .click()
  const editor = page.locator('.monaco-editor .view-lines').first()
  await editor.getByText('Original file content', { exact: true }).waitFor()
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await page.keyboard.insertText('Unsaved editor buffer stays intact')
  await editor.getByText('Unsaved editor buffer stays intact', { exact: true }).waitFor()
  await settings()
  await selectLanguage('English')
  await save()
  await page.getByRole('button', { name: 'Explorer', exact: true }).waitFor()
  await editor.getByText('Unsaved editor buffer stays intact', { exact: true }).waitFor()
  assert.equal(readFileSync(join(repo, 'notes.md'), 'utf8'), 'Original file content\n')
  assert.equal(await language(), 'en')
  log('Switching language preserves unsaved editor buffers and user project names')
  // Exercise actual native OS-language plumbing without changing the user's OS settings.
  await app.evaluate(({ app }) => {
    app.getPreferredSystemLanguages = () => ['id-ID', 'en-US']
  })
  await settings()
  await selectLanguage('Follow system')
  await save()
  await page.getByRole('button', { name: 'Explorer', exact: true }).waitFor()
  assert.equal(await language(), 'id')
  assert.equal((await invoke('settings.app.get')).language, 'system')
  log('Follow system resolves the OS language through Electron')
  await settings()
  await selectLanguage('English')
  await save()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('button', { name: 'Explorer', exact: true }).waitFor()
  assert.equal(await language(), 'en')
  log('An explicit English override wins over an Indonesian OS')
  assert.deepEqual(errors, [])
  log('No renderer errors')
  console.log(`Screenshots: ${shots}`)
} catch (error) {
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  console.error(
    await page
      ?.locator('body')
      .innerText()
      .catch(() => 'No renderer'),
  )
  throw error
} finally {
  await invoke('background.stop').catch(() => {})
  // The intentionally unsaved editor can prevent a graceful quit. This is a disposable profile.
  app?.process()?.kill('SIGTERM')
  await app?.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}
