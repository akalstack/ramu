// xterm UI: real keyboard input, focus, geometry stability while docking/resizing/splitting, and the DOM fallback
// after GPU context loss. (PTY output from the native `term.open` API is covered by the automation spec.)
import assert from 'node:assert/strict'
import { showTask, startRamu } from '../support/index.mjs'

const ramu = await startRamu('terminal')
const { page } = ramu
const pane = '.terminal-pane.focused'
const screen = `${pane} .xterm-screen`
const canvas = `${screen} canvas:not(.xterm-link-layer)`
const textarea = page.locator(`${pane} .xterm-helper-textarea`)
const isFocused = () => textarea.evaluate((el) => document.activeElement === el)
const bound = async (selector) =>
  (await page.locator(selector).boundingBox()) ?? assert.fail(`${selector} is not laid out`)

/** Types a printf that prints `marker` (spelled in octal so the echoed command line cannot match) and waits for it. */
async function typeMarker(marker) {
  const octal = [...marker].map((c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`).join('')
  await page.keyboard.type(`printf '${octal}\\n'`)
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    ([selector, text]) => document.querySelector(selector)?.textContent.includes(text),
    [`${pane} .xterm-accessibility-tree`, marker],
  )
}

/** Waits until the focused terminal fits its host and has stopped resizing, then asserts it stays stable. */
async function settled() {
  await page.waitForFunction(() => {
    const host = document.querySelector('.terminal-pane.focused .terminal-host')
    const inner = host?.querySelector('.xterm-screen')
    if (!host || !inner) return false
    const outer = host.getBoundingClientRect()
    const box = inner.getBoundingClientRect()
    return box.bottom <= outer.bottom && box.right <= outer.right
  })
  // Let docking's layout transition settle before counting resizes.
  await page.locator(`${pane} .terminal-host`).evaluate(
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
  const changes = await page.locator(`${pane} .terminal-host`).evaluate(
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
  // A ResizeObserver reports once on observe(); anything more is a resize loop.
  assert.equal(changes, 1, 'Terminal geometry stays stable after fitting')
}

/** The shell's own idea of its size, so we know the PTY received the final dimensions. */
async function shellSize(tag) {
  await page.locator(screen).click()
  await page.keyboard.type(`printf '\\n${tag}:%s\\n' "$(stty size)"`)
  await page.keyboard.press('Enter')
  const pattern = new RegExp(`${tag}:(\\d+) (\\d+)`)
  await page.waitForFunction(
    ([selector, source]) => new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''),
    [`${pane} .xterm-accessibility-tree`, pattern.source],
  )
  const text = await page.locator(`${pane} .xterm-accessibility-tree`).textContent()
  const [, rows, cols] = text.match(pattern)
  return { rows: Number(rows), cols: Number(cols) }
}

ramu.test('terminal accepts keyboard input', async () => {
  const task = await ramu.api('tasks.create', {
    projectId: 'no-project',
    title: 'Terminal regression',
    mode: 'current',
  })
  await showTask(ramu, task, {
    views: [
      { id: 'terminal-one', kind: 'terminal' },
      { id: 'terminal-two', kind: 'terminal' },
    ],
    activeViewId: null,
    activeTerminalId: 'terminal-one',
    terminalOpen: true,
    terminalDock: 'bottom',
  })
  await page.locator(screen).waitFor()
  await page.locator(canvas).waitFor()
  await page.locator(screen).click()
  ramu.check(await isFocused(), 'clicking the terminal focuses its input')
  await typeMarker('ramu-terminal-input')
  ramu.check(true, 'terminal accepts keyboard input')
})

ramu.test('terminal stays interactive after switching groups', async () => {
  // Focus stays on the tab so arrow keys keep switching groups; clicking the terminal moves it in.
  await page.getByRole('tab', { name: 'Workspace 2', exact: true }).click()
  await page.locator(screen).click()
  await page.waitForFunction(() => document.activeElement?.matches('.terminal-pane.focused .xterm-helper-textarea'))
  ramu.check(await isFocused(), 'switching groups and clicking the terminal focuses its input')
  await typeMarker('ramu-second-input')
  await settled()
  ramu.check(true, 'terminal geometry is stable in the bottom dock')
})

ramu.test('docking and the tools rail keep geometry stable and the PTY size consistent', async () => {
  await page.getByRole('button', { name: 'Move terminal to workspace tabs', exact: true }).click()
  await settled()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').waitFor()
  await settled()

  const terminalDivider = page.getByRole('separator', { name: 'Resize terminal panel', exact: true })
  await terminalDivider.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await settled()
  const beforeDrag = await shellSize('__BEFORE_DRAG__')

  // The tools rail resizes live; the terminal must keep rendering while it moves.
  const divider = await bound('[role=separator][aria-label="Resize tools panel"]')
  const originalTools = await bound('.workspace-tools')
  const terminalBeforeRail = await bound(pane)
  const chatBeforeRail = await bound('.main-chat')
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x - 80, divider.y + divider.height / 2, { steps: 20 })
  assert.notEqual(
    await page.locator(`${pane} .xterm`).evaluate((el) => getComputedStyle(el).display),
    'none',
    'Terminal keeps rendering while the divider moves',
  )
  await page.mouse.up()
  assert.ok(
    (await bound('.workspace-tools')).width > originalTools.width,
    'Releasing applies the requested tools width',
  )
  await settled()
  assert.equal(
    await page.locator(`${pane} .terminal-host`).evaluate((el) => getComputedStyle(el).visibility),
    'visible',
    'Terminal rendering resumes on release',
  )
  // Workspace tabs share the editor split. At the chat minimum, the terminal yields space to the tools rail.
  assert.ok((await bound('.main-chat')).width <= chatBeforeRail.width + 1, 'Thread does not grow with the tools rail')
  assert.ok(
    (await bound(pane)).width <= terminalBeforeRail.width + 1,
    'Terminal stays within the available workspace width',
  )
  const afterDrag = await shellSize('__AFTER_DRAG__')
  assert.equal(afterDrag.rows, beforeDrag.rows, 'A tools-rail drag preserves shell height')
  assert.ok(afterDrag.cols > 0 && afterDrag.cols <= beforeDrag.cols, 'PTY columns fit the available width')

  // The terminal's own divider previews without resizing the renderer, then commits on release.
  const terminalBefore = await bound(pane)
  const terminalAt = await terminalDivider.boundingBox()
  await page.mouse.move(terminalAt.x + terminalAt.width / 2, terminalAt.y + terminalAt.height / 2)
  await page.mouse.down()
  await page.mouse.move(terminalAt.x + 40, terminalAt.y + terminalAt.height / 2, { steps: 5 })
  assert.equal(
    (await bound(pane)).width,
    terminalBefore.width,
    'Terminal divider previews without resizing its renderer',
  )
  assert.ok(await page.locator('[data-workspace-divider-preview]:visible').isVisible())
  assert.ok(
    await page.locator(`${pane} .xterm-accessibility-tree`).count(),
    'Accessibility stays active during preview',
  )
  await page.mouse.up()
  await settled()
  assert.ok((await bound(pane)).width < terminalBefore.width, 'Terminal divider commits its width on release')

  await page.getByRole('button', { name: 'Hide Explorer', exact: true }).click()
  await settled()
  ramu.check(true, 'tools rail and workspace divider keep terminal geometry and PTY size consistent')
})

ramu.test('window resizing and split panes keep stable geometry and working input', async () => {
  await ramu.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720))
  await settled()
  await page.getByRole('button', { name: 'Split side by side', exact: true }).click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.terminal-pane')].filter((el) => el.getBoundingClientRect().width > 0).length ===
      2,
  )
  await settled()
  await page.locator(`${pane} .terminal-host`).click({ position: { x: 2, y: 2 } })
  ramu.check(await isFocused(), 'clicking terminal padding focuses input')
  await typeMarker('ramu-split-input')
  ramu.check(true, 'docking, window resizing, and split panes keep stable geometry and working input')
})

// WebGL needs a real GPU process; if the hidden window has no canvas, this step is skipped rather than weakened.
ramu.test('GPU context loss falls back to DOM rendering without losing the shell', async () => {
  if (!(await page.locator(canvas).count()))
    return ramu.check(true, 'no GPU canvas in this environment; DOM renderer already active')
  await page.evaluate((selector) => {
    document.querySelector(selector).getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
  }, canvas)
  await page.locator(`${pane} .xterm-rows`).waitFor()
  await page.locator(screen).click()
  await typeMarker('ramu-gpu-fallback')
  ramu.check(true, 'GPU context loss falls back to DOM rendering without losing the shell or keyboard input')
  ramu.noErrors()
})
