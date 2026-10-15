// Panel behaviour in the task pane: reopening keeps the chat, editor, terminal and review mounted at their saved sizes,
// tools keep their state while switching, Search replaces across more matches than it displays, the tab strip scrolls,
// and a recent chat comes back from cache. Sizes and docking live in layout.spec.mjs.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeAgent, modifier, showChat, startChat, startRamu } from '../support/index.mjs'

const files = { 'review.ts': 'export const value = 1\n' }
for (let i = 0; i < 60; i++) files[`docs/document-${String(i).padStart(2, '0')}.md`] = '# Layout fixture\n'
const ramu = await startRamu('panels', { repos: { project: files } })
const { page } = ramu
const repo = ramu.repos.project
const pane = page.locator('.task-pane:visible')
const tools = page.locator('.workspace-tools')
const toolButton = (name) => page.locator('.workspace-tool-buttons').getByRole('button', { name, exact: true })
const toolsClose = tools.getByRole('button', { name: /^Hide / })
const hideWorkspace = () => page.getByRole('button', { name: 'Hide workspace', exact: true }).click()
const showWorkspace = () => page.getByRole('button', { name: 'Show workspace', exact: true }).click()
const handle = () => pane.getByRole('separator', { name: 'Resize chat pane' })
/** Marks the live element so a later `same()` proves it was never remounted. */
const mark = (selector, key) =>
  page.evaluate(([selector, key]) => (window[key] = document.querySelector(selector)), [selector, key])
const same = (selector, key) =>
  page.evaluate(([selector, key]) => document.querySelector(selector) === window[key], [selector, key])

/** Chat, editor and review rectangles inside the task body. */
const rects = () =>
  pane.evaluate((el) => {
    const rect = (selector) => {
      const r = el.querySelector(selector)?.getBoundingClientRect()
      return r ? { x: r.x, right: r.right, width: r.width } : null
    }
    return {
      body: rect('.task-body'),
      chat: rect('.main-chat'),
      editor: rect('.editor-area'),
      group: rect('.task-body [data-workspace-split]'),
    }
  })

/** Panes ease their size; waits until the chat (and the editor) sit inside the body, then returns the settled geometry. */
async function inside({ editor }) {
  let last
  await ramu.until(
    async () => {
      const now = await rects()
      const stable = last && Math.abs(now.chat.width - last.chat.width) < 0.5
      last = now
      return (
        stable &&
        Math.abs(now.body.width - now.group.width) < 1 &&
        now.chat.width >= 300 &&
        now.chat.right <= now.body.right + 1 &&
        (!editor || (now.editor.width >= 230 && now.editor.right <= now.body.right + 1 && now.editor.x >= now.chat.right - 1))
      )
    },
    `panels did not settle inside the workspace (editor: ${editor})`,
    { interval: 150 },
  )
  return last
}

let task, session

ramu.test('opening a file and reopening the workspace keeps the chat and editor mounted', async () => {
  const { project } = await ramu.api('projects.addFolder', repo)
  task = await ramu.api('tasks.create', { projectId: project.id, title: 'Panels', mode: 'current' })
  await ramu.api('tasks.setup', task.id)
  session = await ramu.api('agent.start', task.id, 'Reply with a short greeting.', fakeAgent.claude)
  await ramu.until(async () => (await ramu.api('agent.get', session.id)).state === 'idle', 'chat never became idle')
  await showChat(ramu, { task, session })
  await pane.locator('.agent-view:visible').waitFor()

  await toolButton('Explorer').click()
  await tools.getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.locator('.monaco-editor[role=code]').first().waitFor()
  await toolsClose.click()
  await mark('.task-pane .agent-view', '__reopenChat')
  await mark('.task-pane .monaco-editor', '__reopenEditor')

  await handle().focus()
  await page.keyboard.press('ArrowLeft')
  const beforeDrag = await inside({ editor: true })
  const divider = await handle().boundingBox()
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x + divider.width / 2 + 40, divider.y + divider.height / 2, { steps: 4 })
  assert.ok(
    Math.abs((await pane.locator('.main-chat').boundingBox()).width - beforeDrag.chat.width - 40) < 1,
    'chat resizes in real time while dragging',
  )
  await page.mouse.up()
  const saved = await inside({ editor: true })
  assert.ok(Math.abs(saved.chat.width - beforeDrag.chat.width - 40) < 1, 'the drag moved the chat by the pointer distance')
  assert.equal(
    await pane
      .locator('[data-workspace-split]')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
    'a settled split has no layout animation',
  )
  assert.ok(
    await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return style.getPropertyValue('--pane-border-active') === style.getPropertyValue('--accent')
    }),
    'the divider highlight follows the accent colour',
  )

  // A cancelled drag keeps the last displayed size and leaves nothing dragging.
  const start = await handle().boundingBox()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x - 60, start.y + start.height / 2)
  const cancelled = (await pane.locator('.main-chat').boundingBox()).width
  await handle().dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  assert.ok(Math.abs((await pane.locator('.main-chat').boundingBox()).width - cancelled) < 1, 'cancel keeps the size')
  assert.equal(await pane.locator('[data-workspace-split][data-dragging]').count(), 0, 'nothing is left dragging')
  const wide = await inside({ editor: true })

  for (let i = 0; i < 3; i++) {
    await hideWorkspace()
    await ramu.until(
      async () => {
        const now = await rects()
        return Math.abs(now.chat.width - now.body.width) < 1
      },
      'hiding the workspace did not restore the full chat',
    )
    assert.equal(await pane.locator('.editor-area').evaluate((el) => getComputedStyle(el).visibility), 'hidden')
    await showWorkspace()
    const restored = await inside({ editor: true })
    assert.ok(Math.abs(restored.chat.width - wide.chat.width) < 1, 'the editor split restores the resized chat')
  }
  assert.ok(await same('.task-pane .agent-view', '__reopenChat'), 'the chat was never remounted')
  assert.ok(await same('.task-pane .monaco-editor', '__reopenEditor'), 'the editor was never remounted')
  ramu.noErrors()
})

ramu.test('the terminal panel and workspace toggles keep the shell mounted beside the editor', async () => {
  await toolButton('Terminal').click()
  await pane.locator('.terminal-panel:visible').waitFor()
  const border = await pane.locator('.terminal-panel').evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      top: style.borderTopWidth,
      left: style.borderLeftWidth,
      right: style.borderRightWidth,
      radius: style.borderTopLeftRadius,
    }
  })
  assert.deepEqual(
    border,
    { top: '0px', left: '0px', right: '0px', radius: '0px' },
    'the split divider is the only terminal edge',
  )
  await mark('.task-pane .terminal-host', '__reopenTerminal')
  for (let i = 0; i < 3; i++) {
    await pane.getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
    await pane.locator('.terminal-panel:visible').waitFor({ state: 'detached' })
    await inside({ editor: true })
    await toolButton('Terminal').click()
    await pane.locator('.terminal-panel:visible').waitFor()
    await hideWorkspace()
    await inside({ editor: false })
    await showWorkspace()
    await inside({ editor: true })
    assert.ok(await same('.task-pane .terminal-host', '__reopenTerminal'), 'the shell was remounted')
  }
  await pane.getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
  ramu.noErrors()
})

ramu.test('Changes keeps visited diff editors while scrolling and falls back to a flat file list when narrow', async () => {
  // Files edited while a (slow) run is working are captured as its review.
  await ramu.api('agent.send', session.id, 'Capture a layout review [slow]')
  await ramu.until(async () => (await ramu.api('agent.get', session.id)).state === 'running', 'the run never started')
  writeFileSync(join(repo, 'review.ts'), 'export const value = 2\n')
  for (let i = 0; i < 12; i++)
    writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Updated layout fixture\n')
  await ramu.until(
    async () => (await ramu.api('reviews.list', session.id)).some((r) => r.state === 'ready' && r.files.length),
    'the run never captured a review',
  )
  await pane.getByRole('button', { name: 'View changes', exact: true }).last().click()
  const changes = pane.locator('.changes-tab:visible')
  await changes.locator('.pair-review-bar').waitFor()
  assert.ok(
    await pane.locator('.workspace-tab-toolbar').evaluate((el) => {
      const toolbar = el.getBoundingClientRect()
      const tab = el.querySelector('[role="tab"][aria-selected="true"]').getBoundingClientRect()
      return tab.top - toolbar.top >= 5 && toolbar.bottom - tab.bottom >= 5
    }),
    'tabs have space above and below instead of touching the toolbar edge',
  )
  await changes.locator('.review-diff .monaco-diff-editor').first().waitFor()
  await mark('.changes-tab', '__reopenReview')
  await mark('.changes-tab .review-diff .monaco-diff-editor', '__firstReviewEditor')

  await changes.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await ramu.until(() => changes.evaluate((el) => el.scrollTop > 0), 'the review did not scroll')
  assert.ok(await page.evaluate(() => window.__firstReviewEditor.isConnected), 'scrolling past a diff destroys its editor')
  await changes.evaluate((el) => (el.scrollTop = 0))
  await ramu.until(() => changes.evaluate((el) => el.scrollTop === 0), 'the review did not scroll back')
  assert.ok(
    await same('.changes-tab .review-diff .monaco-diff-editor', '__firstReviewEditor'),
    'returning to a diff rebuilt its editor',
  )

  await handle().focus()
  await page.keyboard.press('End')
  await changes.getByRole('button', { name: 'Show file tree', exact: true }).click()
  await changes.locator('.review-tree[data-flat]').waitFor()
  assert.equal(await changes.locator('.review-tree-row.dir').count(), 0, 'a narrow navigator is a flat list')
  await changes.locator('.review-tree').getByRole('button', { name: 'document-00.md' }).waitFor()
  await changes.getByRole('button', { name: 'Hide file tree', exact: true }).click()

  for (let i = 0; i < 3; i++) {
    await hideWorkspace()
    await inside({ editor: false })
    await showWorkspace()
    await inside({ editor: true })
    assert.ok(await same('.changes-tab', '__reopenReview'), 'the review was remounted')
  }
  ramu.noErrors()
})

ramu.test('oversized chat content and compact windows cannot push panels out of the grid', async () => {
  await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'width:4000px;height:1px'
    probe.dataset.splitProbe = 'true'
    document.querySelector('.main-chat').appendChild(probe)
  })
  await inside({ editor: true })
  for (const width of [1000, 1440]) {
    await ramu.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await ramu.until(
      async () => {
        const views = await pane.evaluate((el) => {
          const body = el.querySelector('.task-body').getBoundingClientRect()
          return [...el.querySelectorAll('.main-chat, .editor-area, .changes-tab:not([hidden])')]
            .filter((view) => view.getClientRects().length)
            .map((view) => {
              const rect = view.getBoundingClientRect()
              return { width: rect.width, inside: rect.x >= body.x - 1 && rect.right <= body.right + 1 }
            })
        })
        return views.length > 0 && views.every((view) => view.inside && view.width > 100)
      },
      `the panels spilled out of the workspace at ${width}px`,
    )
  }
  await page.evaluate(() => document.querySelector('[data-split-probe]').remove())
  const before = await inside({ editor: true })
  await ramu.reload()
  await page.locator('.task-row').first().click()
  await pane.locator('.changes-tab:visible .pair-review-bar').waitFor()
  const after = await inside({ editor: true })
  assert.ok(Math.abs(after.chat.width - before.chat.width) < 1, 'the chat width was not restored after reload')
})

ramu.test('switching tools keeps the rail width and each tool mounted; Search replaces beyond its 500 shown matches', async () => {
  await mark('.task-pane .agent-view', '__reopenChat')
  await toolButton('Explorer').click()
  await tools.waitFor()
  const toolsWidth = (await tools.boundingBox()).width
  assert.ok(toolsWidth > 220, 'the rail opens at a usable width')
  await mark('.workspace-tools .explorer-panel', '__cachedExplorer')
  for (const name of ['Search', 'Source Control', 'Explorer']) {
    await toolButton(name).click()
    await ramu.until(async () => Math.abs((await tools.boundingBox()).width - toolsWidth) < 1, `${name} changed the rail width`)
    assert.equal(
      await page
        .locator('#shell > [data-panel]')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      '0s',
      'switching tools has no layout animation',
    )
  }
  assert.ok(await same('.workspace-tools .explorer-panel', '__cachedExplorer'), 'a visited Explorer was remounted')

  await toolButton('Search').click()
  const search = page.locator('.search-panel:visible')
  const query = search.getByRole('textbox', { name: 'Search project files' })
  const replacement = search.getByRole('textbox', { name: 'Replace with' })
  await query.fill('Layout fixture')
  await search.locator('.search-summary', { hasText: '60 results' }).waitFor()
  await search.getByRole('button', { name: 'Replace', exact: true }).click()
  await replacement.fill('Cached fixture')
  const first = join(repo, 'docs', 'document-00.md')
  const before = readFileSync(first, 'utf8')
  await search.locator('.search-match-text ins', { hasText: 'Cached fixture' }).first().waitFor()
  assert.equal(
    (await search.locator('.search-match-text del').first().textContent()).toLowerCase(),
    'layout fixture',
    'old matches are struck through in the live preview',
  )
  assert.equal(
    await search.locator('.search-match-text ins').first().evaluate((el) => getComputedStyle(el).marginLeft),
    '0px',
    'the preview has no artificial space before the inserted text',
  )
  await replacement.press('Enter')
  const confirm = page.getByRole('alertdialog')
  await confirm.waitFor()
  assert.equal(readFileSync(first, 'utf8'), before, 'Enter asks before changing files')
  await confirm.getByRole('button', { name: 'Replace all', exact: true }).click()
  await confirm.waitFor({ state: 'hidden' })
  await ramu.until(
    () => readFileSync(first, 'utf8') === before.replace(/Layout fixture/gi, 'Cached fixture'),
    'the replacement never reached disk',
  )
  await query.fill('Cached fixture')
  await search.locator('.search-summary', { hasText: '60 results' }).waitFor()
  // The rail itself exists only while open, so its panels are remounted; their state must survive.
  await toolsClose.click()
  await tools.waitFor({ state: 'hidden' })
  await toolButton('Search').click()
  await search.waitFor()
  assert.equal(await query.inputValue(), 'Cached fixture', 'the query was lost')
  await search.getByRole('button', { name: 'Replace', exact: true }).click()
  assert.equal(await replacement.inputValue(), '', 'a stale replacement text stays armed after the rail closes')
  await search.locator('.search-summary', { hasText: '60 results' }).waitFor()
  const padding = await search.evaluate((el) => ({
    root: parseFloat(getComputedStyle(el).paddingLeft),
    controls: parseFloat(getComputedStyle(el.querySelector('.search-controls')).paddingLeft),
    header: parseFloat(getComputedStyle(el.querySelector('.search-title')).paddingTop),
  }))
  assert.deepEqual(padding, { root: 8, controls: 0, header: 0 }, 'Search keeps its padding')

  writeFileSync(join(repo, 'replace-many.txt'), 'view-limit-fixture\n'.repeat(650))
  await query.fill('view-limit-fixture')
  await search.locator('.search-summary', { hasText: 'First 500 results' }).waitFor()
  await replacement.fill('viaw-limit-fixture')
  const replaceAll = search.getByRole('button', { name: 'Replace all', exact: true })
  assert.ok(await replaceAll.isEnabled(), 'replacing stays available for truncated results')
  await replaceAll.click()
  await confirm.waitFor()
  assert.ok((await confirm.textContent()).includes('650'), 'the review counts matches beyond the 500 shown')
  await confirm.getByRole('button', { name: 'Replace all', exact: true }).click()
  await confirm.waitFor({ state: 'hidden' })
  await ramu.until(
    () => readFileSync(join(repo, 'replace-many.txt'), 'utf8') === 'viaw-limit-fixture\n'.repeat(650),
    'not all 650 matches were replaced',
  )
  await toolButton('Explorer').click()
  await tools.locator('.explorer-panel').waitFor()
  await toolsClose.click()
  await tools.waitFor({ state: 'hidden' })
  assert.ok(await same('.task-pane .agent-view', '__reopenChat'), 'the chat was remounted')
  ramu.noErrors()
})

ramu.test('rapid workspace shortcuts settle on the final state', async () => {
  await pane.getByRole('tab').filter({ hasText: 'review.ts' }).first().click()
  await pane.locator('.view:visible .monaco-editor[role=code]').first().waitFor()
  await mark('.task-pane .agent-view', '__reopenChat')
  await mark('.task-pane .monaco-editor', '__reopenEditor')
  const toggle = async (times) => {
    for (let i = 0; i < times; i++) await page.keyboard.press(`${modifier}+Alt+b`)
  }
  await toggle(4)
  await inside({ editor: true })
  await toggle(3)
  await inside({ editor: false })
  await showWorkspace()
  await inside({ editor: true })
  assert.ok(await same('.task-pane .agent-view', '__reopenChat'), 'the chat was remounted')
  assert.ok(await same('.task-pane .monaco-editor', '__reopenEditor'), 'the editor was remounted')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.panelMotion), undefined)
})

ramu.test('the tab strip scrolls without switching files, reveals selections and delays the sash highlight', async () => {
  await toolButton('Explorer').click()
  await tools.getByRole('button', { name: 'docs', exact: true }).click()
  for (let i = 0; i < 8; i++)
    await tools
      .getByRole('button', { name: `document-${String(i).padStart(2, '0')}.md`, exact: true })
      .dblclick()
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
  const revealed = (message) => ramu.until(activeVisible, message)
  await revealed('new tabs did not reveal themselves in the overflow strip')
  assert.ok(await strip.evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollLeft > 0))
  const selected = await strip.locator('[aria-selected="true"]').textContent()
  const scrollbar = strip.locator('..').locator('[data-slot=scroll-area-scrollbar]')
  await strip.hover()
  await ramu.until(
    () =>
      scrollbar.evaluate((el) => {
        const style = getComputedStyle(el)
        return style.position === 'absolute' && style.bottom === '0px' && style.opacity === '1'
      }),
    'the tab scrollbar does not float at the bottom',
  )
  assert.equal(await strip.evaluate((el) => el.clientHeight), 27, 'the overlay scrollbar keeps the tab row height')
  await page.mouse.wheel(0, -2000)
  await ramu.until(() => pane.locator('.view-tabs').evaluate((el) => el.scrollLeft === 0), 'the wheel did not scroll the strip')
  assert.equal(await strip.locator('[aria-selected="true"]').textContent(), selected, 'the wheel switched files')

  const first = strip.locator('[role="tab"]').first()
  await first.click()
  await first.focus()
  await page.keyboard.press('End')
  await revealed('End did not reveal the last tab')
  await page.keyboard.press('Home')
  await revealed('Home did not reveal the first tab')
  await strip.hover()
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, 80)
  await page.keyboard.up('Shift')
  await ramu.until(
    async () => (await strip.locator('[role=tab]').nth(1).getAttribute('aria-selected')) === 'true',
    'Shift + wheel did not activate the next file',
  )
  await strip.locator('[aria-selected=true]').focus()
  await page.keyboard.press('ArrowRight')
  await revealed('arrow navigation did not reveal its selection')
  await strip.locator('[aria-selected="true"]').getByRole('button', { name: 'Close view' }).click()
  await revealed('closing the active tab did not reveal its replacement')
  await pane.getByRole('button', { name: 'New tab', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Hide workspace', exact: true }).waitFor()

  // The sash highlights only after a short hover, and clears on leaving without resizing anything.
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(20, 20)
  const sash = handle()
  const highlight = () => sash.evaluate((el) => getComputedStyle(el, '::before').opacity)
  await sash.hover()
  assert.equal(await highlight(), '0', 'the sash highlights immediately')
  await ramu.until(async () => (await highlight()) === '1', 'the sash never highlighted')
  await page.mouse.move(20, 20)
  await ramu.until(async () => (await highlight()) === '0', 'the sash highlight never cleared')
  ramu.noErrors()
})

ramu.test('a recent chat returns from cache without a loading frame and keeps its unsent draft', async () => {
  await pane.locator('.agent-view:visible [data-composer-input]').fill('Draft survives switching chats')
  await startChat(ramu, {
    projectId: task.projectId,
    title: 'Other cached chat',
    prompt: 'Reply with a short greeting.',
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
  await page.locator('.task-row').filter({ hasText: 'Panels' }).click()
  await pane.locator('.agent-view:visible .msg').first().waitFor()
  assert.equal(
    await page.evaluate(() => {
      window.__chatLoaderObserver.disconnect()
      return window.__chatLoadingFrames
    }),
    0,
    'recent chat messages come back with a loading placeholder',
  )
  assert.equal(
    await pane.locator('.agent-view:visible [data-composer-input]').getAttribute('data-draft'),
    'Draft survives switching chats',
  )
})

ramu.test('reduced motion removes pane transitions', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const split = pane.locator('[data-workspace-split]').first()
  assert.equal(await split.evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  const chatShare = async () => {
    const { chat, body } = await rects()
    return Math.round((chat.width / body.width) * 100)
  }
  await page.keyboard.press(`${modifier}+Alt+b`)
  await ramu.until(async () => (await chatShare()) === 100, 'the workspace did not hide')
  // With reduced motion the pane lands in one step, so no transition is ever set on it.
  assert.equal(await split.evaluate((el) => el.style.transition), '')
  await page.keyboard.press(`${modifier}+Alt+b`)
  await ramu.until(async () => (await chatShare()) < 100, 'the workspace did not show')
  assert.equal(await split.evaluate((el) => el.style.transition), '')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  ramu.noErrors()
})
