// Screenshots of usage gauges using simulated providers and an isolated profile.
// Isolated profile and fake agents; no model calls. Run after `pnpm build`: node scripts/usage-shots.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'

const appDir = resolve(import.meta.dirname, '..'), dir = mkdtempSync(join(tmpdir(), 'ramu-usage-shots-'))
const profile = join(dir, 'profile')
const shots = join(appDir, 'output', 'playwright', 'usage'); mkdirSync(shots, { recursive: true })
const env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1', RAMU_FAKE_AGENT_DELAY: '20000' }; delete env.ELECTRON_RENDERER_URL
const socketPath = join(tmpdir(), `ramu-${process.getuid()}-${createHash('sha256').update(profile).digest('hex').slice(0, 20)}.sock`)
const api = (method, args = []) => new Promise((resolve, reject) => { const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => { let data = ''; res.on('data', (c) => data += c); res.on('end', () => { try { const response = JSON.parse(data); response.error ? reject(new Error(response.error)) : resolve(response.value) } catch (e) { reject(e) } }) }); req.on('error', reject); req.end(JSON.stringify({ method, args })) })
const check = (value, message) => { if (!value) throw new Error(message); console.log(`ok - ${message}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, message, attempts = 150) { for (let i = 0; i < attempts; i++) { const result = await fn(); if (result) return result; await sleep(100) } throw new Error(message) }
const claude = { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false, serviceTier: 'standard' }

let app, page
const errors = []
try {
  app = await electron.launch({ args: [appDir], cwd: appDir, env, timeout: 30000 })
  page = await app.firstWindow(); page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.shell', { timeout: 20000 })
  for (const [provider, prompt] of [['claude-code', '[usage 78] usage preview'], ['codex', '[codex-usage 42] usage preview']]) {
    const task = await api('tasks.create', [{ projectId: 'no-project', title: `${provider} usage preview`, mode: 'current' }])
    const session = await api('agent.start', [task.id, prompt, { ...claude, provider, model: provider === 'codex' ? 'fake-codex' : 'fake-claude' }])
    await until(async () => (await api('agent.get', [session.id])).state === 'idle', 'Usage preview did not finish')
  }
  await page.reload(); await page.waitForSelector('.shell')
  const footer = page.locator('.usage-footer')
  await footer.waitFor()
  await footer.getByText('Codex', { exact: true }).waitFor()
  await page.screenshot({ path: join(shots, 'footer.png') })
  await footer.click()
  await page.locator('.usage-popover').waitFor()
  await sleep(350)
  await page.screenshot({ path: join(shots, 'details.png') })
  console.log(await page.locator('.usage-popover .provider-icon').evaluateAll((icons) => icons.map((icon) => ({ className: icon.className, color: getComputedStyle(icon).color }))))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await page.locator('.usage-rings').click()
  await page.locator('.usage-popover').waitFor()
  await sleep(350)
  await page.screenshot({ path: join(shots, 'rings-details.png') })
  check(errors.length === 0, `No renderer errors: ${errors.join(', ')}`)
  console.log(`Screenshots: ${shots}`)
} catch (error) {
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  try { console.error(readFileSync(join(profile, 'background.log'), 'utf8').slice(-3000)) } catch {}
  throw error
} finally {
  await app?.close().catch(() => {})
  await api('background.stop').catch(() => {})
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}
