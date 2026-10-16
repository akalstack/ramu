// Workspace layout: how the chat, the tools rail (Explorer / Search / Source Control), the editor and the terminal share
// the task pane, and that sizes, scrollbars and docking survive resizing, collapsing and reloads.
// Panel reopen / divider / tab-strip behaviour lives in panels.spec.mjs.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { showChat, startRamu } from '../support/index.mjs'

const files = { 'review.ts': 'export const value = 1\n' }
for (let i = 0; i < 60; i++) files[`docs/document-${String(i).padStart(2, '0')}.md`] = '# Layout fixture\n'
const ramu = await startRamu('layout', { repos: { project: files } })
const { page } = ramu
const pane = page.locator('.task-pane:visible')
const tools = page.locator('.workspace-tools')
const toolsClose = tools.getByRole('button', { name: /^Hide / })
const sourceControl = page.getByRole('button', { name: 'Source Control', exact: true })
const badge = sourceControl.locator('.activity-badge')
const fakeSettings = {
  provider: 'claude-code',
  model: 'fake-claude',
  effort: 'medium',
  access: 'full',
  autoFallback: false,
}

const bounds = async (selector, scope = pane) =>
  (await scope.locator(selector).first().boundingBox()) ?? assert.fail(`${selector} is not laid out`)
const width = async (selector) => (await bounds(selector)).width
/** Panes ease their size; wait until it stops changing. */
async function stable(selector, scope = pane) {
  let last = -1
  await ramu.until(
    async () => {
      const current = (await bounds(selector, scope)).width
      const same = Math.abs(current - last) < 0.5
      last = current
      return same
    },
    `${selector} never stopped resizing`,
    { interval: 150 },
  )
  return last
}
const edit = (name, content) => writeFileSync(join(ramu.repos.project, name), content)
let task, repoId

ramu.test('full-width chat uses the window title bar and keeps its scroll shadows', async () => {
  const { project, repositories } = await ramu.api('projects.addFolder', ramu.repos.project)
  repoId = repositories[0].id
  task = await ramu.api('tasks.create', { projectId: project.id, title: 'Layout review', mode: 'current' })
  await ramu.api('tasks.setup', task.id)
  const session = await ramu.api('agent.start', task.id, 'Reply with a short greeting.', fakeSettings)
  await ramu.until(async () => (await ramu.api('agent.get', session.id)).state === 'idle', 'chat never became idle')
  await showChat(ramu, { task, session })
  await pane.locator('.agent-view:visible').waitFor()

  ramu.check(Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1, 'chat fills the task body')
  ramu.check(
    (await page.locator('#workspace-sidebar .workspace-scope').count()) === 0,
    'project switcher is not in the sidebar',
  )
  ramu.check(
    await page
      .locator('.workspace-tool-buttons .workspace-scope')
      .getByRole('button', { name: 'Switch project' })
      .isVisible(),
    'project switcher sits with the workspace tool buttons',
  )
  ramu.check((await badge.count()) === 0, 'clean repository shows no Source Control badge')
  const header = await bounds('.app-titlebar .task-header', page)
  const sidebar = await bounds('#workspace-sidebar', page)
  ramu.check(
    header.y < 10 && Math.abs(header.x - (sidebar.x + sidebar.width)) < 1,
    `workspace header uses the window bar beside the sidebar ${JSON.stringify([header, sidebar])}`,
  )
  ramu.check((await page.locator('.main > .task-header').count()) === 0, 'no second header under the title bar')

  const frame = pane.locator('.agent-view:visible .transcript-frame')
  await frame.evaluate((el) => el.classList.add('shadow-top'))
  await ramu.until(
    async () => (await frame.evaluate((el) => getComputedStyle(el, '::before').opacity)) === '1',
    'top scroll shadow never faded in',
  )
  await frame.evaluate((el) => el.classList.remove('shadow-top'))
  await ramu.shot('summary')
})

ramu.test('Explorer opens at the default rail width with a draggable overlay scrollbar', async () => {
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools .repo-tree').waitFor()
  ramu.check(
    (await page.locator('#workspace-sidebar .project-row').count()) > 0,
    'project navigation stays on the left',
  )
  const toolsWidth = await stable('.workspace-tools', page)
  // 280px is the rail's default (RAIL_WIDTH.fallback); 220..480 is its range.
  ramu.check(Math.abs(toolsWidth - 280) <= 1, `tools rail opens at its default width (${toolsWidth})`)

  await tools.getByRole('button', { name: 'docs', exact: true }).click()
  const viewport = page.locator('.explorer-tree-scroll')
  await viewport.hover()
  await ramu.until(
    async () => (await page.locator('.explorer-scroll-area [data-slot=scroll-area-thumb]').count()) > 0,
    'no scroll thumb',
  )
  const geometry = await viewport.evaluate((el) => ({
    client: el.clientWidth,
    outer: el.offsetWidth,
    height: el.clientHeight,
    content: el.scrollHeight,
  }))
  assert.ok(geometry.content > geometry.height, 'the folder is taller than the viewport')
  assert.equal(geometry.client, geometry.outer, 'the overlay scrollbar reserves no row width')
  const toolsBox = await bounds('.workspace-tools', page)
  const bar = await bounds('.explorer-scroll-area > [data-slot=scroll-area-scrollbar]', page)
  // The panel pads itself by 8px, so the overlay bar hugs that inset instead of the rail edge.
  assert.ok(
    Math.abs(toolsBox.x + toolsBox.width - 8 - (bar.x + bar.width)) <= 2,
    `Explorer scrollbar follows the panel's right edge ${JSON.stringify([bar, toolsBox])}`,
  )
  const thumb = await bounds('.explorer-scroll-area [data-slot=scroll-area-thumb]', page)
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 70, { steps: 5 })
  await page.mouse.up()
  ramu.check((await viewport.evaluate((el) => el.scrollTop)) > 0, 'dragging the thumb scrolls the tree')
  await viewport.evaluate((el) => (el.scrollTop = 0))
  await tools.getByRole('button', { name: 'docs', exact: true }).click()
  // The panel is transparent, so compare with the first opaque background behind it.
  const [folder, panel] = await Promise.all([
    page
      .locator('.tree-root')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    tools.evaluate((el) => {
      for (let node = el; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      }
    }),
  ])
  assert.equal(folder, panel, `sticky folder rows match the surface behind them: ${folder} vs ${panel}`)
})

ramu.test('opening a file narrows the chat on the left and the picker keeps the conversation visible', async () => {
  const full = await width('.main-chat')
  await tools.getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.locator('.editor-area .view:visible .monaco-editor[role=code]').first().waitFor()
  const narrowed = await stable('.main-chat')
  ramu.check(narrowed < full - 1, 'chat narrows when a file opens')
  const chat = await bounds('.main-chat')
  const editor = await bounds('.editor-area')
  ramu.check(chat.x + chat.width <= editor.x + 1, 'the editor sits to the right of the chat')
  assert.equal(await pane.locator('.agent-view:visible').count(), 1)
  assert.equal(await pane.getByRole('button', { name: 'New tab', exact: true }).count(), 1)

  await pane.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Open file/ }).click()
  const picker = page.getByRole('dialog', { name: 'Command palette' })
  await picker.locator('[data-slot=command-input]').fill('document-00.md')
  await picker.getByRole('option', { name: /docs\/document-00.md/ }).click()
  const opened = pane.getByRole('tab', { name: /document-00.md/ })
  await opened.waitFor()
  assert.equal(await pane.locator('.agent-view:visible').count(), 1)
  await opened.getByRole('button', { name: 'Close view' }).click()
  await tools.getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.getByRole('tab', { name: /review.ts/ }).waitFor()
  ramu.check(true, 'Open file launches the picker and keeps the main conversation visible')
})

ramu.test('conversation history switches the main chat without closing the editor', async () => {
  await ramu.api('agent.start', task.id, 'A second conversation for history.', fakeSettings)
  await pane.getByRole('button', { name: 'Earlier conversations', exact: true }).click()
  const conversations = page.getByRole('menuitemradio')
  await conversations.first().waitFor()
  assert.equal(await conversations.count(), 2)
  await conversations.first().click()
  await pane.locator('.agent-view:visible').filter({ hasText: 'A second conversation for history.' }).waitFor()
  assert.ok(await pane.getByRole('tab', { name: /review.ts/ }).isVisible())
  await pane.getByRole('button', { name: 'Earlier conversations', exact: true }).click()
  await page.getByRole('menuitemradio').last().click()
  await pane.locator('.agent-view:visible').filter({ hasText: 'Reply with a short greeting.' }).waitFor()
  assert.equal(await pane.locator('.agent-view:visible').count(), 1)
  ramu.check(
    await pane.getByRole('tab', { name: /review.ts/ }).isVisible(),
    'history switches chats and keeps the editor',
  )
})

ramu.test('chat divider resizes by keyboard and pointer; hiding the workspace restores the full chat', async () => {
  await toolsClose.click()
  const handle = pane.getByRole('separator', { name: 'Resize chat pane' })
  await handle.focus()
  await page.keyboard.press('Home')
  const narrow = await stable('.main-chat')
  await page.keyboard.press('ArrowRight')
  ramu.check(Math.abs((await stable('.main-chat')) - narrow - 20) < 1, 'ArrowRight widens the chat by 20px')
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  assert.ok((await stable('.main-chat')) > narrow + 20, 'dragging widens the chat further')
  await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
  await ramu.until(
    async () => Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1,
    'chat did not return to full width',
  )
  ramu.check(true, 'hiding the workspace gives the chat the whole body')
})

ramu.test('the Git badge follows working-tree changes while Source Control is closed', async () => {
  edit('review.ts', 'export const value = 2\n')
  await badge.filter({ hasText: '1' }).waitFor()
  await ramu.api('git.stage', task.id, repoId, ['review.ts'])
  edit('review.ts', 'export const value = 3\n')
  // Staged plus unstaged edits to one file still count once.
  await ramu.sleep(350)
  assert.equal(await badge.textContent(), '1')
  await ramu.api('git.unstage', task.id, repoId, ['review.ts'])
  edit('review.ts', 'export const value = 1\n')
  await badge.waitFor({ state: 'detached' })
  edit('review.ts', 'export const value = 2\n')
  await badge.waitFor()
  ramu.check(true, 'Git badge updates while Source Control is closed')
})

ramu.test('Source Control scrolls to the outer edge and opens diffs beside the conversation', async () => {
  await sourceControl.click()
  await tools.waitFor()
  const header = await page.locator('.app-titlebar .task-header').evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    left: el.getBoundingClientRect().left,
    title: el.querySelector('.header-title')?.getBoundingClientRect().left,
  }))
  assert.ok(header.content <= header.width, 'task header does not overflow')
  assert.ok(header.title >= header.left, 'task title stays inside the header')

  for (let i = 0; i < 60; i++) edit(`docs/document-${String(i).padStart(2, '0')}.md`, '# Changed fixture\n')
  await page.waitForFunction(() => document.querySelectorAll('.workspace-tools .change-row').length === 61)
  await page.locator('.scm-repos').hover()
  const scrollbar = page.locator('.scm-repos > [data-slot=scroll-area-scrollbar]')
  await scrollbar.waitFor({ state: 'visible' })
  const bar = await scrollbar.boundingBox()
  const toolsBox = await bounds('.workspace-tools', page)
  assert.ok(
    Math.abs(bar.x + bar.width - (toolsBox.x + toolsBox.width - 1)) <= 2,
    'Source Control scrollbar follows the outer right edge',
  )
  assert.ok(
    await page
      .locator('.scm-repos > [data-slot=scroll-area-viewport]')
      .evaluate((el) => el.clientWidth === el.offsetWidth),
  )
  await ramu.shot('scm-scroll')
  for (let i = 0; i < 60; i++) edit(`docs/document-${String(i).padStart(2, '0')}.md`, '# Layout fixture\n')
  await page.waitForFunction(() => document.querySelectorAll('.workspace-tools .change-row').length === 1)
  await badge.filter({ hasText: /^1$/ }).waitFor()

  await page.locator('.workspace-tools .change-name').first().click()
  await pane.locator('.editor-area:visible .monaco-diff-editor').waitFor()
  assert.equal(await pane.locator('.agent-view:visible').count(), 1)
  ramu.check(true, 'Git changes open as diffs beside the conversation')
})

ramu.test('a compact window clamps the chat; Search is a tool and Schedules keep their own list', async () => {
  await page.setViewportSize({ width: 1000, height: 720 })
  await ramu.until(
    async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'page overflows horizontally',
  )
  const body = await bounds('.task-body')
  assert.ok((await stable('.main-chat')) <= body.width * 0.7 + 1, 'compact chat is clamped to 70% of the body')
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByRole('button', { name: 'Search', exact: true }).click()
  assert.ok((await tools.getByRole('textbox').count()) > 0)
  assert.equal(
    await page.locator('#workspace-sidebar').getByRole('button', { name: 'Explorer', exact: true }).count(),
    0,
  )
  assert.equal(
    await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Explorer', exact: true }).count(),
    1,
  )
  assert.equal(await page.locator('.sidebar-nav').getByRole('button', { name: 'Schedules', exact: true }).count(), 1)
  await toolsClose.click()
  assert.ok(await pane.locator('.main-chat').isVisible())
  assert.equal(await pane.getByRole('button', { name: 'Hide conversation', exact: true }).count(), 0)
  ramu.check(true, 'compact window clamps the chat and Search lives in the tools rail')
})

ramu.test('the split and selected file restore after a reload', async () => {
  const before = await stable('.main-chat')
  await ramu.reload()
  await page.locator('.task-row').first().click()
  await pane.locator('.editor-area:visible').waitFor()
  await ramu.until(async () => Math.abs((await width('.main-chat')) - before) < 1, 'chat width was not restored')
  ramu.check(true, 'split restores after reload')
})

ramu.test('the sidebar collapses independently of the workspace tools', async () => {
  const hide = page.getByRole('button', { name: 'Hide sidebar', exact: true })
  const toggleY = (await hide.boundingBox()).y
  await hide.click()
  const show = page.getByRole('button', { name: 'Show sidebar', exact: true })
  await show.waitFor()
  await ramu.until(async () => (await show.boundingBox()).y === toggleY, 'sidebar toggle moved')
  await ramu.shot('collapsed')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await pane.locator('.task-body').evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  assert.equal(await page.locator('.shell.no-sidebar').count(), 1)
  await page.locator('.workspace-tools .repo-tree').waitFor()
  await toolsClose.click()
  await show.click()
  ramu.check(true, 'workspace tools open independently of collapsed project navigation')
})

ramu.test(
  'terminal docks right or bottom beside chat and files, keeps its shell, and restores after reload',
  async () => {
    await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }).click()
    await pane.locator('.terminal-panel:visible').waitFor()
    // The default dock is the bottom (defaultTerminalDock), which leaves the chat at full width.
    await pane.locator('.terminal-panel.dock-bottom').waitFor()
    await page.waitForFunction(() =>
      document.querySelector('.terminal-panel .xterm-accessibility-tree')?.textContent.includes('project'),
    )
    await pane.locator('.terminal-panel .xterm-helper-textarea').first().focus()
    const octal = [...'terminal_survived'].map((c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`).join('')
    await page.keyboard.type(`export RAMU_DOCK_TOKEN=$(printf '${octal}')`)
    await page.keyboard.press('Enter')
    await page.evaluate(() => {
      window.__dockTerminalHost = document.querySelector('.task-pane:not([style*="display: none"]) .terminal-host')
    })
    const fullChat = await stable('.main-chat')
    await pane.getByRole('button', { name: 'Move terminal to workspace tabs', exact: true }).click()
    await pane.locator('.terminal-panel.dock-right').waitFor()
    assert.ok((await stable('.main-chat')) < fullChat - 1, 'a right dock narrows the chat')
    await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
    await pane.locator('.terminal-panel.dock-bottom').waitFor()
    await ramu.until(
      async () => Math.abs((await stable('.main-chat')) - (await width('.task-body'))) < 1,
      'bottom dock narrowed the chat',
    )
    let bottom = await bounds('.terminal-panel')
    const chat = await bounds('.main-chat')
    assert.ok(bottom.y >= chat.y + chat.height - 1, 'bottom dock sits under the chat')
    const resize = pane.getByRole('separator', { name: 'Resize terminal panel' })
    await resize.focus()
    await page.keyboard.press('ArrowUp')
    await ramu.until(
      async () => (await bounds('.terminal-panel')).height > bottom.height,
      'ArrowUp did not grow the terminal',
    )
    await ramu.shot('terminal-bottom')

    // Bottom terminals span both panes; workspace terminals share the file tab strip and preserve their shell.
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await tools.getByRole('button', { name: 'review.ts', exact: true }).click()
    await toolsClose.click()
    await pane.locator('.editor-area:visible').waitFor()
    await stable('.editor-area')
    bottom = await bounds('.terminal-panel')
    const fileAbove = await bounds('.editor-area')
    assert.ok(bottom.y >= fileAbove.y + fileAbove.height - 1, 'bottom terminal sits under the file')
    assert.ok(bottom.width > fileAbove.width, 'bottom terminal spans wider than the file')
    await pane.getByRole('button', { name: 'Move terminal to workspace tabs', exact: true }).click()
    await pane.locator('.terminal-panel.dock-right').waitFor()
    await stable('.terminal-panel')
    const right = await bounds('.terminal-panel')
    const workspaceTabs = pane.getByRole('tablist', { name: 'Workspace tabs', exact: true })
    const terminalTab = workspaceTabs.locator('[role="tab"][aria-selected="true"]')
    const terminalViewId = await terminalTab.getAttribute('data-view-id')
    assert.ok(terminalViewId, 'terminal is selected in the workspace tab strip')
    assert.equal(await pane.locator('.editor-area:visible').count(), 0, 'terminal replaces the file content')
    assert.equal(await pane.locator('.terminal-panel .terminal-tabs').count(), 0, 'no second terminal tab strip')
    // The earlier Source Control step left a "review.ts changes" diff tab open beside the file.
    await workspaceTabs.getByRole('tab').filter({ hasText: 'review.ts' }).filter({ hasNotText: 'changes' }).click()
    await pane.locator('.editor-area:visible').waitFor()
    assert.equal(await pane.locator('.terminal-panel:visible').count(), 0, 'selecting a file hides the terminal')
    await workspaceTabs.locator(`[data-view-id="${terminalViewId}"]`).click()
    await pane.locator('.terminal-panel:visible').waitFor()
    assert.ok(Math.abs((await bounds('.terminal-panel')).width - right.width) < 1, 'tabs use the same pane width')
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector('.task-pane:not([style*="display: none"]) .terminal-host') ===
          window.__dockTerminalHost,
      ),
      'docking keeps the same terminal host element',
    )
    await pane.locator('.terminal-panel .xterm-helper-textarea').first().focus()
    await page.keyboard.type('echo "$RAMU_DOCK_TOKEN"')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() =>
      document
        .querySelector('.task-pane:not([style*="display: none"]) .xterm-accessibility-tree')
        ?.textContent.includes('terminal_survived'),
    )
    await ramu.shot('terminal-right')

    await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
    await ramu.until(
      async () => Object.values((await ramu.api('ui.get')).tasks).some((state) => state.terminalDock === 'bottom'),
      'dock was not saved',
    )
    await ramu.reload()
    await page.locator('.task-row').first().click()
    await pane.locator('.terminal-panel.dock-bottom:visible').waitFor()
    await page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await ramu.until(
      async () => Math.abs((await width('.main-chat')) - (await width('.task-body'))) < 1,
      'chat did not return to full width',
    )
    ramu.check(true, 'Workspace tabs and bottom docking preserve the shell, resize and restore after reload')
  },
)

ramu.test('Schedules keep their own left-hand list and no tools rail', async () => {
  await page.getByRole('button', { name: 'Schedules', exact: true }).click()
  await page.locator('#workspace-sidebar').getByRole('button', { name: 'New schedule', exact: true }).waitFor()
  assert.equal(await tools.count(), 0)
  ramu.noErrors()
})
