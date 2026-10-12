// Electron check for Ramu's advisor against an isolated profile and the fake agents; no model calls.
// Run after `pnpm build`: node scripts/advisor-smoke.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'

const appDir = resolve(import.meta.dirname, '..'), dir = mkdtempSync(join(tmpdir(), 'ramu-advisor-'))
const profile = join(dir, 'profile')
const shots = join(appDir, 'output', 'playwright', 'advisor'); mkdirSync(shots, { recursive: true })
const env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1' }; delete env.ELECTRON_RENDERER_URL
const socketPath = join(tmpdir(), `ramu-${process.getuid()}-${createHash('sha256').update(profile).digest('hex').slice(0, 20)}.sock`)
const api = (method, args = []) => new Promise((resolve, reject) => { const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => { let data = ''; res.on('data', (c) => data += c); res.on('end', () => { try { const response = JSON.parse(data); response.error ? reject(new Error(response.error)) : resolve(response.value) } catch (e) { reject(e) } }) }); req.on('error', reject); req.end(JSON.stringify({ method, args })) })
const check = (value, message) => { if (!value) throw new Error(message); console.log(`ok - ${message}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, message, attempts = 150) { for (let i = 0; i < attempts; i++) { const result = await fn(); if (result) return result; await sleep(100) } throw new Error(message) }

let app, page
const errors = []
try {
  app = await electron.launch({ args: [appDir], cwd: appDir, env, timeout: 30000 })
  page = await app.firstWindow(); page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.shell', { timeout: 20000 })
  const prefs = await api('settings.app.get')
  check(prefs.advisor?.enabled === false, 'The advisor is off by default')

  // Settings › Advisor: turning it on picks a model; Save stores it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-page').waitFor()
  await page.locator('.settings-navigation').getByRole('button', { name: 'Advisor', exact: true }).click()
  await page.locator('.advisor-settings').waitFor()
  await page.getByRole('switch', { name: 'Advisor', exact: true }).click()
  await page.screenshot({ path: join(shots, 'settings.png') })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  const saved = await api('settings.app.get')
  check(saved.advisor.enabled && saved.advisor.step?.model, `Saving turns the advisor on with a model (${saved.advisor.step?.provider}:${saved.advisor.step?.model})`)

  // Cross-provider: Codex advises, chats run on Claude and Codex.
  await api('settings.app.set', [{ ...saved, advisor: { enabled: true, wait: false, step: { id: 'advisor', provider: 'codex', model: 'fake-codex', effort: 'high' } } }])
  for (const provider of ['claude-code', 'codex']) {
    const settings = { provider, model: provider === 'codex' ? 'fake-codex' : 'fake-claude', effort: 'medium', access: 'full', autoFallback: false, serviceTier: 'standard' }
    const waitTask = await api('tasks.create', [{ projectId: 'no-project', title: `${provider} waits for advice`, mode: 'current' }])
    const waited = await api('agent.start', [waitTask.id, '[advisor] plan the change', settings])
    await until(async () => ['idle', 'failed'].includes((await api('agent.get', [waited.id])).state), `${provider} chat with a blocking advisor call did not finish`)
    check((await api('agent.get', [waited.id])).state === 'idle', `${provider} consults the Codex advisor and waits for its answer`)
    const asyncTask = await api('tasks.create', [{ projectId: 'no-project', title: `${provider} keeps working`, mode: 'current' }])
    const later = await api('agent.start', [asyncTask.id, '[advisor async] plan the change', settings])
    const delivered = await until(async () => (await api('agent.events', [later.id])).find((e) => e.kind === 'user' && e.text.startsWith("Advice from Ramu's advisor")), `${provider} did not receive async advice`)
    check(delivered.text.includes('fake-codex · Codex') && delivered.text.includes('Is the plan sound?'), `${provider} keeps working and receives the advice as a message`)
    await until(async () => (await api('agent.get', [later.id])).state === 'idle', `${provider} did not finish the advice turn`)
    const card = (await api('agent.events', [later.id])).filter((e) => e.kind === 'agent' && e.taskType === 'advisor').at(-1)
    check(card?.status === 'completed' && card.background, `${provider} shows the consultation as a finished advisor card`)
    if (provider !== 'claude-code') continue
    // The chat: a card where the advisor was consulted, and a row where the advice arrived; both open its panel.
    const ui = await api('ui.get'), viewId = `advisor-${later.id}`
    await api('ui.setTask', [asyncTask.id, { views: [{ id: viewId, kind: 'agent', sessionId: later.id }], activeViewId: viewId }])
    await api('ui.setWorkspace', [{ ...ui.workspace, openTaskIds: [...new Set([...ui.workspace.openTaskIds, asyncTask.id])], activeTaskId: asyncTask.id }])
    await page.reload(); await page.waitForSelector('.shell')
    await page.locator('.task-row').filter({ has: page.getByText(asyncTask.title, { exact: true }) }).click()
    await page.locator('.agent-task-card:visible').filter({ hasText: 'Advisor' }).first().waitFor()
    check(await page.locator('.advice-delivered:visible').count() === 1, 'Delivered advice shows as a compact row, not a message bubble')
    check(await page.locator('.msg.user').filter({ hasText: "Advice from Ramu's advisor" }).count() === 0, 'The raw advice message is not shown as a user bubble')
    await page.screenshot({ path: join(shots, 'chat.png') })
    await page.locator('.advice-delivered:visible').click()
    const panel = page.locator('.agent-panel')
    await panel.waitFor()
    check(await panel.locator('.msg.user').filter({ hasText: 'Is the plan sound?' }).isVisible() && await panel.locator('.msg.assistant').filter({ hasText: 'Verify the tests' }).isVisible(), 'The advisor panel shows its question and answer like a chat')
    await sleep(400) // the panel slides in
    await page.screenshot({ path: join(shots, 'panel.png') })
    await page.keyboard.press('Escape')
  }

  // Off again: the tool is gone.
  await api('settings.app.set', [{ ...saved, advisor: { ...saved.advisor, enabled: false } }])
  const offTask = await api('tasks.create', [{ projectId: 'no-project', title: 'Advisor off', mode: 'current' }])
  const off = await api('agent.start', [offTask.id, '[advisor] plan the change', { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false, serviceTier: 'standard' }])
  await until(async () => ['idle', 'failed'].includes((await api('agent.get', [off.id])).state), 'Advisor-off chat did not settle')
  check((await api('agent.events', [off.id])).some((e) => e.kind === 'error' && /advisor/i.test(e.message)), 'With the advisor off, chats do not get the tool')
  check(errors.length === 0, `No renderer errors: ${errors.join(', ')}`)
  console.log(`Screenshots: ${shots}`)
} catch (error) {
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  try { console.error(readFileSync(join(profile, 'background.log'), 'utf8').slice(-4000)) } catch {}
  throw error
} finally {
  await app?.close().catch(() => {})
  await api('background.stop').catch(() => {})
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}
