// Dropping files from the desktop onto the Explorer and the chat. Drops are synthesized through the DevTools protocol,
// which works in hidden windows.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { showChat, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('explorer-drop', { repos: { demo: { 'notes.md': 'Saved project notes\n' } } })
const { page, api, until, check } = ramu
const desktop = join(ramu.dir, 'Desktop fixtures')
const folder = join(desktop, 'Dropped folder')
const note = join(desktop, 'note.txt')
const inRepo = (...parts) => join(ramu.repos.demo, ...parts)
let cdp, folderRow, chat, composer, input

const dropFiles = async (locator, paths, bottom = false) => {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Drop target is not visible')
  const x = box.x + box.width / 2
  const y = box.y + (bottom ? box.height - 4 : box.height / 2)
  const data = { items: [], files: paths, dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data })
}
const draft = () => input.getAttribute('data-draft')

ramu.test('Explorer imports desktop files and folders', async () => {
  mkdirSync(join(folder, 'Nested'), { recursive: true })
  writeFileSync(join(folder, 'Nested', 'context.txt'), 'Folder context from desktop\n')
  writeFileSync(note, 'Desktop note\n')
  const { project } = await api('projects.addFolder', ramu.repos.demo)
  chat = await startChat(ramu, { projectId: project.id, title: 'Drop checks', prompt: 'Ready for drop checks' })
  await showChat(ramu, chat, { sidebar: 'explorer' })
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.waitForSelector('.explorer-panel .tree-root')
  // `page` follows relaunches through a proxy; Playwright needs the real object here.
  const window = await ramu.app.firstWindow()
  cdp = await window.context().newCDPSession(window)
  const root = page.locator('.explorer-panel .tree-root').first()
  await dropFiles(root, [folder, note])
  await until(
    () => existsSync(inRepo('Dropped folder', 'Nested', 'context.txt')) && existsSync(inRepo('note.txt')),
    'desktop drop import',
  )
  check(
    readFileSync(join(folder, 'Nested', 'context.txt'), 'utf8') === 'Folder context from desktop\n',
    'Folders import recursively and originals stay',
  )
  await dropFiles(root, [note])
  await until(() => existsSync(inRepo('note copy.txt')), 'duplicate import to get a free name')
  check(readFileSync(inRepo('note.txt'), 'utf8') === 'Desktop note\n', 'Duplicate drops preserve existing files')
  folderRow = page.locator('.explorer-panel .tree-row').filter({ hasText: 'Dropped folder' }).first()
  await folderRow.waitFor()
  await dropFiles(folderRow, [note])
  await until(() => existsSync(inRepo('Dropped folder', 'note.txt')), 'folder row to receive the drop')
  writeFileSync(join(desktop, 'blank-space.txt'), 'Dropped below the tree\n')
  await dropFiles(page.locator('.explorer-panel .repo-tree').last(), [join(desktop, 'blank-space.txt')], true)
  await until(() => existsSync(inRepo('blank-space.txt')), 'empty Explorer space to receive the drop')
})

ramu.test('thread accepts desktop drops as paths and attachments', async () => {
  const view = page.locator('.agent-view:visible')
  composer = view.locator('.composer')
  input = composer.locator('[data-composer-input]')
  await input.fill('Inspect these folders')
  await dropFiles(composer, [folder, note])
  await until(async () => (await draft()).includes(JSON.stringify(folder)), 'folder path in the draft')
  await composer.locator('.attachment-name').filter({ hasText: 'note.txt' }).waitFor()
  const empty = join(desktop, 'Empty folder')
  mkdirSync(empty)
  await dropFiles(view.locator('.agent-header'), [empty])
  await until(async () => (await draft()).includes(JSON.stringify(empty)), 'empty folder path from the conversation')
  check((await composer.getByRole('alert').count()) === 0, 'Empty desktop folders are accepted as path references')
  await folderRow.dragTo(composer)
  await composer.getByRole('button', { name: 'Remove Dropped folder/Nested/context.txt', exact: true }).waitFor()
  check(!(await view.getAttribute('class')).includes(' dropping'), 'The thread drop highlight clears after drops')
  await cdp.detach()
  ramu.noErrors()
})
