// Frame-time probe for pane drags, tool/sidebar/terminal toggles and window resizes, on a long chat with an open editor.
// Reports frames, average, p95 and slow frames per interaction. Informational unless RAMU_FPS_BUDGET_MS is set, then a p95
// above it fails. Numbers are far more representative with RAMU_E2E_HEADED=1. On demand: `pnpm test:e2e:perf fps`.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeAgent, startRamu } from '../support/index.mjs'

const budget = Number(process.env.RAMU_FPS_BUDGET_MS ?? 0)
const files = { 'review.ts': Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i}`).join('\n') + '\n' }
for (let i = 0; i < 80; i++) files[`file-${String(i).padStart(2, '0')}.md`] = '# Fixture\n'
const ramu = await startRamu('fps', { repos: { project: files } })
const { page } = ramu
const pane = page.locator('.task-pane:visible')
const tools = page.locator('.workspace-tools')
const results = []

/** Runs `run` while recording every animation frame, and reports how long they took. */
async function sample(name, run) {
  await page.evaluate(() => {
    const frames = []
    let last = performance.now()
    let live = true
    let layouts = 0
    const observer = new ResizeObserver(() => layouts++)
    document.querySelectorAll('.main, .main-chat, .editor-area, .terminal-panel').forEach((el) => observer.observe(el))
    const tick = (now) => {
      frames.push(now - last)
      last = now
      if (live) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.__fps = () => {
      live = false
      observer.disconnect()
      return { frames, layouts }
    }
  })
  await run()
  const measured = await page.evaluate(() => window.__fps())
  const frames = measured.frames.slice(1)
  const sorted = [...frames].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  const row = {
    name,
    layouts: measured.layouts,
    frames: frames.length,
    avg: +(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +at(1).toFixed(1),
    slow: frames.filter((ms) => ms > 25).length,
  }
  results.push(row)
  console.log(
    `${name.padEnd(34)} frames ${String(row.frames).padStart(4)}  avg ${row.avg}ms  p95 ${row.p95}ms  max ${row.max}ms  >25ms: ${row.slow}  layouts: ${row.layouts}`,
  )
}

const center = async (locator) => {
  const box = await locator.first().boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
async function drag(from, to, steps = 60) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
    await ramu.sleep(8)
  }
  await page.mouse.up()
  await ramu.sleep(100)
}
/** Drags a separator by (dx, dy) and back. */
async function dragAndBack(separator, dx, dy) {
  const c = await center(separator)
  await drag(c, { x: c.x + dx, y: c.y + dy })
  await drag({ x: c.x + dx, y: c.y + dy }, c)
}
/** Clicks a button `times` times, leaving a pane's 0.3 s easing time to run each time. */
async function toggle(button, times = 2) {
  for (let i = 0; i < times; i++) {
    await button.click()
    await ramu.sleep(450)
  }
}
const separator = (name, scope = page) => scope.getByRole('separator', { name, exact: true })
const sidebarButton = (name) => page.getByRole('button', { name, exact: true })

ramu.test('a long chat renders and the window is a reproducible size', async () => {
  await ramu.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const { project } = await ramu.api('projects.addFolder', ramu.repos.project)
  const task = await ramu.api('tasks.create', { projectId: project.id, title: 'Frame probe', mode: 'current' })
  await ramu.api('tasks.setup', task.id)
  const session = await ramu.api('agent.start', task.id, 'Reply with a short greeting.', fakeAgent.claude)
  const idle = (message) =>
    ramu.until(async () => (await ramu.api('agent.get', session.id)).state === 'idle', message)
  await idle('the chat never became idle')
  for (let i = 0; i < 24; i++) {
    await ramu.api(
      'agent.send',
      session.id,
      `Message ${i}: ${'lorem ipsum dolor sit amet '.repeat(30)}\n\n\`\`\`ts\nconst x = ${i}\n\`\`\`\n\n- one\n- two`,
    )
    await idle(`message ${i} to finish`)
  }
  await ramu.reload()
  await page.locator('.task-row').first().click()
  await page.locator('.agent-view:visible').getByText('Message 23:').first().waitFor()
  console.log(`Messages rendered: ${await page.locator('.agent-view:visible .msg').count()}`)
})

ramu.test('sidebar and tools rail', async () => {
  await sample('sidebar drag', () => dragAndBack(separator('Resize sidebar'), 120, 0))
  await sample('sidebar toggle (hide+show)', () => toggle(page.locator('.sidebar-toggle')))
  await sidebarButton('Explorer').click()
  await tools.locator('.repo-tree').waitFor()
  await ramu.sleep(400)
  await sample('tools resize drag', () => dragAndBack(separator('Resize tools panel'), -100, 0))
  await sample('tools toggle (hide+show)', () => toggle(sidebarButton('Explorer')))
  for (const name of ['Search', 'Source Control', 'Explorer'])
    await sample(`${name} toggle (hide+show)`, () => toggle(sidebarButton(name), 3))
})

ramu.test('editor splitter and window resize', async () => {
  await tools.locator('.repo-tree').waitFor()
  await tools.getByRole('button', { name: 'review.ts', exact: true }).click()
  await page.locator('.editor-area .view:visible .monaco-editor').first().waitFor()
  await ramu.sleep(500)
  await sample('chat/editor splitter drag', () => dragAndBack(separator('Resize chat pane', pane), 150, 0))
  const resize = (width) =>
    ramu.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
  await sample('window resize (editor open)', async () => {
    for (let w = 1440; w >= 1000; w -= 20) {
      await resize(w)
      await ramu.sleep(16)
    }
    for (let w = 1000; w <= 1440; w += 20) {
      await resize(w)
      await ramu.sleep(16)
    }
  })
})

ramu.test('terminal open, resize and close keep the tools width', async () => {
  const toolsWidth = (await tools.boundingBox()).width
  const terminal = page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true })
  await sample('terminal open', async () => {
    await terminal.click()
    await ramu.sleep(700)
  })
  assert.ok(Math.abs((await tools.boundingBox()).width - toolsWidth) < 1, 'opening the terminal changed the tools width')
  await sample('terminal resize drag', () => dragAndBack(separator('Resize terminal panel', pane), 0, -120))
  await sample('terminal close', async () => {
    await terminal.click()
    await ramu.sleep(700)
  })
  assert.ok(Math.abs((await tools.boundingBox()).width - toolsWidth) < 1, 'closing the terminal changed the tools width')
})

ramu.test('the outer tools divider with a right-docked terminal', async () => {
  await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }).click()
  await pane.getByRole('button', { name: 'Move terminal to workspace tabs', exact: true }).click()
  await pane.locator('.terminal-panel.dock-right').waitFor()
  await sidebarButton('Hide sidebar').click()
  for (let i = 0; i < 11; i++)
    writeFileSync(join(ramu.repos.project, `file-${String(i).padStart(2, '0')}.md`), '# Changed fixture\n')
  await ramu.sleep(500)
  for (const name of ['Source Control', 'Explorer']) {
    await sidebarButton(name).click()
    await ramu.sleep(500)
    await sample(`${name} resize, terminal right`, () => dragAndBack(separator('Resize tools panel'), -120, 0))
  }
  ramu.noErrors()
})

ramu.test('frame times stay within the budget when one is set', () => {
  if (!budget) return
  const over = results.filter((row) => row.p95 > budget)
  assert.deepEqual(
    over.map((row) => row.name),
    [],
    `p95 over ${budget}ms`,
  )
})
