// Explorer and Monaco editor: preview tabs, unsaved buffers reaching the chat, saving, font smoothing, disk conflicts.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modifier, openSettings, palette, saveSettings, startRamu, useFakeModel } from '../support/index.mjs'

const ramu = await startRamu('editor', {
  repos: {
    demo: {
      'notes.md': 'Saved project notes\n',
      'other.ts': 'export const example = 1\n',
      'format-me.ts': 'const   x=1\ndebugger\n',
    },
  },
})
const { page, api, until, check } = ramu
const repo = ramu.repos.demo
const editorLines = page.locator('.monaco-editor:visible .view-lines')
const savedFileTab = async (path) =>
  Object.values((await api('ui.get')).tasks ?? {})
    .flatMap((state) => state.views ?? [])
    .find((view) => view.kind === 'file' && view.path === path)
const smoothing = () =>
  page.evaluate(() => ({
    root: getComputedStyle(document.documentElement).webkitFontSmoothing,
    editor: getComputedStyle(document.querySelector('.monaco-editor')).webkitFontSmoothing,
  }))
const smoothingIs = async (value) => Object.values(await smoothing()).every((actual) => actual === value)
const toggleCrisperText = async () => {
  await openSettings(ramu, 'Appearance')
  await page.getByRole('switch', { name: 'Crisper text' }).click()
  await saveSettings(ramu)
}

ramu.test('Explorer opens previews and the palette keeps them open', async () => {
  await useFakeModel(ramu)
  const { project } = await api('projects.addFolder', repo)
  await ramu.reload()
  await page.getByRole('button', { name: `Open ${project.name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /other.ts/ })
    .click()
  await until(async () => (await savedFileTab('other.ts'))?.preview === true, 'Explorer opens a file as a preview')
  check(true, 'Single-click in Explorer opens a preview tab')
  await palette(ramu, 'other.ts')
  await page
    .getByRole('dialog', { name: 'Command palette', exact: true })
    .getByRole('option', { name: 'other.ts', exact: true })
    .click()
  await until(async () => (await savedFileTab('other.ts'))?.preview === false, 'Palette promotes the preview')
  check(true, 'Command palette file selection promotes a preview to a kept-open tab')
})

ramu.test('unsaved editor buffers are sent with the thread without saving', async () => {
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /notes.md/ })
    .click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await editorLines.getByText('Saved project notes', { exact: true }).waitFor()
  await editorLines.first().click()
  await page.keyboard.press(`${modifier}+a`)
  await page.keyboard.insertText('Unsaved buffer context')
  await editorLines.getByText('Unsaved buffer context', { exact: true }).waitFor()
  await page.locator('[data-composer-input]:visible').first().fill('Summarize the open file')
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.locator('.agent-view:visible[data-state="idle"] .msg.assistant').last().waitFor()
  const [chat] = (await api('tasks.list')).filter((task) => task.projectId !== 'no-project')
  const [session] = await api('agent.list', chat.id)
  check(
    (await api('agent.events', session.id)).some((e) => e.kind === 'user' && e.text.includes('Unsaved buffer context')),
    'Open tabs send unsaved buffer content',
  )
  check(
    readFileSync(join(repo, 'notes.md'), 'utf8') === 'Saved project notes\n',
    'Sending context does not save or overwrite files',
  )
})

ramu.test('font smoothing applies to the interface and the editor', async () => {
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /format-me.ts/ })
    .click()
  await page.locator('.monaco-editor:visible textarea').waitFor()
  check((await api('settings.app.get')).fontSmoothing === true, 'Font smoothing is enabled by default')
  check(await smoothingIs('antialiased'), 'Interface and editor inherit grayscale font smoothing')
  await toggleCrisperText()
  check(await smoothingIs('auto'), 'Turning smoothing off restores platform rendering in the interface and editor')
  await toggleCrisperText()
  check(await smoothingIs('antialiased'), 'Font smoothing can be re-enabled')
})

ramu.test('editor settings are plain and saving preserves formatting', async () => {
  await openSettings(ramu, 'Editor & Terminal')
  check(
    (await page
      .getByRole('switch', { name: /Lint while editing|Format on save|Language servers|AI inline completion/ })
      .count()) === 0,
    'Editor settings contain no linter, formatter, language server or AI completion controls',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  await editorLines.first().click()
  await page.keyboard.press(`${modifier}+ArrowDown`)
  await page.keyboard.press('End')
  await page.keyboard.insertText('// keep   spacing')
  await page.keyboard.press(`${modifier}+s`)
  await until(
    () => readFileSync(join(repo, 'format-me.ts'), 'utf8').includes('// keep   spacing'),
    'Saving writes the edited buffer',
  )
  check(
    readFileSync(join(repo, 'format-me.ts'), 'utf8').startsWith('const   x=1\n'),
    'Saving preserves existing formatting exactly',
  )
  check((await page.locator('.ghost-text-decoration, .suggest-widget').count()) === 0, 'Editing has no completion UI')
})

ramu.test('find and disk conflicts', async () => {
  await page.keyboard.press(`${modifier}+f`)
  await page.locator('.monaco-editor:visible .find-widget.visible').waitFor()
  await page.keyboard.press('Escape')
  await editorLines.first().click()
  await page.keyboard.press(`${modifier}+ArrowDown`)
  await page.keyboard.insertText(' unsaved')
  writeFileSync(join(repo, 'format-me.ts'), 'const disk = 2\n')
  await page
    .locator('.banner.warn')
    .filter({ hasText: 'This file changed on disk while you have unsaved edits.' })
    .waitFor()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await page.locator('.monaco-diff-editor:visible').waitFor()
  check(
    (await page.locator('.monaco-diff-editor:visible .editor.original .view-lines').textContent()).includes('disk'),
    'Conflict comparison renders disk content',
  )
  check(
    await page.evaluate(() =>
      [...document.querySelectorAll('.monaco-diff-editor .monaco-editor')].every(
        (editor) => getComputedStyle(editor).webkitFontSmoothing === 'antialiased',
      ),
    ),
    'Diff editors inherit font smoothing',
  )
  await ramu.shot('editor-conflict')
  ramu.noErrors()
})
