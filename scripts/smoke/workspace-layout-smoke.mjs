// Run after pnpm build. Uses a fake agent and a throwaway repository/profile.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const cwd = resolve(import.meta.dirname, '..', '..', 'apps', 'desktop')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-layout-'))
const repo = join(fixture, 'project')
mkdirSync(repo)
writeFileSync(join(repo, 'review.ts'), 'export const value = 1\n')
mkdirSync(join(repo, 'docs'))
for (let i = 0; i < 60; i++)
  writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Layout fixture\n')
const git = (...args) => execFileSync('git', args, { cwd: repo })
git('init', '-q')
git('add', '.')
git(
  '-c',
  'user.name=Layout',
  '-c',
  'user.email=layout@example.com',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-qm',
  'initial',
)
const env = { ...process.env, RAMU_USER_DATA: join(fixture, 'profile'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1440, height: 900 })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') console.log('renderer:', message.text())
})
page.on('requestfailed', (request) => console.log('request failed:', request.url(), request.failure()?.errorText))
page.on('pageerror', (e) => {
  if (e.message !== 'Canceled') errors.push(e.message)
})
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
const pane = page.locator('.task-pane:visible')
try {
  await page.waitForSelector('.shell')
  console.log(`Fixture and screenshots: ${fixture}`)
  const { project, repositories } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'Layout review', mode: 'current' })
  await api('tasks.setup', task.id)
  const session = await api('agent.start', task.id, 'Reply with a short greeting.', {
    provider: 'claude-code',
    model: 'fake-claude',
    effort: 'medium',
    access: 'full',
    autoFallback: false,
  })
  await page.reload()
  await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await pane.locator('.agent-view:visible').waitFor()
  const width = async (selector) => (await pane.locator(selector).boundingBox()).width
  assert(Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1)
  assert((await pane.locator('.pinned-summary').count()) === 0)
  assert((await page.getByRole('button', { name: 'Toggle pinned summary' }).count()) === 0)
  assert((await page.locator('#workspace-sidebar .workspace-scope').count()) === 0)
  assert(
    await page
      .locator('.workspace-tool-buttons .workspace-scope')
      .getByRole('button', { name: 'Switch project' })
      .isVisible(),
  )
  assert(
    (await page.getByRole('button', { name: 'Source Control', exact: true }).locator('.activity-badge').count()) === 0,
  )
  const scrollAreaBounds = await pane.locator('.main-chat .agent-view:visible .transcript').boundingBox()
  const chatBounds = await pane.locator('.main-chat').boundingBox()
  assert(Math.abs(scrollAreaBounds.width - chatBounds.width) < 1)
  const frame = pane.locator('.agent-view:visible .transcript-frame')
  await frame.evaluate((el) => el.classList.add('shadow-top'))
  await page.waitForTimeout(180)
  assert.equal(await frame.evaluate((el) => getComputedStyle(el, '::before').opacity), '1')
  await frame.evaluate((el) => el.classList.remove('shadow-top'))
  const windowTitle = await page.locator('.app-titlebar .task-header').boundingBox()
  assert(windowTitle.y < 10)
  assert(Math.abs(windowTitle.x - (await page.locator('.main').boundingBox()).x) < 1)
  assert((await page.locator('.main > .task-header').count()) === 0)
  console.log('ok - full-width chat retains its scroll shadows and workspace header uses the window bar')
  await page.screenshot({ path: join(fixture, 'layout-summary.png') })
  console.log('ok - conversation fills workspace without a pinned summary')
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools .repo-tree').waitFor()
  assert((await page.locator('#workspace-sidebar .project-row').count()) > 0)
  await page.waitForTimeout(300)
  assert((await page.locator('.workspace-tools').boundingBox()).width >= 325)
  await page.locator('.workspace-tools').getByRole('button', { name: 'docs', exact: true }).click()
  const viewport = page.locator('.explorer-tree-scroll')
  await viewport.hover()
  await page.waitForTimeout(200)
  const scrollGeometry = await viewport.evaluate((el) => ({
    client: el.clientWidth,
    outer: el.offsetWidth,
    height: el.clientHeight,
    content: el.scrollHeight,
  }))
  assert(scrollGeometry.content > scrollGeometry.height)
  assert.equal(scrollGeometry.client, scrollGeometry.outer)
  const thumb = page.locator('.explorer-scroll-area [data-slot=scroll-area-thumb]')
  const thumbBox = await thumb.boundingBox()
  const toolsBox = await page.locator('.workspace-tools').boundingBox()
  const scrollbarBox = await page.locator('.explorer-scroll-area > [data-slot=scroll-area-scrollbar]').boundingBox()
  assert(
    Math.abs(scrollbarBox.x + scrollbarBox.width - (toolsBox.x + toolsBox.width - 1)) <= 2,
    'Explorer scrollbar follows outer right edge',
  )
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2 + 70, { steps: 5 })
  await page.mouse.up()
  assert((await viewport.evaluate((el) => el.scrollTop)) > 0)
  await viewport.evaluate((el) => {
    el.scrollTop = 0
  })
  await page.locator('.workspace-tools').getByRole('button', { name: 'docs', exact: true }).click()
  const folderBackground = await page
    .locator('.tree-root')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const panelBackground = await page.locator('.workspace-tools').evaluate((el) => getComputedStyle(el).backgroundColor)
  assert.equal(folderBackground, panelBackground)
  console.log('ok - wider tools and draggable overlay scrollbar preserve row width')
  const fullWidth = await width('.main-chat')
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await page.waitForTimeout(60)
  const intermediateWidth = await width('.main-chat')
  await page.waitForTimeout(320)
  const finalWidth = await width('.main-chat')
  assert(intermediateWidth < fullWidth && intermediateWidth > finalWidth + 1)
  assert((await pane.locator('.pinned-summary').count()) === 0)
  await pane.locator('.editor-area .view:visible .monaco-editor[role=code]').first().waitFor()
  let chat = await pane.locator('.main-chat').boundingBox(),
    editor = await pane.locator('.editor-area').boundingBox()
  assert(chat.x + chat.width <= editor.x + 1)
  assert((await pane.locator('.agent-view:visible').count()) === 1)
  console.log('ok - opening file narrows chat on left; Explorer stays right and navigation stays left')
  assert.equal(await pane.getByRole('button', { name: 'New tab', exact: true }).count(), 0)
  await pane.getByRole('button', { name: 'Open file', exact: true }).click()
  const filePicker = page.getByRole('dialog', { name: 'Command palette' })
  await filePicker.getByRole('combobox').fill('document-00.md')
  await filePicker.getByRole('option', { name: /docs\/document-00.md/ }).click()
  const openedDocument = pane.getByRole('tab', { name: /document-00.md/ })
  await openedDocument.waitFor()
  assert.equal(await pane.locator('.agent-view:visible').count(), 1)
  await openedDocument.getByRole('button', { name: 'Close view' }).click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.getByRole('tab', { name: /review.ts/ }).waitFor()
  console.log('ok - Open file launches the file picker and keeps the main conversation visible')
  await api('agent.start', task.id, 'A second conversation for history.', {
    provider: 'claude-code',
    model: 'fake-claude',
    effort: 'medium',
    access: 'full',
    autoFallback: false,
  })
  await pane.getByRole('button', { name: 'Earlier conversations', exact: true }).click()
  const conversations = page.getByRole('menuitemradio')
  assert.equal(await conversations.count(), 2)
  await conversations.first().click()
  await pane.locator('.agent-view:visible').filter({ hasText: 'A second conversation for history.' }).waitFor()
  assert(await pane.getByRole('tab', { name: /review.ts/ }).isVisible())
  await pane.getByRole('button', { name: 'Earlier conversations', exact: true }).click()
  await page.getByRole('menuitemradio').last().click()
  await pane.locator('.agent-view:visible').filter({ hasText: 'Reply with a short greeting.' }).waitFor()
  assert.equal(await pane.locator('.agent-view:visible').count(), 1)
  assert(await pane.getByRole('tab', { name: /review.ts/ }).isVisible())
  console.log('ok - conversation history switches the main chat without closing the editor')
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  const handle = pane.getByRole('separator', { name: 'Resize chat pane' })
  await page.waitForTimeout(300)
  await handle.focus()
  await page.keyboard.press('Home')
  await page.waitForTimeout(300)
  const narrow = await width('.main-chat')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  assert(Math.abs((await width('.main-chat')) - narrow - 20) < 1)
  console.log('ok - keyboard divider expands chat toward right')
  let box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  assert((await width('.main-chat')) > narrow + 20)
  await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
  await page.waitForTimeout(320)
  assert((await pane.getByRole('tab', { name: 'Chat', exact: true }).count()) === 0)
  assert((await pane.locator('.chat-dock-header').count()) === 0)
  assert(Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1)
  writeFileSync(join(repo, 'review.ts'), 'export const value = 2\n')
  await page
    .getByRole('button', { name: 'Source Control', exact: true })
    .locator('.activity-badge', { hasText: '1' })
    .waitFor()
  console.log('ok - Git badge updates while Source Control is closed')
  await api('git.stage', task.id, repositories[0].id, ['review.ts'])
  writeFileSync(join(repo, 'review.ts'), 'export const value = 3\n')
  await page.waitForTimeout(350)
  assert.equal(
    await page.getByRole('button', { name: 'Source Control', exact: true }).locator('.activity-badge').textContent(),
    '1',
  )
  await api('git.unstage', task.id, repositories[0].id, ['review.ts'])
  writeFileSync(join(repo, 'review.ts'), 'export const value = 1\n')
  await page.waitForFunction(
    () => !document.querySelector('.workspace-tool-buttons button[aria-label="Source Control"] .activity-badge'),
  )
  writeFileSync(join(repo, 'review.ts'), 'export const value = 2\n')
  await page.getByRole('button', { name: 'Source Control', exact: true }).locator('.activity-badge').waitFor()

  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  console.log('ok - resizing and workspace collapse preserve the main conversation and file')
  writeFileSync(join(repo, 'review.ts'), 'export const value = 2\n')
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.locator('.workspace-tools').waitFor()
  await page.waitForTimeout(500)
  const header = await page.locator('.task-header').evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    left: el.getBoundingClientRect().left,
    title: el.querySelector('.header-title')?.getBoundingClientRect().left,
  }))
  assert(header.content <= header.width)
  assert(header.title >= header.left)

  for (let i = 0; i < 60; i++)
    writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Changed fixture\n')
  await page.waitForFunction(() => document.querySelectorAll('.workspace-tools .change-row').length === 61)
  await page.locator('.scm-content').hover()
  const scmScrollbar = page.locator('.scm-content > [data-slot=scroll-area-scrollbar]')
  await scmScrollbar.waitFor({ state: 'visible' })
  const scmBar = await scmScrollbar.boundingBox(),
    scmTools = await page.locator('.workspace-tools').boundingBox()
  assert(
    Math.abs(scmBar.x + scmBar.width - (scmTools.x + scmTools.width - 1)) <= 2,
    'Source Control scrollbar follows outer right edge',
  )
  assert.equal(
    await page
      .locator('.scm-content > [data-slot=scroll-area-viewport]')
      .evaluate((el) => el.clientWidth === el.offsetWidth),
    true,
  )
  await page.screenshot({ path: join(fixture, 'layout-scm-scroll.png') })
  for (let i = 0; i < 60; i++)
    writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Layout fixture\n')
  await page.waitForFunction(() => document.querySelectorAll('.workspace-tools .change-row').length === 1)
  await page.waitForFunction(
    () =>
      document.querySelector('.workspace-tool-buttons button[aria-label="Source Control"] .activity-badge')
        ?.textContent === '1',
  )
  console.log('ok - Source Control scrollbar reaches the outer edge without reserving row width')
  await page.screenshot({ path: join(fixture, 'layout-review.png') })
  await page.locator('.workspace-tools .change-name').first().click()
  await pane.locator('.editor-area:visible .monaco-diff-editor').waitFor()
  assert((await pane.locator('.agent-view:visible').count()) === 1)
  await pane
    .locator('.view-tab', { hasText: 'review.ts' })
    .filter({ hasNot: page.locator('.tab-repo') })
    .click()
  console.log('ok - Git changes open as diffs beside the conversation')
  await page.setViewportSize({ width: 1000, height: 720 })
  await page.waitForTimeout(350)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  const bounds = await pane.locator('.task-body').boundingBox()
  assert((await width('.main-chat')) <= bounds.width * 0.7 + 1)
  console.log('ok - compact window clamps chat without page overflow')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  assert((await page.locator('.workspace-tools').getByRole('textbox').count()) > 0)
  assert(
    (await page.locator('#workspace-sidebar').getByRole('button', { name: 'Explorer', exact: true }).count()) === 0,
  )
  assert(
    (await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Explorer', exact: true }).count()) ===
      1,
  )
  assert((await page.locator('.sidebar-nav').getByRole('button', { name: 'Schedules', exact: true }).count()) === 1)
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  assert(await pane.locator('.main-chat').isVisible())
  assert((await pane.getByRole('button', { name: 'Hide conversation', exact: true }).count()) === 0)
  console.log('ok - Search works and conversation is always the main chat')
  await page.waitForTimeout(800)
  const before = await width('.main-chat')
  await page.reload()
  await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await pane.locator('.editor-area .view:visible .monaco-editor[role=code]').first().waitFor()
  await page.waitForTimeout(350)
  assert(Math.abs((await width('.main-chat')) - before) < 1)
  console.log('ok - split and selected file restore after reload')
  assert.deepEqual(errors, [])
  const toggleY = (await page.getByRole('button', { name: 'Hide sidebar', exact: true }).boundingBox()).y
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await page.waitForTimeout(350)
  assert.equal((await page.getByRole('button', { name: 'Show sidebar', exact: true }).boundingBox()).y, toggleY)
  await page.screenshot({ path: join(fixture, 'layout-collapsed.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await pane.locator('.task-body').evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  assert((await page.locator('.shell.no-sidebar').count()) === 1)
  await page.locator('.workspace-tools .repo-tree').waitFor()
  console.log('ok - workspace tools open independently of collapsed project navigation')
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }).click()
  await pane.locator('.terminal-panel:visible').waitFor()
  await page.waitForTimeout(300)
  assert(await pane.locator('.terminal-panel.dock-right').isVisible())
  assert((await width('.main-chat')) < (await width('.task-body')))
  await pane.locator('.terminal-panel .xterm-helper-textarea').first().focus()
  await page.keyboard.type('export RAMU_DOCK_TOKEN=terminal_survived')
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    window.__dockTerminalHost = document.querySelector('.task-pane:not([style*="display: none"]) .terminal-host')
  })
  await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
  await page.waitForTimeout(350)
  assert(await pane.locator('.terminal-panel.dock-bottom').isVisible())
  assert(Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1)
  let bottom = await pane.locator('.terminal-panel').boundingBox(),
    conversation = await pane.locator('.main-chat').boundingBox()
  assert(bottom.y >= conversation.y + conversation.height - 1)
  const resizeTerminal = pane.getByRole('separator', { name: 'Resize terminal panel' })
  await resizeTerminal.focus()
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(300)
  assert((await pane.locator('.terminal-panel').boundingBox()).height > bottom.height)
  await page.screenshot({ path: join(fixture, 'terminal-bottom.png') })
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForTimeout(350)
  bottom = await pane.locator('.terminal-panel').boundingBox()
  const fileAbove = await pane.locator('.editor-area').boundingBox()
  assert(bottom.y >= fileAbove.y + fileAbove.height - 1)
  assert(bottom.width > fileAbove.width)
  await pane.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await page.waitForTimeout(350)
  const right = await pane.locator('.terminal-panel').boundingBox(),
    fileBeside = await pane.locator('.editor-area').boundingBox()
  assert(right.x >= fileBeside.x + fileBeside.width - 1)
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('.task-pane:not([style*="display: none"]) .terminal-host') === window.__dockTerminalHost,
    ),
    true,
  )
  await pane.locator('.terminal-panel .xterm-helper-textarea').first().focus()
  await page.keyboard.type('echo "$RAMU_DOCK_TOKEN"')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document
      .querySelector('.task-pane:not([style*="display: none"]) .xterm-accessibility-tree')
      ?.textContent.includes('terminal_survived'),
  )
  await page.screenshot({ path: join(fixture, 'terminal-right.png') })
  await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
  await page.waitForTimeout(600)
  assert(Object.values((await api('ui.get')).tasks).some((state) => state.terminalDock === 'bottom'))
  await page.reload()
  await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await pane.locator('.terminal-panel.dock-bottom:visible').waitFor()
  await page.waitForTimeout(350)
  console.log('ok - Right/Bottom docking preserves the shell, works beside files, resizes and restores after reload')
  await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
  await page.waitForTimeout(300)
  assert(Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1)
  console.log('ok - terminal opens beside chat and closes without losing the conversation')
  // Exercise all commit menu actions against a local bare remote, never a user remote.
  const remote = join(fixture, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  git('remote', 'add', 'origin', remote)
  git('config', 'user.name', 'Layout')
  git('config', 'user.email', 'layout@example.com')
  git('config', 'commit.gpgsign', 'false')
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.locator('.scm-panel').waitFor()
  const commitInput = page.locator('.commit-msg')
  const commitOption = async (label) => {
    await page.getByRole('button', { name: 'Commit options', exact: true }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.scm-commit')?.textContent.includes('Working'))
  }
  await api('git.stage', task.id, repositories[0].id, ['review.ts'])
  await page.evaluate(() => window.dispatchEvent(new Event('ramu:git-updated')))
  await commitInput.fill('Normal commit\n\nPreserved body')
  await page.getByRole('button', { name: 'Commit 1 staged', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Commit options', exact: true }).click()
  for (const label of ['Commit', 'Commit (Amend)', 'Commit & Push', 'Commit & Sync'])
    assert(await page.getByRole('menuitem', { name: label, exact: true }).isVisible())
  await page.screenshot({ path: join(fixture, 'commit-options.png') })
  await page.getByRole('menuitem', { name: 'Commit', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.commit-msg')?.value === '')
  await page.waitForFunction(
    () => document.querySelector('.scm-commit')?.getAttribute('aria-label') === 'Commit 0 staged',
  )
  const normalHead = git('rev-parse', 'HEAD').toString().trim()
  const commitCount = git('rev-list', '--count', 'HEAD').toString().trim()
  writeFileSync(join(repo, 'review.ts'), 'export const value = 4\n')
  await api('git.stage', task.id, repositories[0].id, ['review.ts'])
  await page.evaluate(() => window.dispatchEvent(new Event('ramu:git-updated')))
  await page.getByRole('button', { name: 'Commit 1 staged', exact: true }).waitFor()
  await commitOption('Commit (Amend)')
  await page.waitForFunction(
    () => document.querySelector('.scm-commit')?.getAttribute('aria-label') === 'Commit 0 staged',
  )
  assert.notEqual(git('rev-parse', 'HEAD').toString().trim(), normalHead)
  assert.equal(git('rev-list', '--count', 'HEAD').toString().trim(), commitCount)
  assert.equal(git('log', '-1', '--format=%B').toString().trim(), 'Normal commit\n\nPreserved body')
  for (const [label, value] of [
    ['Commit & Push', 5],
    ['Commit & Sync', 6],
  ]) {
    writeFileSync(join(repo, 'review.ts'), `export const value = ${value}\n`)
    await api('git.stage', task.id, repositories[0].id, ['review.ts'])
    await page.evaluate(() => window.dispatchEvent(new Event('ramu:git-updated')))
    await page.getByRole('button', { name: 'Commit 1 staged', exact: true }).waitFor()
    await commitInput.fill(label)
    await commitOption(label)
    await page.waitForFunction(
      () => document.querySelector('.scm-commit')?.getAttribute('aria-label') === 'Commit 0 staged',
    )
    await page.waitForFunction(() => document.querySelector('.scm-commit-menu')?.getAttribute('disabled') === null)
    const branch = git('branch', '--show-current').toString().trim()
    assert.equal(
      execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/heads/${branch}`])
        .toString()
        .trim(),
      git('rev-parse', 'HEAD').toString().trim(),
    )
  }
  console.log('ok - Commit, Amend, Commit & Push, and Commit & Sync perform their Git operations')
  await page.getByRole('button', { name: 'Schedules', exact: true }).click()
  assert(
    await page.locator('#workspace-sidebar').getByRole('button', { name: 'New schedule', exact: true }).isVisible(),
  )
  assert((await page.locator('.workspace-tools').count()) === 0)
  console.log('ok - Schedules retains its own left-hand list')
  console.log('ok - no renderer exceptions')
} catch (error) {
  await page.screenshot({ path: join(fixture, 'layout-failure.png') })
  console.log(await page.locator('body').innerText())
  throw error
} finally {
  await api('background.stop').catch(() => {})
  await app.close()
}
