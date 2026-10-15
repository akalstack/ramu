import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modifier, startRamu, useFakeModel } from '../support/index.mjs'

const original =
  '# Project notes\n\nKeep **this formatting** intact.\n\n- [ ] First task\n\n| Name | State |\n| --- | --- |\n| Ramu | Ready |\n\n```ts\nconst value = 1\n```\n'
const ramu = await startRamu('markdown', {
  repos: {
    demo: {
      'notes.md': original,
      'alignment.md':
        '# Toolbar alignment\n\n' +
        Array.from(
          { length: 50 },
          (_, index) => `Paragraph ${index + 1} keeps the document scrolling beneath the toolbar.`,
        ).join('\n\n'),
      'windows.md': '# Windows notes\r\n\r\nOriginal line\r\n',
      'metadata.md':
        '---\ntitle: Keep metadata\ncustom: true\n---\n\n# Metadata document\n\n<div class="custom-content" data-value="keep">Embedded content</div>\n\n![Pixel](pixel.svg)\n\nLast paragraph\n',
      'pixel.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="purple"/></svg>',
    },
  },
})
const { page, api, check, until } = ramu
const file = join(ramu.repos.demo, 'notes.md')
const rich = page.getByRole('textbox', { name: 'Markdown editor', exact: true })

ramu.test('Markdown opens as one rendered editor and saves rich text as Markdown', async () => {
  await useFakeModel(ramu)
  const { project } = await api('projects.addFolder', ramu.repos.demo)
  await ramu.reload()
  await page.getByRole('button', { name: `Open ${project.name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /notes.md/ })
    .click()
  await rich.waitFor()
  await rich.getByRole('heading', { name: /Project notes/ }).click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('Added in rendered view.')
  await until(
    async () => (await rich.textContent()).includes('Added in rendered view.'),
    'Rendered editor accepts input',
  )
  check(readFileSync(file, 'utf8') === original, 'Typing keeps changes unsaved')
  await page.keyboard.press(`${modifier}+s`)
  await until(() => readFileSync(file, 'utf8').includes('Added in rendered view.'), 'Save writes rendered edits')
  const saved = readFileSync(file, 'utf8')
  check(
    saved.includes('**this formatting**') &&
      saved.includes('const value = 1') &&
      saved.includes('First task') &&
      saved.includes('Ready'),
    'Rich text saving retains formatting, lists, code, and table contents',
  )
  check(
    (await rich.getByRole('heading', { name: 'Project notes', exact: true }).textContent()) === 'Project notes',
    'Focused headings show formatted text without Markdown markers',
  )
  check((await page.locator('.monaco-editor:visible').count()) === 0, 'No source or split editor is visible')
})

ramu.test('undo and source mode share the rendered buffer; locked mode prevents edits', async () => {
  await rich.click()
  await page.keyboard.press(`${modifier}+z`)
  await until(
    async () => !(await rich.textContent()).includes('Added in rendered view.'),
    'Undo restores the previous buffer',
  )
  await page.keyboard.press(`${modifier}+Shift+z`)
  await until(
    async () => (await rich.textContent()).includes('Added in rendered view.'),
    'Redo restores the rendered edit',
  )
  await rich.getByRole('checkbox').check()
  await rich.getByRole('heading', { name: 'Project notes', exact: true }).click()
  await page.keyboard.press(`${modifier}+s`)
  await until(() => readFileSync(file, 'utf8').includes('- [x] First task'), 'Checkbox changes update Markdown source')
  await ramu.shot('rendered-editor')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page
    .locator('.monaco-editor:visible .view-lines')
    .getByText('Added in rendered view.', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Locked', exact: true }).click()
  await page.locator('.md-preview').getByRole('heading', { name: 'Project notes', exact: true }).waitFor()
  await ramu.shot('locked-reading')
  check((await rich.count()) === 0, 'Locked mode removes editable input')
  await page.locator('.md-preview').click()
  await page.keyboard.insertText('SHOULD NOT EDIT')
  await page.getByRole('button', { name: 'Editing', exact: true }).click()
  await rich.waitFor()
  check(!(await rich.textContent()).includes('SHOULD NOT EDIT'), 'Locked reading cannot change the buffer')
})

ramu.test('formatting toolbar edits rich text and serializes formatting as Markdown', async () => {
  await rich.getByRole('heading', { name: 'Project notes', exact: true }).click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.insertText('Toolbar formatted')
  await rich.locator('strong').filter({ hasText: 'Toolbar formatted' }).waitFor()
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.press(`${modifier}+s`)
  await until(() => readFileSync(file, 'utf8').includes('**Toolbar formatted**'), 'Bold toolbar saves a Markdown mark')
  check(!(await rich.textContent()).includes('**'), 'Formatting markers stay hidden while editing')
  await ramu.shot('rich-text-formatting')
})

ramu.test('rendered edits retain disk conflict protection', async () => {
  await rich.getByRole('heading', { name: /Project notes/ }).click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.insertText(' Unsaved change')
  writeFileSync(file, '# Disk replacement\n')
  await page
    .locator('.banner.warn')
    .filter({ hasText: 'This file changed on disk while you have unsaved edits.' })
    .waitFor()
  await page.getByRole('button', { name: 'Use disk version', exact: true }).click()
  await rich.getByRole('heading', { name: /Disk replacement/ }).waitFor()
  check(!(await rich.textContent()).includes('Unsaved change'), 'Disk version updates the rendered editor')
})

ramu.test('rendered editing preserves CRLF newlines across consecutive edits', async () => {
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /windows.md/ })
    .click()
  await rich.getByRole('heading', { name: /Windows notes/ }).click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('Added line')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('Following line')
  await page.keyboard.press(`${modifier}+s`)
  const windows = join(ramu.repos.demo, 'windows.md')
  await until(() => readFileSync(windows, 'utf8').includes('Following line'), 'CRLF file saves consecutive edits')
  check(
    readFileSync(windows, 'utf8').includes('Added line') && !/(?<!\r)\n/.test(readFileSync(windows, 'utf8')),
    'All existing and inserted newlines retain CRLF',
  )
})

ramu.test('rich text retains frontmatter, embedded HTML, and local image paths', async () => {
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /metadata.md/ })
    .click()
  await rich.getByRole('heading', { name: 'Metadata document', exact: true }).waitFor()
  await until(
    async () =>
      rich
        .getByRole('img', { name: 'Pixel', exact: true })
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    'Local image loads in the rich text editor',
  )
  await rich.getByRole('heading', { name: 'Metadata document', exact: true }).click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('New rich text')
  await page.keyboard.press(`${modifier}+s`)
  const metadata = join(ramu.repos.demo, 'metadata.md')
  await until(() => readFileSync(metadata, 'utf8').includes('New rich text'), 'Rich text document saves')
  const saved = readFileSync(metadata, 'utf8')
  check(saved.startsWith('---\ntitle: Keep metadata\ncustom: true\n---\n'), 'Frontmatter remains intact')
  check(
    saved.includes('<div class="custom-content" data-value="keep">Embedded content</div>'),
    'Embedded HTML retains its attributes',
  )
  check(
    saved.includes('![Pixel](pixel.svg)') && !saved.includes('data:image'),
    'Loading a local image retains its relative source path',
  )
  await ramu.shot('rich-text-document')
})

ramu.test('formatting actions align and stay outside document scrolling', async () => {
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /alignment.md/ })
    .click()
  await rich.getByRole('heading', { name: 'Toolbar alignment', exact: true }).waitFor()
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting', exact: true })
  const controls = await toolbar.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      return { height: rect.height, width: rect.width, center: rect.y + rect.height / 2 }
    }),
  )
  check(
    controls.every((control) => control.height === 28 && control.width === 28),
    'Formatting buttons use the same dimensions',
  )
  check(
    Math.max(...controls.map((control) => control.center)) - Math.min(...controls.map((control) => control.center)) < 1,
    'Formatting icons share one center line',
  )
  const before = await toolbar.boundingBox()
  await page.locator('.rich-text-scroll:visible').evaluate((element) => {
    element.scrollTop = 400
  })
  await until(
    () => page.locator('.rich-text-scroll:visible').evaluate((element) => element.scrollTop > 0),
    'Document scrolls independently',
  )
  const after = await toolbar.boundingBox()
  const content = await page.locator('.rich-text-scroll:visible').boundingBox()
  check(
    before.y === after.y && content.y >= after.y + after.height,
    'Scrolled content is clipped below the fixed toolbar',
  )
  await ramu.shot('toolbar-alignment-scrolled')
})
