// Screenshots of chat UI for review: questions, late answers, /aside while the agent works, advice delivery.
// Isolated profile and fake agents; no model calls. Run after `pnpm build`: node scripts/chat-shots.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'

const appDir = resolve(import.meta.dirname, '..'), dir = mkdtempSync(join(tmpdir(), 'ramu-chat-shots-'))
const profile = join(dir, 'profile')
const shots = join(appDir, 'output', 'playwright', 'chat'); mkdirSync(shots, { recursive: true })
const env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1', RAMU_FAKE_AGENT_DELAY: '20000' }; delete env.ELECTRON_RENDERER_URL
const socketPath = join(tmpdir(), `ramu-${process.getuid()}-${createHash('sha256').update(profile).digest('hex').slice(0, 20)}.sock`)
const api = (method, args = []) => new Promise((resolve, reject) => { const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => { let data = ''; res.on('data', (c) => data += c); res.on('end', () => { try { const response = JSON.parse(data); response.error ? reject(new Error(response.error)) : resolve(response.value) } catch (e) { reject(e) } }) }); req.on('error', reject); req.end(JSON.stringify({ method, args })) })
const check = (value, message) => { if (!value) throw new Error(message); console.log(`ok - ${message}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, message, attempts = 150) { for (let i = 0; i < attempts; i++) { const result = await fn(); if (result) return result; await sleep(100) } throw new Error(message) }
const claude = { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false, serviceTier: 'standard' }

let app, page
const errors = []
async function openChat(task, session) {
  const ui = await api('ui.get'), viewId = `shot-${session.id}`
  await api('ui.setTask', [task.id, { views: [{ id: viewId, kind: 'agent', sessionId: session.id }], activeViewId: viewId }])
  await api('ui.setWorkspace', [{ ...ui.workspace, openTaskIds: [...new Set([...ui.workspace.openTaskIds, task.id])], activeTaskId: task.id }])
  await page.reload(); await page.waitForSelector('.shell')
  await page.locator('.task-row').filter({ has: page.getByText(task.title, { exact: true }) }).click()
}
try {
  app = await electron.launch({ args: [appDir], cwd: appDir, env, timeout: 30000 })
  page = await app.firstWindow(); page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.shell', { timeout: 20000 })

  // Questions: pending card, then the answers as your message.
  const qTask = await api('tasks.create', [{ projectId: 'no-project', title: 'Pick a database', mode: 'current' }])
  const qSession = await api('agent.start', [qTask.id, '[questions together] set up storage', claude])
  await until(async () => (await api('agent.get', [qSession.id])).state === 'idle', 'Question chat did not finish its independent work')
  await openChat(qTask, qSession)
  const card = page.locator('.question-card:visible').first()
  await card.waitFor()
  await page.screenshot({ path: join(shots, 'questions-pending.png') })
  await card.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).fill('SQLite')
  await card.getByRole('button', { name: 'Next', exact: true }).click()
  await card.getByRole('textbox', { name: 'Answer: Which region?', exact: true }).fill('Jakarta')
  await card.getByRole('button', { name: 'Send answers together', exact: true }).click()
  await until(async () => { const events = await api('agent.events', [qSession.id]); return events.filter((e) => e.kind === 'result').length >= 2 && (await api('agent.get', [qSession.id])).state === 'idle' }, 'Answers did not start the next turn')
  await page.getByText("Answers to the agent's questions", { exact: true }).waitFor()
  check(await page.locator('.msg.user').filter({ hasText: 'Answer to your earlier question' }).count() === 0, 'Late answers show without the delivery note')
  await page.screenshot({ path: join(shots, 'questions-answered.png') })

  // /aside from the chat's own box while the agent is still working.
  const wTask = await api('tasks.create', [{ projectId: 'no-project', title: 'Long running work', mode: 'current' }])
  const wSession = await api('agent.start', [wTask.id, '[slow] survey the code', claude])
  await openChat(wTask, wSession)
  await until(async () => ['running', 'starting'].includes((await api('agent.get', [wSession.id])).state), 'Agent was not working')
  const box = page.locator('[data-composer-input]:visible')
  await box.fill('/aside what is the agent doing right now?')
  await box.press('Enter')
  await page.locator('.aside-panel').waitFor()
  await until(async () => (await api('aside.list', [wSession.id])).some((aside) => aside.messages.some((m) => m.role === 'assistant')), 'Aside did not get an answer')
  check((await api('agent.get', [wSession.id])).state === 'running' && !(await api('agent.events', [wSession.id])).some((e) => e.kind === 'user' && e.text.includes('/aside')), 'An aside from the message box is answered while the agent keeps working, and never reaches it')
  check(await page.evaluate(() => document.activeElement?.closest('.composer') !== null), 'Focus stays in the chat\'s message box')
  await sleep(400)
  await page.screenshot({ path: join(shots, 'aside-while-working.png') })
  await page.keyboard.press('Escape')

  // Mid-run: the agent asks, keeps working, and the question waits in the chat.
  const mTask = await api('tasks.create', [{ projectId: 'no-project', title: 'Set up storage', mode: 'current' }])
  const mSession = await api('agent.start', [mTask.id, '[slow] [questions together] set up storage', claude])
  await until(async () => (await api('agent.events', [mSession.id])).some((e) => e.kind === 'question'), 'Agent did not ask mid-run')
  await openChat(mTask, mSession)
  await page.locator('.question-card:visible').first().waitFor()
  check((await api('agent.get', [mSession.id])).state === 'running', 'The agent keeps working while its question waits')
  await page.screenshot({ path: join(shots, 'question-mid-run.png') })
  // "Answer later" folds it to a bar on the message box; the transcript row opens it again.
  await page.getByRole('button', { name: 'Answer later', exact: true }).click()
  await page.locator('.question-dock.collapsed').waitFor()
  await page.screenshot({ path: join(shots, 'question-mid-run-collapsed.png') })
  await page.locator('.question-row.pending:visible').click()
  await page.locator('.question-dock .question-card:visible').waitFor()
  await page.keyboard.press('1')
  await page.locator('.question-dock .option.selected').waitFor()
  check(await page.locator('.question-dock .option.selected').innerText().then((text) => text.includes('SQLite')), 'Number keys pick an option')
  await page.screenshot({ path: join(shots, 'question-mid-run-selected.png') })

  // Everything that sits on the message box at once: question and a steering message waiting for the running command.
  const sTask = await api('tasks.create', [{ projectId: 'no-project', title: 'Busy message box', mode: 'current' }])
  const sSession = await api('agent.start', [sTask.id, '[slow] [questions together] set up storage', claude])
  await until(async () => (await api('agent.events', [sSession.id])).some((e) => e.kind === 'question'), 'Agent did not ask')
  await openChat(sTask, sSession)
  await page.locator('.question-dock .question-card:visible').waitFor()
  const stackBox = page.locator('[data-composer-input]:visible')
  await stackBox.fill('Also keep the old table for a week')
  await stackBox.press('Enter')
  await page.locator('.message-queue:visible').waitFor()
  const boxes = await Promise.all(['.question-dock', '.message-queue', '.composer'].map((selector) => page.locator(`${selector}:visible`).first().boundingBox()))
  const overlaps = boxes.slice(0, -1).flatMap((box, i) => boxes.slice(i + 1).filter((other) => box.y + box.height > other.y + 12).map(() => i))
  check(overlaps.length === 0, `Question, queue and message box stack without covering each other (${boxes.map((b) => `${Math.round(b.y)}+${Math.round(b.height)}`).join(', ')})`)
  await sleep(300)
  await page.screenshot({ path: join(shots, 'message-box-stack.png') })
  // A single send control; the alternate action stays available by keyboard.
  check(await page.locator('.composer:visible').getByRole('button', { name: 'Queue', exact: true }).count() === 0, 'No idle Queue button beside Stop')
  await stackBox.fill('Run the linter too')
  check(await page.locator('.composer:visible').getByRole('button', { name: 'Queue', exact: true }).count() === 0, 'No extra Queue button while typing')
  const sendButton = page.locator('.composer:visible .send')
  check(await sendButton.isEnabled(), 'Send stays enabled with text while the agent works')
  check((await sendButton.getAttribute('title')).includes('Queue (⌘Enter / Ctrl+Enter)'), 'The send tooltip explains the alternate shortcut')
  await page.screenshot({ path: join(shots, 'message-box-typing.png') })
  await stackBox.press('Control+Enter')
  await until(async () => (await api('agent.events', [sSession.id])).findLast((event) => event.kind === 'queue')?.messages.some((message) => message.text === 'Run the linter too' && message.mode === 'queue'), 'Keyboard shortcut did not queue the message')
  check(await stackBox.getAttribute('data-draft') === '', 'Queuing by keyboard clears the message box')
  // Typing your own answer clears a picked option, and picking an option leaves the box empty.
  const dock = page.locator('.question-dock .question-card:visible')
  await dock.locator('.option').first().click()
  check(await dock.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).inputValue() === '', 'Picking an option does not fill the answer box')
  await dock.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).fill('DuckDB')
  await page.mouse.move(5, 5)
  check(await dock.locator('.option.selected').count() === 0, 'Typing your own answer clears the picked option')
  await page.screenshot({ path: join(shots, 'question-own-answer.png') })

  // Advice from Ramu's advisor arriving later.
  const prefs = await api('settings.app.get')
  await api('settings.app.set', [{ ...prefs, advisor: { enabled: true, wait: false, step: { id: 'a', provider: 'codex', model: 'fake-codex', effort: 'high' } } }])
  const aTask = await api('tasks.create', [{ projectId: 'no-project', title: 'Plan with advice', mode: 'current' }])
  const aSession = await api('agent.start', [aTask.id, '[advisor async] plan the change', claude])
  await until(async () => (await api('agent.events', [aSession.id])).some((e) => e.kind === 'user' && e.text.startsWith("Advice from Ramu's advisor")) && (await api('agent.get', [aSession.id])).state === 'idle', 'Advice did not arrive')
  await openChat(aTask, aSession)
  await page.locator('.advice-delivered:visible').waitFor()
  const row = await page.locator('.advice-delivered:visible').boundingBox(), column = await page.locator('.transcript-col:visible').boundingBox()
  check(row.x - column.x < 4, 'Advice delivery sits on the left, with the agent\'s side of the chat')
  await page.screenshot({ path: join(shots, 'advice-row.png') })
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
