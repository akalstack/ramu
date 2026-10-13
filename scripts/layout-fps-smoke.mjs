// Frame-time probe for layout motion: pane drags, sidebar/terminal toggles and window resizes.
// Run after pnpm build. Reports are informational; set RAMU_FPS_BUDGET_MS to fail when p95 exceeds it.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const cwd = resolve(import.meta.dirname, '..')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-fps-'))
const repo = join(fixture, 'project')
mkdirSync(repo)
writeFileSync(join(repo, 'review.ts'), Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i}`).join('\n') + '\n')
for (let i = 0; i < 80; i++) writeFileSync(join(repo, `file-${String(i).padStart(2, '0')}.md`), '# Fixture\n')
const git = (...args) => execFileSync('git', args, { cwd: repo })
git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fps', '-c', 'user.email=fps@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')
const env = { ...process.env, RAMU_USER_DATA: join(fixture, 'profile'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
const budget = Number(process.env.RAMU_FPS_BUDGET_MS ?? 0)
const results = []
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const sample = async (name, run) => {
  await page.evaluate(() => {
    const frames = []; let last = performance.now(), live = true
    const tick = (now) => { frames.push(now - last); last = now; if (live) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__fps = () => { live = false; return frames }
  })
  await run()
  const frames = (await page.evaluate(() => window.__fps())).slice(1)
  const sorted = [...frames].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  const row = { name, frames: frames.length, avg: +(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)).toFixed(1), p95: +at(.95).toFixed(1), max: +at(1).toFixed(1), slow: frames.filter((ms) => ms > 25).length }
  results.push(row)
  console.log(`${name.padEnd(34)} frames ${String(row.frames).padStart(4)}  avg ${row.avg}ms  p95 ${row.p95}ms  max ${row.max}ms  >25ms: ${row.slow}`)
}
const drag = async (from, to, steps = 60) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(8) }
  await page.mouse.up(); await sleep(100)
}
const center = async (selector) => { const box = await page.locator(selector).first().boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
try {
  await page.waitForSelector('.shell')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const { project } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'Frame probe', mode: 'current' })
  await api('tasks.setup', task.id)
  const session = await api('agent.start', task.id, 'Reply with a short greeting.', { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false })
  for (let i = 0; i < 24; i++) await api('agent.send', session.id ?? session, `Message ${i}: ${'lorem ipsum dolor sit amet '.repeat(30)}\n\n\`\`\`ts\nconst x = ${i}\n\`\`\`\n\n- one\n- two`).catch(() => {})
  await sleep(2500)
  await page.reload(); await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await page.locator('.agent-view:visible').waitFor()
  console.log(`Fixture: ${fixture}\nMessages rendered: ${await page.locator('.agent-view:visible .msg').count()}`)

  await sample('sidebar drag', async () => { const c = await center('.sidebar-resizer'); await drag(c, { x: c.x + 120, y: c.y }); await drag({ x: c.x + 120, y: c.y }, c) })
  await sample('sidebar toggle (hide+show)', async () => {
    const toggle = page.locator('.sidebar-toggle')
    await toggle.click(); await sleep(450); await toggle.click(); await sleep(450)
  })
  await page.getByRole('button', { name: 'Explorer', exact: true }).click(); await page.locator('.workspace-tools .repo-tree').waitFor(); await sleep(400)
  await sample('tools resize drag', async () => { const c = await center('.workspace-tools-resizer'); await drag(c, { x: c.x - 100, y: c.y }); await drag({ x: c.x - 100, y: c.y }, c) })
  await sample('tools toggle (hide+show)', async () => {
    const button = page.getByRole('button', { name: 'Explorer', exact: true })
    await button.click(); await sleep(450); await button.click(); await sleep(450)
  })
  await page.locator('.workspace-tools .repo-tree').waitFor()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await page.locator('.editor-area .view:visible .monaco-editor').first().waitFor(); await sleep(500)
  await sample('chat/editor splitter drag', async () => { const c = await center('.task-pane:visible .splitter'); await drag(c, { x: c.x + 150, y: c.y }); await drag({ x: c.x + 150, y: c.y }, c) })
  await sample('window resize (editor open)', async () => {
    for (let w = 1440; w >= 1000; w -= 20) { await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), w); await sleep(16) }
    for (let w = 1000; w <= 1440; w += 20) { await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), w); await sleep(16) }
  })
  await sample('terminal open', async () => { await page.getByRole('button', { name: 'Terminal', exact: true }).click(); await sleep(700) })
  await sample('terminal resize drag', async () => { const c = await center('.terminal-resize'); await drag(c, { x: c.x, y: c.y - 120 }); await drag({ x: c.x, y: c.y - 120 }, c) })
  await sample('terminal close', async () => { await page.getByRole('button', { name: 'Terminal', exact: true }).click(); await sleep(700) })
  if (budget) {
    const over = results.filter((row) => row.p95 > budget)
    if (over.length) throw new Error(`p95 over ${budget}ms: ${over.map((row) => row.name).join(', ')}`)
  }
} finally {
  await app.close()
}
