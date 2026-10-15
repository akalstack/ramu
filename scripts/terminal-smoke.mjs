// Exercise actual xterm keyboard input and layout against a disposable Electron profile.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const dir = mkdtempSync(join(tmpdir(), 'ramu-terminal-'))
const env = {
  ...process.env,
  RAMU_USER_DATA: join(dir, 'profile'),
  RAMU_WORKTREES: join(dir, 'worktrees'),
  RAMU_FAKE_AGENT: '1',
}
delete env.ELECTRON_RENDERER_URL
let app, page
const errors = []
try {
  app = await electron.launch({ args: [resolve(import.meta.dirname, '..', 'apps', 'desktop')], env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.shell')
  const api = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
  const task = await api('tasks.create', { projectId: 'no-project', title: 'Terminal regression', mode: 'current' })
  const ui = await api('ui.get')
  await api('ui.setTask', task.id, {
    views: [
      { id: 'terminal-one', kind: 'terminal' },
      { id: 'terminal-two', kind: 'terminal' },
    ],
    activeViewId: null,
    activeTerminalId: 'terminal-one',
    terminalOpen: true,
    terminalDock: 'bottom',
  })
  await api('ui.setWorkspace', { ...ui.workspace, openTaskIds: [task.id], activeTaskId: task.id })
  await page.reload()
  await page
    .locator('.task-row')
    .filter({ has: page.getByText(task.title, { exact: true }) })
    .click()
  await page.waitForSelector('.terminal-pane.focused .xterm-screen')
  await page.locator('.terminal-pane.focused .xterm-screen canvas:not(.xterm-link-layer)').waitFor()
  const input = page.locator('.terminal-pane.focused .xterm-helper-textarea')
  await page.locator('.terminal-pane.focused .xterm-screen').click()
  assert.equal(
    await input.evaluate((el) => document.activeElement === el),
    true,
    'Clicking the terminal focuses its input',
  )
  await page.keyboard.type("printf '\\162\\141\\155\\165-terminal-input\\n'")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document
      .querySelector('.terminal-pane.focused .xterm-accessibility-tree')
      ?.textContent.includes('ramu-terminal-input'),
  )
  console.log('ok - terminal accepts keyboard input')
  await page.getByRole('tab', { name: 'Workspace 2', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.matches('.terminal-pane.focused .xterm-helper-textarea'))
  assert.equal(
    await input.evaluate((el) => document.activeElement === el),
    true,
    'Switching groups keeps the terminal interactive',
  )
  await page.keyboard.type("printf '\\162\\141\\155\\165-second-input\\n'")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document
      .querySelector('.terminal-pane.focused .xterm-accessibility-tree')
      ?.textContent.includes('ramu-second-input'),
  )
  console.log('ok - terminal accepts input after switching groups')
  const checkLayout = async () => {
    await page.waitForFunction(() => {
      const host = document.querySelector('.terminal-pane.focused .terminal-host')
      const screen = host?.querySelector('.xterm-screen')
      if (!host || !screen) return false
      const outer = host.getBoundingClientRect(),
        inner = screen.getBoundingClientRect()
      return inner.bottom <= outer.bottom && inner.right <= outer.right
    })
    // Let docking's layout transition settle before checking for a resize loop.
    await page.locator('.terminal-pane.focused .terminal-host').evaluate(
      (el) =>
        new Promise((resolve, reject) => {
          let quiet
          const timeout = setTimeout(() => {
            clearTimeout(quiet)
            observer.disconnect()
            reject(new Error('Terminal never stops resizing'))
          }, 5000)
          const observer = new ResizeObserver(() => {
            clearTimeout(quiet)
            quiet = setTimeout(() => {
              clearTimeout(timeout)
              observer.disconnect()
              resolve()
            }, 200)
          })
          observer.observe(el)
        }),
    )
    const changes = await page.locator('.terminal-pane.focused .terminal-host').evaluate(
      (el) =>
        new Promise((resolve) => {
          let count = 0
          const observer = new ResizeObserver(() => count++)
          observer.observe(el)
          setTimeout(() => {
            observer.disconnect()
            resolve(count)
          }, 500)
        }),
    )
    assert.equal(changes, 1, 'Terminal geometry stays stable after fitting')
  }
  await checkLayout()
  await page.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await checkLayout()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').waitFor()
  await checkLayout()
  const shellSize = async (tag) => {
    await page.locator('.terminal-pane.focused .xterm-screen').click()
    await page.keyboard.type(`printf '\\n${tag}:%s\\n' "$(stty size)"`)
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      (tag) =>
        new RegExp(`${tag}:\\d+ \\d+`).test(
          document.querySelector('.terminal-pane.focused .xterm-accessibility-tree')?.textContent ?? '',
        ),
      tag,
    )
    return page.evaluate((tag) => {
      const match = document
        .querySelector('.terminal-pane.focused .xterm-accessibility-tree')
        .textContent.match(new RegExp(`${tag}:(\\d+) (\\d+)`))
      return { rows: Number(match[1]), cols: Number(match[2]) }
    }, tag)
  }
  const terminalDivider = page.getByRole('separator', { name: 'Resize terminal panel', exact: true })
  await terminalDivider.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await checkLayout()
  const beforeDrag = await shellSize('__BEFORE_DRAG__')
  const divider = await page.getByRole('separator', { name: 'Resize tools panel', exact: true }).boundingBox()
  const originalTools = await page.locator('.workspace-tools').boundingBox()
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x - 80, divider.y + divider.height / 2, { steps: 20 })
  assert.equal(
    (await page.locator('.workspace-tools').boundingBox()).width,
    originalTools.width,
    'Outer divider previews its size when the terminal would resize',
  )
  assert.notEqual(
    await page.locator('.terminal-pane.focused .xterm').evaluate((el) => getComputedStyle(el).display),
    'none',
    'Terminal keeps rendering while the divider preview moves',
  )
  assert(await page.locator('[data-separator-overlay="active"]').isVisible())
  await page.mouse.up()
  assert(
    (await page.locator('.workspace-tools').boundingBox()).width > originalTools.width,
    'Releasing the pointer applies the requested tools width',
  )
  await checkLayout()
  assert.equal(
    await page.locator('.terminal-pane.focused .terminal-host').evaluate((el) => getComputedStyle(el).visibility),
    'visible',
    'Terminal rendering resumes on release',
  )
  const afterDrag = await shellSize('__AFTER_DRAG__')
  assert(
    afterDrag.cols < beforeDrag.cols,
    'Shell receives the final narrower column count after dragging the tools divider',
  )
  assert.equal(afterDrag.rows, beforeDrag.rows, 'A horizontal tools drag preserves the shell row count')
  const terminalBefore = await page.locator('.terminal-pane.focused').boundingBox()
  const terminalAt = await terminalDivider.boundingBox()
  await page.mouse.move(terminalAt.x + terminalAt.width / 2, terminalAt.y + terminalAt.height / 2)
  await page.mouse.down()
  await page.mouse.move(terminalAt.x - 20, terminalAt.y + terminalAt.height / 2, { steps: 5 })
  assert.equal(
    (await page.locator('.terminal-pane.focused').boundingBox()).width,
    terminalBefore.width,
    'Terminal divider also previews without resizing its renderer',
  )
  assert(await page.locator('[data-workspace-divider-preview]:visible').isVisible())
  assert(
    await page.locator('.terminal-pane.focused .xterm-accessibility-tree').count(),
    'Accessibility stays active during preview',
  )
  await page.mouse.up()
  await checkLayout()
  assert(
    (await page.locator('.terminal-pane.focused').boundingBox()).width > terminalBefore.width,
    'Terminal divider commits its width on release',
  )
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await checkLayout()
  console.log('ok - tools divider resizes the terminal and delivers the final shell dimensions')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720))
  await checkLayout()
  await page.getByRole('button', { name: 'Terminal layout', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Split side by side', exact: true }).click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.terminal-pane')].filter((el) => el.getBoundingClientRect().width > 0).length ===
      2,
  )
  await checkLayout()
  await page.locator('.terminal-pane.focused .terminal-host').click({ position: { x: 2, y: 2 } })
  assert.equal(
    await input.evaluate((el) => document.activeElement === el),
    true,
    'Clicking terminal padding focuses input',
  )
  await page.keyboard.type("printf '\\162\\141\\155\\165-split-input\\n'")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document
      .querySelector('.terminal-pane.focused .xterm-accessibility-tree')
      ?.textContent.includes('ramu-split-input'),
  )
  console.log('ok - docking, window resizing, and split panes keep stable geometry and working input')
  await page.locator('.terminal-pane.focused .xterm-screen canvas:not(.xterm-link-layer)').waitFor()
  await page.evaluate(() => {
    const canvas = document.querySelector('.terminal-pane.focused .xterm-screen canvas:not(.xterm-link-layer)')
    canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
  })
  await page.locator('.terminal-pane.focused .xterm-rows').waitFor()
  await page.locator('.terminal-pane.focused .xterm-screen').click()
  await page.keyboard.type("printf '\\162\\141\\155\\165-gpu-fallback\\n'")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document
      .querySelector('.terminal-pane.focused .xterm-accessibility-tree')
      ?.textContent.includes('ramu-gpu-fallback'),
  )
  console.log('ok - GPU context loss falls back to DOM rendering without losing the shell or keyboard input')
  assert.deepEqual(errors, [])
} finally {
  if (page) await page.evaluate(() => window.ramu.invoke('background.stop')).catch(() => {})
  await app?.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}
