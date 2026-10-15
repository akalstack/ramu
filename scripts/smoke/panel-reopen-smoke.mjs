// Run after pnpm build, or set RAMU_RENDERER_URL for a running dev renderer.
// Uses a fake agent and a throwaway repository/profile.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
if (process.env.RAMU_RENDERER_URL) env.ELECTRON_RENDERER_URL = process.env.RAMU_RENDERER_URL
else delete env.ELECTRON_RENDERER_URL
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
await page.addInitScript(() => {
  window.__panelMotions = []
  const animate = Element.prototype.animate
  Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args)
    if (animation.id.startsWith('ramu-panel-')) {
      window.__panelMotions.push({
        status: 'ready',
        kind: 'live',
        animations: [
          {
            name: animation.id,
            duration: animation.effect.getTiming().duration,
            properties: [...new Set(animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)))].filter(
              (key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key),
            ),
          },
        ],
      })
      if (window.__capturePanelMotion) {
        animation.pause()
        animation.currentTime = animation.effect.getTiming().duration / 2
      }
    }
    return animation
  }
  const start = document.startViewTransition.bind(document)
  document.startViewTransition = (...args) => {
    const transition = start(...args)
    const motion = { status: 'pending', kind: 'snapshot', animations: [] }
    window.__panelMotions.push(motion)
    transition.ready.then(
      () => {
        motion.animations = document
          .getAnimations()
          .filter((animation) => animation.animationName?.startsWith('ramu-panel-'))
          .map((animation) => ({
            name: animation.animationName,
            duration: animation.effect.getTiming().duration,
            properties: [...new Set(animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)))].filter(
              (key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key),
            ),
          }))
        motion.status = 'ready'
        if (window.__capturePanelMotion)
          for (const animation of document
            .getAnimations()
            .filter((animation) => animation.animationName?.startsWith('ramu-panel-'))) {
            animation.pause()
            animation.currentTime = animation.effect.getTiming().duration / 2
          }
      },
      (error) => {
        motion.status = error.message
      },
    )
    return transition
  }
})
await page.setViewportSize({ width: 1440, height: 900 })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') console.log('renderer:', message.text())
})
page.on('requestfailed', (request) => console.log('request failed:', request.url(), request.failure()?.errorText))
page.on('pageerror', (e) => {
  if (e.message !== 'Canceled') {
    console.log('page error:', e.stack)
    errors.push(e.message)
  }
})
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
const pane = page.locator('.task-pane:visible')
const motionClick = async (locator, expected) => {
  const count = await page.evaluate(() => window.__panelMotions.length)
  await locator.click()
  await page.waitForFunction(
    (count) => window.__panelMotions.length > count && window.__panelMotions.at(-1).status !== 'pending',
    count,
  )
  const motion = await page.evaluate(() => window.__panelMotions.at(-1))
  assert.equal(motion.status, 'ready', 'Native panel capture succeeds')
  assert.equal(motion.kind, expected.includes('-out-') ? 'snapshot' : 'live', 'Only closing needs a snapshot')
  assert(
    motion.animations.some((animation) => animation.name === expected),
    `Panel plays ${expected}: ${JSON.stringify(motion)}`,
  )
  assert(
    motion.animations.every(
      (animation) =>
        animation.duration <= 180 &&
        animation.properties.every((property) => property === 'opacity' || property === 'transform'),
    ),
    'Only opacity and transform animate, for at most 180ms',
  )
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement, '::view-transition').pointerEvents),
    'none',
    'Snapshots do not intercept input',
  )
}
const resumeMotion = () =>
  page.evaluate(() => {
    window.__capturePanelMotion = false
    document.getAnimations().forEach((animation) => animation.play())
  })
try {
  await page.waitForSelector('.shell')
  console.log(`Fixture and screenshots: ${fixture}`)
  const { project } = await api('projects.addFolder', repo)
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

  await page.evaluate(() => {
    window.__capturePanelMotion = true
  })
  await motionClick(page.getByRole('button', { name: 'Explorer', exact: true }), 'ramu-panel-in-right')
  await page.screenshot({ path: join(fixture, 'tools-opening.png') })
  await resumeMotion()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.locator('.monaco-editor[role=code]').first().waitFor()
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => {
    window.__reopenChat = document.querySelector('.task-pane .agent-view')
    window.__reopenEditor = document.querySelector('.task-pane .monaco-editor')
  })
  const check = async (editor, terminal) => {
    await page.waitForTimeout(350)
    const geometry = await pane.evaluate((el) => {
      const rect = (selector) => {
        const r = el.querySelector(selector)?.getBoundingClientRect()
        return r ? { x: r.x, right: r.right, width: r.width } : null
      }
      return {
        body: rect('.task-body'),
        chat: rect('.main-chat'),
        editor: rect('.editor-area'),
        terminal: rect('.terminal-panel'),
        group: rect('.task-body > [data-workspace-split]'),
      }
    })
    assert(Math.abs(geometry.body.width - geometry.group.width) < 1)
    assert(geometry.chat.width >= 300 && geometry.chat.right <= geometry.body.right + 1)
    if (editor) {
      assert(geometry.editor.width >= 230 && geometry.editor.right <= geometry.body.right + 1)
      assert(geometry.editor.x >= geometry.chat.right - 1)
    }
    if (terminal) {
      assert(geometry.terminal.width >= 230 && geometry.terminal.right <= geometry.body.right + 1)
      assert(geometry.terminal.x >= (editor ? geometry.editor.right : geometry.chat.right) - 1)
    }
    assert(await page.evaluate(() => document.querySelector('.task-pane .agent-view') === window.__reopenChat))
    if (editor)
      assert(await page.evaluate(() => document.querySelector('.task-pane .monaco-editor') === window.__reopenEditor))
    return geometry
  }
  const handle = pane.getByRole('separator', { name: 'Resize chat pane' })
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  const beforeDrag = await check(true, false)
  const divider = await handle.boundingBox()
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x + divider.width / 2 + 40, divider.y + divider.height / 2, { steps: 4 })
  assert(
    Math.abs((await pane.locator('.main-chat').boundingBox()).width - beforeDrag.chat.width - 40) < 1,
    'Chat resizes in real time during dragging',
  )
  await page.screenshot({ path: join(fixture, 'main-divider-drag.png') })
  await page.mouse.up()
  const saved = await check(true, false)
  const motion = await pane
    .locator('[data-workspace-split]')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration)
  assert.equal(motion, '0s', 'Split geometry changes without a layout animation')
  assert(
    await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return style.getPropertyValue('--pane-border-active') === style.getPropertyValue('--accent')
    }),
    'Divider highlight follows the workspace accent',
  )
  assert(
    Math.abs(saved.chat.width - beforeDrag.chat.width - 40) < 1,
    'Dragging the independent divider resizes the chat by the pointer movement',
  )
  const cancelAt = await handle.boundingBox()
  await page.mouse.move(cancelAt.x + cancelAt.width / 2, cancelAt.y + cancelAt.height / 2)
  await page.mouse.down()
  await page.mouse.move(cancelAt.x + 60, cancelAt.y + cancelAt.height / 2)
  const cancelledWidth = (await pane.locator('.main-chat').boundingBox()).width
  await handle.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  assert(
    Math.abs((await pane.locator('.main-chat').boundingBox()).width - cancelledWidth) < 1,
    'Cancelled live drags preserve the last displayed size',
  )
  assert.equal(await pane.locator('[data-workspace-split][data-dragging]').count(), 0)
  const restoreAt = await handle.boundingBox()
  await page.mouse.move(restoreAt.x + restoreAt.width / 2, restoreAt.y + restoreAt.height / 2)
  await page.mouse.down()
  await page.mouse.move(cancelAt.x + cancelAt.width / 2, cancelAt.y + cancelAt.height / 2)
  await page.mouse.up()
  for (let i = 0; i < 3; i++) {
    if (i === 0)
      await motionClick(pane.getByRole('button', { name: 'Hide workspace', exact: true }), 'ramu-panel-out-right')
    else await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    if (i === 0) {
      const closed = await pane.locator('.main-chat').boundingBox()
      const full = await pane.locator('.task-body').boundingBox()
      assert(Math.abs(closed.width - full.width) < 1, 'Closing immediately restores the full chat width')
      assert.equal(await pane.locator('.editor-area').evaluate((el) => getComputedStyle(el).visibility), 'hidden')
    }
    await check(false, false)
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
    const restored = await check(true, false)
    assert(Math.abs(restored.chat.width - saved.chat.width) < 1, 'Editor split restores the resized chat width')
  }
  console.log('ok - repeated editor close/reopen restores sizes and preserves chat/editor DOM')
  await motionClick(
    page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }),
    'ramu-panel-in-bottom',
  )
  await pane.locator('.terminal-panel').waitFor()
  const border = await pane.locator('.terminal-panel').evaluate((el) => ({
    border: getComputedStyle(el).borderTopWidth,
    left: getComputedStyle(el).borderLeftWidth,
    right: getComputedStyle(el).borderRightWidth,
    radius: getComputedStyle(el).borderTopLeftRadius,
  }))
  assert.deepEqual(
    border,
    { border: '0px', left: '0px', right: '0px', radius: '0px' },
    'The split divider is the only terminal edge; no duplicate card borders',
  )
  await pane.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await check(true, true)
  await page.evaluate(() => {
    window.__reopenTerminal = document.querySelector('.task-pane .terminal-host')
  })
  for (let i = 0; i < 3; i++) {
    await pane.getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
    await check(true, false)
    await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }).click()
    await check(true, true)
    assert(await page.evaluate(() => document.querySelector('.task-pane .terminal-host') === window.__reopenTerminal))
    await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await check(false, false)
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
    await check(true, true)
  }
  console.log('ok - editor and right terminal reopen together without pushing either out of the workspace')
  await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
  await check(true, false)
  await pane.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await check(true, true)
  assert(await page.evaluate(() => document.querySelector('.task-pane .terminal-host') === window.__reopenTerminal))
  assert.deepEqual(errors, [])
  console.log('ok - docking retains chat, editor and terminal instances without renderer exceptions')
  // Capture a real Changes review from a disposable file edited during a fake agent turn.
  await api('agent.send', session.id, 'Capture a layout review [slow]')
  await page.waitForTimeout(400)
  writeFileSync(join(repo, 'review.ts'), 'export const value = 2\n')
  for (let i = 0; i < 12; i++)
    writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Updated layout fixture\n')
  await page.waitForFunction(
    async (id) =>
      (await window.ramu.invoke('reviews.list', id)).some((review) => review.state === 'ready' && review.files.length),
    session.id,
  )
  await pane.getByRole('button', { name: 'View changes', exact: true }).last().click()
  await pane.locator('.changes-tab:visible .pair-review-bar').waitFor()
  assert(
    await pane.locator('.workspace-tab-toolbar').evaluate((el) => {
      const toolbar = el.getBoundingClientRect(),
        tab = el.querySelector('[role="tab"][aria-selected="true"]').getBoundingClientRect()
      return tab.top - toolbar.top >= 5 && toolbar.bottom - tab.bottom >= 5
    }),
    'Tabs have space above and below instead of touching the toolbar edge',
  )
  const changes = pane.locator('.changes-tab:visible')
  await changes.locator('.review-diff .monaco-diff-editor').first().waitFor()
  await page.evaluate(() => {
    window.__reopenReview = document.querySelector('.changes-tab')
    window.__firstReviewEditor = document.querySelector('.changes-tab .review-diff .monaco-diff-editor')
  })
  await changes.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(450)
  assert(
    await page.evaluate(() => window.__firstReviewEditor.isConnected),
    'Scrolling past a diff does not destroy its editor',
  )
  await changes.evaluate((el) => {
    el.scrollTop = 0
  })
  await page.waitForTimeout(450)
  assert(
    await page.evaluate(
      () => document.querySelector('.changes-tab .review-diff .monaco-diff-editor') === window.__firstReviewEditor,
    ),
    'Returning to a diff retains its editor instead of flashing a rebuilt surface',
  )
  await pane.getByRole('separator', { name: 'Resize chat pane' }).focus()
  await page.keyboard.press('End')
  await changes.getByRole('button', { name: 'Show file tree', exact: true }).click()
  await changes.locator('.review-tree[data-flat]').waitFor()
  assert.equal(
    await changes.locator('.review-tree-row.dir').count(),
    0,
    'Narrow Changes navigator uses a flat file list',
  )
  assert(await changes.locator('.review-tree').getByRole('button', { name: 'document-00.md' }).isVisible())
  await page.screenshot({ path: join(fixture, 'changes-flat-tree.png') })
  await changes.getByRole('button', { name: 'Hide file tree', exact: true }).click()
  console.log('ok - Changes scrolling preserves visited diff editors, and narrow file navigation becomes flat')
  for (let i = 0; i < 3; i++) {
    await check(true, true)
    await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await check(false, false)
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
    await check(true, true)
    assert(await page.evaluate(() => document.querySelector('.changes-tab') === window.__reopenReview))
  }
  console.log('ok - actual Changes review repeatedly reopens beside the terminal without losing its view')
  // Content and old panel-library layouts cannot expand the independent grid tracks.
  await page.evaluate(() => {
    localStorage.setItem(
      'ramu.layout.react-resizable-panels:task-columns:chat:editor:terminal-right',
      JSON.stringify({ chat: 9999, editor: 1, 'terminal-right': 1 }),
    )
    const probe = document.createElement('div')
    probe.style.width = '4000px'
    probe.style.height = '1px'
    probe.dataset.splitProbe = 'true'
    document.querySelector('.main-chat').appendChild(probe)
  })
  await check(true, true)
  for (const width of [1000, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await page.waitForTimeout(350)
    const bounds = await pane.evaluate((el) => {
      const body = el.querySelector('.task-body').getBoundingClientRect()
      return [...el.querySelectorAll('.main-chat, .editor-area, .terminal-panel')].map((view) => {
        const rect = view.getBoundingClientRect()
        return { width: rect.width, inside: rect.x >= body.x && rect.right <= body.right + 1 }
      })
    })
    assert(
      bounds.every((view) => view.inside && view.width > 100),
      'Compact windows keep all three panels inside the workspace',
    )
  }
  await page.evaluate(() => document.querySelector('[data-split-probe]').remove())
  const beforeReload = await check(true, true)
  await page.reload()
  await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await pane.locator('.changes-tab:visible .pair-review-bar').waitFor()
  await page.waitForTimeout(350)
  const restoredWidths = await pane.evaluate((el) =>
    ['.main-chat', '.editor-area', '.terminal-panel'].map(
      (selector) => el.querySelector(selector).getBoundingClientRect().width,
    ),
  )
  assert(Math.abs(restoredWidths[0] - beforeReload.chat.width) < 1)
  assert(Math.abs(restoredWidths[1] - beforeReload.editor.width) < 1)
  assert(Math.abs(restoredWidths[2] - beforeReload.terminal.width) < 1)
  console.log('ok - each split restores its own size after reload and ignores the old panel layout')
  console.log('ok - oversized chat content and compact windows cannot push panels out of the grid')
  await motionClick(page.getByRole('button', { name: 'Hide sidebar', exact: true }), 'ramu-panel-out-left')
  await page.waitForTimeout(350)
  assert(await page.getByRole('button', { name: 'Show sidebar', exact: true }).isVisible())
  assert((await page.locator('#workspace-sidebar').boundingBox()).width < 1)
  await motionClick(page.getByRole('button', { name: 'Show sidebar', exact: true }), 'ramu-panel-in-left')
  await page.waitForTimeout(350)
  assert((await page.locator('#workspace-sidebar').boundingBox()).width > 200)
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.waitForTimeout(350)
  assert((await page.locator('.workspace-tools').boundingBox()).width > 220)
  const toolsWidth = (await page.locator('.workspace-tools').boundingBox()).width
  await page.evaluate(() => {
    window.__cachedExplorer = document.querySelector('.workspace-tools .explorer-panel')
  })
  for (const name of ['Search', 'Source Control', 'Explorer']) {
    const switches = await page.evaluate(() => window.__panelMotions.length)
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(200)
    assert.equal(
      await page.evaluate(() => window.__panelMotions.length),
      switches,
      'Switching open tools does not animate',
    )
    assert(
      Math.abs((await page.locator('.workspace-tools').boundingBox()).width - toolsWidth) < 1,
      'Switching tools preserves the column width',
    )
    assert.equal(
      await page
        .locator('#shell > [data-panel]')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      '0s',
    )
  }
  assert(
    await page.evaluate(() => document.querySelector('.workspace-tools .explorer-panel') === window.__cachedExplorer),
    'Visited Explorer survives switching tools',
  )
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const searchPanel = page.locator('.search-panel:visible')
  await searchPanel.getByRole('textbox', { name: 'Search project files' }).fill('Layout fixture')
  await page.waitForFunction(() => document.querySelector('.search-summary')?.textContent.includes('60 results'))
  await searchPanel.getByRole('button', { name: 'Replace', exact: true }).click()
  await searchPanel.getByRole('textbox', { name: 'Replace with' }).fill('Cached fixture')
  const beforeReplacement = readFileSync(join(repo, 'docs', 'document-00.md'), 'utf8')
  await page.waitForFunction(
    () =>
      document.querySelector('.search-match-text del') &&
      document.querySelector('.search-match-text ins')?.textContent === 'Cached fixture',
  )
  assert.equal(
    await searchPanel
      .locator('.search-match-text del')
      .first()
      .textContent()
      .then((text) => text.toLowerCase()),
    'layout fixture',
    'Old matches are struck through in live replacement previews',
  )
  assert.equal(
    await searchPanel
      .locator('.search-match-text ins')
      .first()
      .evaluate((el) => getComputedStyle(el).marginLeft),
    '0px',
    'Replacement preview has no artificial space before the inserted text',
  )
  await searchPanel.getByRole('textbox', { name: 'Replace with' }).press('Enter')
  const replacementDialog = page.getByRole('alertdialog')
  await replacementDialog.waitFor()
  assert.equal(
    readFileSync(join(repo, 'docs', 'document-00.md'), 'utf8'),
    beforeReplacement,
    'Enter asks for confirmation before changing files',
  )
  await replacementDialog.getByRole('button', { name: 'Replace all', exact: true }).click()
  await replacementDialog.waitFor({ state: 'hidden' })
  assert.equal(
    readFileSync(join(repo, 'docs', 'document-00.md'), 'utf8'),
    beforeReplacement.replace(/Layout fixture/gi, 'Cached fixture'),
    'Search replacement writes reviewed content to disk',
  )
  await searchPanel.getByRole('textbox', { name: 'Search project files' }).fill('Cached fixture')
  await page.waitForFunction(() => document.querySelector('.search-summary')?.textContent.includes('60 results'))
  await page.evaluate(() => {
    window.__cachedSearch = document.querySelector('.search-panel')
  })
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('.workspace-tools').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  assert(
    await page.evaluate(() => document.querySelector('.search-panel') === window.__cachedSearch),
    'Closing and reopening Search preserves its DOM and results',
  )
  assert.equal(await searchPanel.getByRole('textbox', { name: 'Replace with' }).inputValue(), 'Cached fixture')
  assert((await searchPanel.locator('.search-summary').textContent()).includes('60 results'))
  const padding = await searchPanel.evaluate((el) => ({
    root: parseFloat(getComputedStyle(el).paddingLeft),
    controls: parseFloat(getComputedStyle(el.querySelector('.search-controls')).paddingLeft),
    header: parseFloat(getComputedStyle(el.querySelector('.search-title')).paddingTop),
  }))
  assert.equal(padding.root, 8)
  assert.equal(padding.controls, 0)
  assert.equal(padding.header, 0)
  writeFileSync(join(repo, 'replace-many.txt'), 'view-limit-fixture\n'.repeat(650))
  await searchPanel.getByRole('textbox', { name: 'Search project files' }).fill('view-limit-fixture')
  await page.waitForFunction(() => document.querySelector('.search-summary')?.textContent.includes('First 500 results'))
  await searchPanel.getByRole('textbox', { name: 'Replace with' }).fill('viaw-limit-fixture')
  const reviewMany = searchPanel.getByRole('button', { name: 'Replace all', exact: true })
  assert(await reviewMany.isEnabled(), 'Replacement remains available for truncated search results')
  await reviewMany.click()
  await replacementDialog.waitFor()
  assert(
    (await replacementDialog.textContent()).includes('650'),
    'Review includes all matches beyond the 500 displayed results',
  )
  await replacementDialog.getByRole('button', { name: 'Replace all', exact: true }).click()
  await replacementDialog.waitFor({ state: 'hidden' })
  assert.equal(
    readFileSync(join(repo, 'replace-many.txt'), 'utf8'),
    'viaw-limit-fixture\n'.repeat(650),
    'Replacement applies all 650 reviewed matches',
  )
  console.log('ok - full search replacement works beyond the 500 displayed matches')
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  assert(
    await page.evaluate(() => document.querySelector('.explorer-panel') === window.__cachedExplorer),
    'Explorer survives dock closing and reopening',
  )

  await page.evaluate(() => {
    window.__capturePanelMotion = true
  })
  await motionClick(
    page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }),
    'ramu-panel-out-right',
  )
  await page.screenshot({ path: join(fixture, 'tools-closing.png') })
  await resumeMotion()
  assert.equal(await page.locator('.workspace-tools:visible').count(), 0)
  // Dispatch faster than the capture callback can run. Each toggle must see the
  // preceding state change, and the final transition must clean up its scope.
  await pane.getByRole('tab').filter({ hasText: 'review.ts' }).first().click()
  await pane.locator('.view:visible .monaco-editor[role=code]').first().waitFor()
  await page.evaluate(() => {
    window.__reopenChat = document.querySelector('.task-pane .agent-view')
    window.__reopenEditor = document.querySelector('.task-pane .monaco-editor')
    window.__reopenTerminal = document.querySelector('.task-pane .terminal-host')
  })
  const rapidCount = await page.evaluate(() => window.__panelMotions.length)
  await page.evaluate(() => {
    const mac = navigator.userAgent.includes('Mac')
    for (let i = 0; i < 4; i++)
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'b',
          code: 'KeyB',
          metaKey: mac,
          ctrlKey: !mac,
          altKey: true,
          bubbles: true,
        }),
      )
  })
  await check(true, true)
  assert(await page.evaluate(() => document.querySelector('.task-pane .terminal-host') === window.__reopenTerminal))
  assert(
    (await page.evaluate(() => window.__panelMotions.length)) > rapidCount,
    'Rapid keyboard toggles animate the final state',
  )
  assert.equal(await page.evaluate(() => document.documentElement.dataset.panelMotion), undefined)
  assert.equal(await page.locator('.workspace-tools:visible').count(), 0)
  await page.evaluate(() => {
    const mac = navigator.userAgent.includes('Mac')
    for (let i = 0; i < 3; i++)
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'b',
          code: 'KeyB',
          metaKey: mac,
          ctrlKey: !mac,
          altKey: true,
          bubbles: true,
        }),
      )
  })
  await check(false, false)
  await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
  await check(true, true)
  // Overflow: wheel scrolls the strip without switching tabs; selection reveals itself.
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'docs', exact: true }).click()
  for (let i = 0; i < 8; i++) {
    await page
      .locator('.workspace-tools')
      .getByRole('button', { name: `document-${String(i).padStart(2, '0')}.md`, exact: true })
      .dblclick()
  }
  const strip = pane.getByRole('tablist', { name: 'Workspace tabs' })
  const activeVisible = () =>
    strip.evaluate((el) => {
      const tab = el.querySelector('[aria-selected="true"]').getBoundingClientRect()
      const bounds = el.getBoundingClientRect()
      return (
        (tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1) ||
        (tab.width > bounds.width && Math.abs(tab.left - bounds.left) < 1)
      )
    })
  assert(await activeVisible(), 'New tabs reveal themselves in the overflow strip')
  assert(await strip.evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollLeft > 0))
  const selected = await strip.locator('[aria-selected="true"]').textContent()
  const scrollbar = strip.locator('..').locator('[data-slot=scroll-area-scrollbar]')
  await strip.hover()
  await page.waitForTimeout(200)
  assert(
    await scrollbar.evaluate((el) => {
      const style = getComputedStyle(el)
      return style.position === 'absolute' && style.bottom === '0px' && style.opacity === '1'
    }),
    'Tab scrollbar floats at the bottom without consuming layout space',
  )
  assert.equal(await strip.evaluate((el) => el.clientHeight), 27, 'Overlay scrollbar preserves the tab row height')
  await page.screenshot({ path: join(fixture, 'tabs-overflow.png') })
  await strip.hover()
  await page.mouse.wheel(0, -2000)
  await page.waitForFunction(() => document.querySelector('.task-pane .view-tabs').scrollLeft === 0)
  assert.equal(
    await strip.locator('[aria-selected="true"]').textContent(),
    selected,
    'Wheel scrolling does not change the active editor',
  )
  await strip.locator('[role="tab"]').first().click()
  await strip.locator('[role="tab"]').first().focus()
  await page.keyboard.press('End')
  assert(await activeVisible(), 'Keyboard End selects and reveals the last tab')
  await page.keyboard.press('Home')

  assert(await activeVisible(), 'Keyboard Home selects and reveals the first tab')
  await strip.hover()
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, 80)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(200)
  assert.equal(
    await strip.locator('[role=tab]').nth(1).getAttribute('aria-selected'),
    'true',
    'Shift wheel activates the next file',
  )
  await strip.locator('[aria-selected=true]').focus()
  await page.keyboard.press('ArrowRight')
  assert(await activeVisible(), 'Arrow navigation reveals its selection')
  await strip.locator('[aria-selected="true"]').getByRole('button', { name: 'Close view' }).click()
  assert(await activeVisible(), 'Closing the active tab reveals its replacement')
  assert(await pane.getByRole('button', { name: 'Open file', exact: true }).isVisible())
  assert(await pane.getByRole('button', { name: 'Hide workspace', exact: true }).isVisible())
  // Sashes highlight after 300ms, and clear on leaving without resizing anything.
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(20, 20)
  const sash = pane.getByRole('separator', { name: 'Resize chat pane' })
  await sash.hover()
  assert.equal(await sash.evaluate((el) => getComputedStyle(el, '::before').opacity), '0')
  await page.waitForTimeout(450)
  assert.equal(await sash.evaluate((el) => getComputedStyle(el, '::before').opacity), '1')
  await page.mouse.move(20, 20)
  await page.waitForTimeout(150)
  assert.equal(await sash.evaluate((el) => getComputedStyle(el, '::before').opacity), '0')
  console.log('ok - tab overflow, wheel, keyboard, close replacement, fixed actions, and delayed sash hover')
  // Returning to a recent chat must render cached messages without a loading frame.
  await pane.locator('.agent-view:visible [data-composer-input]').fill('Draft survives switching chats')
  const otherTask = await api('tasks.create', { projectId: project.id, title: 'Other cached chat', mode: 'current' })
  await api('tasks.setup', otherTask.id)
  await api('agent.start', otherTask.id, 'Reply with a short greeting.', {
    provider: 'claude-code',
    model: 'fake-claude',
    effort: 'medium',
    access: 'full',
    autoFallback: false,
  })
  await page.locator('.task-row').filter({ hasText: 'Other cached chat' }).click()
  await pane.locator('.agent-view:visible .msg').first().waitFor()
  await page.evaluate(() => {
    window.__chatLoadingFrames = 0
    window.__chatLoaderObserver = new MutationObserver(() => {
      if (document.querySelector('.task-pane[data-panel-visible] .main-chat [data-slot="spinner"]'))
        window.__chatLoadingFrames++
    })
    window.__chatLoaderObserver.observe(document.querySelector('.shell'), { childList: true, subtree: true })
  })
  await page.locator('.task-row').filter({ hasText: 'Layout review' }).click()
  await pane.locator('.agent-view:visible .msg').first().waitFor()
  assert.equal(
    await page.evaluate(() => {
      window.__chatLoaderObserver.disconnect()
      return window.__chatLoadingFrames
    }),
    0,
    'Recent chat messages return without a loading placeholder',
  )
  assert.equal(
    await pane.locator('.agent-view:visible [data-composer-input]').getAttribute('data-draft'),
    'Draft survives switching chats',
    'A cached chat preserves its unsent composer draft',
  )
  console.log('ok - recent chats restore cached messages and unsent drafts while revalidating in the background')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await pane
      .locator('[data-workspace-split]')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  )
  const reducedCount = await page.evaluate(() => window.__panelMotions.length)
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.__panelMotions.length),
    reducedCount,
    'Reduced motion skips captures entirely',
  )
  assert.deepEqual(errors, [])
  console.log(
    'ok - live entry and snapshot exit animations only change opacity/transform, tool switches preserve width, and reduced motion skips captures',
  )
} finally {
  await api('background.stop').catch(() => {})
  await app.close()
}
