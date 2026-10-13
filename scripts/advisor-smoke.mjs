// Electron check for Ramu's advisor against an isolated profile and the fake agents; no model calls.
// Run after `pnpm build`: node scripts/advisor-smoke.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'

const appDir = resolve(import.meta.dirname, '..', 'apps', 'desktop'), dir = mkdtempSync(join(tmpdir(), 'ramu-advisor-'))
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
  await page.addInitScript(() => {
    window.__chatMotions = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      const result = animate.apply(this, args)
      if (result.id.startsWith('ramu-panel-')) window.__chatMotions.push(result.id)
      return result
    }
  })
  await page.waitForSelector('.shell', { timeout: 20000 })
  const prefs = await api('settings.app.get')
  check(prefs.advisor?.enabled === false, 'The advisor is off by default')

  // Settings › Advisor: turning it on picks a model; Save stores it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-page').waitFor()
  await page.locator('.settings-navigation').getByRole('button', { name: 'Advisor', exact: true }).click()
  await page.locator('.advisor-settings').waitFor()
  const advisorSwitch = page.getByRole('switch', { name: 'Advisor', exact: true })
  const checkSwitchGeometry = async () => {
    await sleep(180)
    const geometry = await advisorSwitch.evaluate(el => {
      const track = el.getBoundingClientRect(), thumb = el.querySelector('[data-slot="switch-thumb"]').getBoundingClientRect()
      return { left: thumb.left - track.left, right: track.right - thumb.right, top: thumb.top - track.top, bottom: track.bottom - thumb.bottom, track: track.width, thumb: thumb.width }
    })
    check(geometry.left >= 2 && geometry.right >= 2 && geometry.top >= 2 && geometry.bottom >= 2, `Switch thumb remains inside its track (${JSON.stringify(geometry)})`)
    return geometry
  }
  const uncheckedSwitch = await checkSwitchGeometry()
  await advisorSwitch.click()
  const checkedSwitch = await checkSwitchGeometry()
  check(Math.abs(uncheckedSwitch.left - checkedSwitch.right) < 0.5, 'Checked and unchecked switch insets are symmetrical')
  await page.screenshot({ path: join(shots, 'settings.png') })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await until(async () => (await api('settings.app.get')).advisor.enabled, 'Advisor setting did not save')
  await page.keyboard.press('Escape')
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
    // Chat shows the consultation status; full cards and answers remain in Agents.
    const ui = await api('ui.get'), viewId = `advisor-${later.id}`
    await api('ui.setTask', [asyncTask.id, { views: [{ id: viewId, kind: 'agent', sessionId: later.id }], activeViewId: viewId }])
    await api('ui.setWorkspace', [{ ...ui.workspace, openTaskIds: [...new Set([...ui.workspace.openTaskIds, asyncTask.id])], activeTaskId: asyncTask.id }])
    await page.reload(); await page.waitForSelector('.shell')
    await page.locator('.task-row').filter({ has: page.getByText(asyncTask.title, { exact: true }) }).click()
    await page.locator('.advice-delivered:visible').waitFor()
    check(await page.locator('.transcript .advisor-activity.completed').count() === 1, 'Chat shows one completed advisor consultation row')
    check(await page.locator('.transcript .advisor-activity').textContent().then(text => text.includes('Advisor finished')), 'The consultation status is visible with Agents closed')
    // Exercise the same push channel used by a live consultation, without a model call.
    const pushAdvisor = event => app.evaluate(({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0].webContents.send('agent:event', payload), { sessionId: later.id, event })
    await pushAdvisor({ ...card, status: 'running', endedAt: undefined })
    await page.locator('.transcript .advisor-activity.running').waitFor()
    check(await page.locator('.transcript .advisor-activity.running [data-slot="spinner"]').count() === 1, 'A live advisor call shows a spinner directly in chat')
    check((await page.locator('.transcript .advisor-activity').textContent()).includes('Consulting advisor'), 'Chat announces the advisor while it is reviewing')
    await page.screenshot({ path: join(shots, 'consulting.png') })
    await pushAdvisor({ ...card, status: 'failed', error: 'Advisor unavailable' })
    await page.locator('.transcript .advisor-activity.failed').waitFor()
    check(await page.locator('.transcript .advisor-activity').count() === 1, 'Advisor progress updates reuse one row')
    await pushAdvisor({ ...card, status: 'stopped' })
    await page.locator('.transcript .advisor-activity.stopped').waitFor()
    await pushAdvisor(card)
    await page.locator('.transcript .advisor-activity.completed').waitFor()
    await page.locator('.transcript .advisor-activity').click()
    await page.locator('.agent-panel').waitFor()
    check(await page.locator('.agent-panel .msg.assistant').filter({ hasText: 'Verify the tests' }).isVisible(), 'Clicking the consultation opens its answer')
    await page.keyboard.press('Escape')
    await page.locator('.agent-panel').waitFor({ state: 'detached' })
    await page.locator('.agents-chip').filter({ hasText: 'Agents' }).click()
    await until(() => page.evaluate(() => window.__chatMotions.includes('ramu-panel-in-right')), 'Agents panel did not use shared entry motion')
    await page.locator('.agent-panel .agent-task-card').filter({ hasText: 'Advisor' }).first().waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.agent-panel').waitFor({ state: 'detached' })
    check(await page.locator('.advice-delivered:visible').count() === 1, 'Delivered advice shows as a compact row, not a message bubble')
    await pushAdvisor({ kind: 'goal', goal: { id: 'design-goal', objective: 'Check shared activity rows', status: 'completed', turns: 1, reason: '', updatedAt: Date.now() } })
    await page.locator('.goal-done .chat-activity-row').waitFor()
    await page.locator('.goal-done .chat-activity-row').click()
    await page.locator('.goal-done .goal-details').waitFor()
    check(await page.locator('.goal-done .goal-details').isVisible(), 'Shared goal activity retains its disclosure behavior')
    await page.locator('.goal-done .chat-activity-row').click()
    const rowStyles = await page.evaluate(() => ['.advisor-activity', '.advice-delivered', '.goal-done .chat-activity-row'].map(selector => {
      const el = document.querySelector(selector), style = getComputedStyle(el)
      return Object.fromEntries(['padding', 'gap', 'fontSize', 'fontWeight', 'borderRadius', 'backgroundColor', 'minHeight'].map(key => [key, style[key]]))
    }))
    check(rowStyles.every(style => JSON.stringify(style) === JSON.stringify(rowStyles[0])), 'Advisor, delivery and goal rows share spacing, typography and surfaces')
    check(rowStyles[0].backgroundColor === 'rgba(0, 0, 0, 0)', 'Compact chat activity uses the transparent tool-row surface')

    check(await page.locator('.msg.user').filter({ hasText: "Advice from Ramu's advisor" }).count() === 0, 'The raw advice message is not shown as a user bubble')
    check(await page.locator('.transcript .msg.assistant .msg-actions').count() === 1, 'Only the latest assistant reply has timestamp and copy controls')
    await until(() => page.evaluate(() => !document.documentElement.dataset.panelMotion), 'Chat panel close did not finish')
    await page.screenshot({ path: join(shots, 'chat.png') })
    await page.locator('.advice-delivered:visible').click()
    const panel = page.locator('.agent-panel')
    await panel.waitFor()
    check(await panel.locator('.msg.user').filter({ hasText: 'Is the plan sound?' }).isVisible() && await panel.locator('.msg.assistant').filter({ hasText: 'Verify the tests' }).isVisible(), 'The advisor panel shows its question and answer like a chat')
    await sleep(400) // the panel slides in
    await page.screenshot({ path: join(shots, 'panel.png') })
    await page.keyboard.press('Escape')
    await page.locator('.agent-panel').waitFor({ state: 'detached' })
    for (const toolUseId of ['routine-smoke', 'failed-smoke', 'unfinished-smoke']) await pushAdvisor({ kind: 'tool-use', toolUseId, name: 'Bash', summary: toolUseId })
    await pushAdvisor({ kind: 'tool-result', toolUseId: 'routine-smoke', isError: false, summary: 'Routine output retained' })
    await pushAdvisor({ kind: 'tool-result', toolUseId: 'failed-smoke', isError: true, summary: 'Failure details retained' })
    await pushAdvisor({ kind: 'text', text: 'Final answer stays visible.' })
    await pushAdvisor({ kind: 'result', isError: false, text: 'done' })
    const failedTool = page.locator('.transcript [data-tool-use-id="failed-smoke"]')
    await failedTool.locator('[data-slot="collapsible-trigger"]').waitFor({ state: 'visible' })
    check(await failedTool.locator('.tool-state').textContent() === 'Failed', 'Failed tools remain visible after the turn finishes')
    await failedTool.locator('[data-slot="collapsible-trigger"]').click()
    check(await failedTool.getByText('Failure details retained', { exact: true }).isVisible(), 'Failed tool output remains available to expand')
    check(await page.locator('.transcript [data-tool-use-id="unfinished-smoke"] .tool-state').isVisible(), 'Unfinished tools remain visible after the turn stops')
    check(await page.getByText('Final answer stays visible.', { exact: true }).isVisible(), 'The final answer remains expanded')
    await page.locator('.turn-summary-toggle').last().click()
    const routineTool = page.locator('.transcript [data-tool-use-id="routine-smoke"]')
    await routineTool.locator('[data-slot="collapsible-trigger"]').click()
    check(await routineTool.getByText('Routine output retained', { exact: true }).isVisible(), 'Routine calls and outputs are retained inside completed work')

  }

  // Appearance preference persists and suppresses live panel animations.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-navigation').getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('switch', { name: 'Reduce motion', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await until(async () => (await api('settings.app.get')).reduceMotion === true, 'Reduce motion did not persist')
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  await page.reload(); await page.waitForSelector('.shell')
  check(await page.evaluate(() => document.documentElement.hasAttribute('data-reduce-motion')), 'Reduced motion is restored after reload')
  await page.locator('.task-row').filter({ has: page.getByText('claude-code keeps working', { exact: true }) }).click()
  await page.locator('.asides-chip:visible').click()
  await page.locator('.aside-panel').waitFor()
  check(await page.evaluate(() => window.__chatMotions.length === 0), 'Reduce motion opens Aside without animation')
  check(await page.locator('.agent-dock.open').evaluate(el => getComputedStyle(el).transitionDuration === '0s'), 'Chat panel layout has no width transition')
  await page.keyboard.press('Escape')
  await page.locator('.aside-panel').waitFor({ state: 'detached' })

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
