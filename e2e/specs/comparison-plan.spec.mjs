// Remaining comparison plan: first run, all-agent input, approved external skills and safe Mermaid rendering.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeAgent, openSettings, saveSettings, showChat, startChat, startRamu } from '../support/index.mjs'
let source
const ramu = await startRamu('comparison-plan', {
  repos: { repo: { 'diagram.md': '# Plan\n\n```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```\n' } },
  env: ({ dir }) => {
    source = join(dir, 'external-skill')
    mkdirSync(join(source, 'references'), { recursive: true })
    mkdirSync(join(source, 'scripts'))
    writeFileSync(
      join(source, 'SKILL.md'),
      '---\nname: comparison-fixture\ndescription: Read the comparison fixture references\n---\nRead references/check.md.\n',
    )
    writeFileSync(join(source, 'references/check.md'), 'Fixture reference stays inside the skill.')
    writeFileSync(
      join(source, 'scripts/do-not-run.py'),
      `from pathlib import Path\nPath(${JSON.stringify(join(dir, 'SCRIPT_RAN'))}).write_text('bad')\n`,
    )
    return { RAMU_E2E_ONBOARDING: '1', RAMU_TEST_PICK_DIRECTORY: join(dir, 'repo') }
  },
})
const { page, api, until } = ramu
let project, chat
ramu.test('first run detects providers and adds a repository without repeating onboarding', async () => {
  const welcome = page.getByRole('alertdialog', { name: 'Welcome to Ramu', exact: true })
  await welcome.waitFor()
  await welcome.getByRole('button', { name: 'Choose a project', exact: true }).click()
  await welcome.getByRole('button', { name: 'Choose repository', exact: true }).click()
  await until(async () => (await api('projects.list')).length === 1, 'onboarding repository')
  await welcome.getByRole('button', { name: 'Start working', exact: true }).click()
  await welcome.waitFor({ state: 'detached' })
  project = (await api('projects.list'))[0]
  await ramu.reload()
  assert.equal(await page.getByRole('alertdialog', { name: 'Welcome to Ramu' }).count(), 0)
})

ramu.test('Home puts pending input first and keeps completed agents collapsed', async () => {
  await startChat(ramu, { projectId: project.id, title: 'Already finished', prompt: 'Finished fixture' })
  chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Needs a decision',
    prompt: 'Choose fixture settings [questions wait]',
    settings: fakeAgent.claude,
    state: 'needs-input',
  })
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  const agents = page.locator('.home-agents')
  assert.equal(await page.getByRole('button', { name: 'Agents', exact: true }).count(), 0)
  assert.equal(await agents.getByRole('button', { name: 'Already finished', exact: true }).count(), 0)
  assert.equal(await agents.getByRole('button', { name: /Show completed/ }).getAttribute('aria-expanded'), 'false')
  await agents.getByRole('heading', { name: /Waiting for your input/ }).waitFor()
  assert.equal(await agents.locator('section').first().getAttribute('aria-label'), 'Waiting for your input')
  await ramu.shot('home-pending-input')
  await agents.getByRole('textbox', { name: 'Answer: Which database?', exact: true }).fill('SQLite')
  await agents.getByRole('button', { name: 'Next', exact: true }).click()
  await agents.getByRole('textbox', { name: 'Answer: Which region?', exact: true }).fill('Jakarta')
  await agents.getByRole('button', { name: 'Send answers together', exact: true }).click()
  await until(async () => (await api('agent.get', chat.session.id)).state === 'idle', 'answered from Home')
  await agents.getByRole('button', { name: /Show completed/ }).click()
  await agents.getByRole('button', { name: 'Already finished', exact: true }).waitFor()
  await agents.getByRole('button', { name: /Hide completed/ }).click()
  await agents.getByRole('button', { name: 'Already finished', exact: true }).waitFor({ state: 'hidden' })
  await ramu.shot('home-agents')
  const saved = (await api('ui.get')).workspace
  await api('ui.setWorkspace', { ...saved, sidebar: 'agents', activeTaskId: chat.task.id })
  const restored = (await api('ui.get')).workspace
  assert.equal(restored.sidebar, 'projects')
  assert.equal(restored.activeTaskId, null)
  assert.deepEqual(restored.openTaskIds, saved.openTaskIds)
})

ramu.test('helper rows open their transcript with a parent breadcrumb', async () => {
  const parent = await startChat(ramu, {
    projectId: project.id,
    title: 'Helper parent',
    prompt: 'Survey the repository [ramu-agent background]',
    settings: fakeAgent.claude,
  })
  await until(async () => (await api('agent.all')).some((s) => s.parentId === parent.session.id), 'helper overview row')
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page
    .locator('.home-agents')
    .getByRole('button', { name: /Show completed/ })
    .click()
  const helper = (await api('agent.all')).find((s) => s.parentId === parent.session.id)
  const row = page
    .locator('.home-agents article')
    .filter({ has: page.getByRole('button', { name: helper.title, exact: true }) })
  await row.getByRole('button', { name: 'Open', exact: true }).click()
  if (helper.nativeTask) await page.locator('.agent-panel').waitFor()
  else {
    await page.getByRole('button', { name: 'Back to parent thread', exact: true }).click()
    await until(
      async () =>
        (await api('ui.get')).tasks[parent.task.id]?.views.some((view) => view.sessionId === parent.session.id),
      'parent navigation',
    )
  }
})

ramu.test('chat skill installation waits for approval and imports references while excluding scripts', async () => {
  chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Install a project skill',
    prompt: `Install this skill for the project [skill install]\n<skill-source>${source}</skill-source>`,
    settings: fakeAgent.claude,
    state: 'needs-input',
  })
  assert.equal((await api('learning.get')).skills.filter((s) => s.installation).length, 0)
  await showChat(ramu, chat)
  // This is the user's structured approval in the same thread, through the normal question queue.
  const request = (await api('agent.events', chat.session.id)).findLast((e) => e.kind === 'question')
  assert.match(request.questions[0].question, /references\/check.md/)
  assert.match(request.questions[0].question, /scripts\/do-not-run.py/)
  await api('agent.replyQuestion', chat.session.id, request.requestId, { choice: 'Install' })
  await until(
    async () => (await api('agent.events', chat.session.id)).filter((e) => e.kind === 'question').length >= 2,
    'separate scripts approval',
  )
  const scripts = (await api('agent.events', chat.session.id)).findLast((e) => e.kind === 'question')
  await api('agent.replyQuestion', chat.session.id, scripts.requestId, { choice: 'Skip scripts' })
  await until(async () => (await api('agent.get', chat.session.id)).state === 'idle', 'skill import')
  const skill = (await api('learning.get')).skills.find((s) => s.installation)
  assert.ok(skill)
  assert.equal(skill.projectId, project.id)
  assert.ok(skill.installation.files['references/check.md'])
  assert.equal(skill.installation.files['scripts/do-not-run.py'], undefined)
  assert.equal(existsSync(join(ramu.dir, 'SCRIPT_RAN')), false)
  assert.ok((await api('skills.list', chat.task.id)).some((s) => s.name === 'comparison-fixture'))
  await openSettings(ramu, 'Memory & skills')
  await page.getByText('comparison-fixture', { exact: false }).first().waitFor()
  const card = page
    .locator('.settings-page article')
    .filter({ has: page.getByText('comparison-fixture', { exact: false }) })
    .first()
  await card.scrollIntoViewIfNeeded()
  await ramu.shot('installed-skill')
  await card.getByRole('button', { name: 'Remove', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: 'Remove installed skill?', exact: true })
    .getByRole('button', { name: 'Remove', exact: true })
    .click()
  await until(
    async () => !(await api('skills.list', chat.task.id)).some((s) => s.name === 'comparison-fixture'),
    'remove from provider catalog',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
})

ramu.test('Settings previews, installs, updates, disables, moves and removes external skills', async () => {
  await openSettings(ramu, 'Memory & skills')
  await page.getByRole('textbox', { name: 'Skill source', exact: true }).fill(source)
  await page.getByRole('combobox', { name: 'Skill scope', exact: true }).click()
  await page.getByRole('option', { name: project.name, exact: true }).click()
  await page.getByRole('button', { name: 'Preview skill', exact: true }).click()
  const preview = page.getByRole('alertdialog', { name: 'Review skill installation', exact: true })
  await preview.waitFor()
  assert.equal(await preview.getByRole('checkbox').isChecked(), false)
  assert.match(await preview.textContent(), /references\/check.md/)
  await preview.getByRole('button', { name: 'Install skill', exact: true }).click()
  await preview.waitFor({ state: 'detached' })
  let skill = (await api('learning.get')).skills.find((s) => s.installation)
  assert.equal(skill.projectId, project.id)
  const card = page
    .locator('.settings-page article')
    .filter({ has: page.getByText('comparison-fixture', { exact: false }) })
    .first()
  await card.getByRole('button', { name: 'Disable', exact: true }).click()
  await until(
    async () => (await api('learning.get')).skills.find((s) => s.id === skill.id)?.status === 'disabled',
    'disable installed skill',
  )
  await card.getByRole('button', { name: 'Enable', exact: true }).click()
  await card.getByRole('combobox', { name: 'Move skill: comparison-fixture', exact: true }).click()
  await page.getByRole('option', { name: 'All projects', exact: true }).click()
  await until(
    async () => (await api('learning.get')).skills.find((s) => s.id === skill.id)?.projectId === null,
    'move installed skill',
  )
  writeFileSync(join(source, 'references/check.md'), 'Updated source reference, still never executed.')
  await card.getByRole('button', { name: 'Update', exact: true }).click()
  await preview.waitFor()
  assert.match(await preview.textContent(), /references\/check.md/)
  await preview.getByRole('button', { name: 'Install skill', exact: true }).click()
  await preview.waitFor({ state: 'detached' })
  skill = (await api('learning.get')).skills.find((s) => s.id === skill.id)
  assert.equal(
    Buffer.from(skill.installation.files['references/check.md'], 'base64').toString(),
    'Updated source reference, still never executed.',
  )
  assert.equal(skill.installation.files['scripts/do-not-run.py'], undefined)
  await card.scrollIntoViewIfNeeded()
  await ramu.shot('installed-skill-settings')
  await card.getByRole('button', { name: 'Remove', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: 'Remove installed skill?', exact: true })
    .getByRole('button', { name: 'Remove', exact: true })
    .click()
  await until(async () => !(await api('learning.get')).skills.some((s) => s.installation), 'remove installed skill')
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
})

ramu.test('Mermaid diagrams render lazily in chat and locked Markdown previews', async () => {
  chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Diagram fixture',
    prompt: 'Show this diagram\n```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```',
    settings: fakeAgent.claude,
  })
  await showChat(ramu, chat)
  await page.locator('.agent-view:visible .mermaid-block svg').waitFor()
  assert.equal(await page.locator('.mermaid-block script, .mermaid-block a[href^="javascript:"]').count(), 0)
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page
    .locator('.explorer-panel')
    .getByRole('button', { name: /diagram.md/ })
    .click()
  await page.getByRole('button', { name: 'Locked', exact: true }).click()
  await page.locator('.md-preview .mermaid-block svg').waitFor()
  await ramu.shot('mermaid-preview')
})

ramu.test('new pending requests wait until the composer stops changing', async () => {
  chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Typing fixture',
    prompt: 'Reply briefly.',
    settings: fakeAgent.claude,
  })
  await showChat(ramu, chat)
  const composer = page.locator('.agent-view:visible .composer [role="textbox"]')
  await composer.fill('I am still typing')
  await api('agent.submit', chat.session.id, 'Choose fixture settings [questions wait]', 'queue', [], [])
  for (let i = 0; i < 12; i++) {
    await composer.fill(`I am still typing ${i}`)
    await ramu.sleep(100)
  }
  assert.ok((await api('agent.events', chat.session.id)).some((e) => e.kind === 'question'))
  assert.equal(await page.locator('.agent-view:visible .question-dock').count(), 0)
  await page.locator('.agent-view:visible .question-dock').waitFor()
  assert.equal(await composer.textContent(), 'I am still typing 11')
  await api('agent.stop', chat.session.id)
})

ramu.test('tool disclosure changes keep the transcript at the bottom', async () => {
  chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Scroll fixture',
    prompt: '[tool progress]',
    settings: fakeAgent.claude,
  })
  await showChat(ramu, chat)
  const viewport = page.locator('.agent-view:visible .transcript [data-slot="scroll-area-viewport"]')
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.getByRole('button', { name: /Worked for/ }).click()
  const group = page.locator('.agent-view:visible .tool-group').first()
  await group.locator('[data-slot="collapsible-trigger"]').first().click()
  await until(
    async () => viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 3),
    'bottom pin after tool expansion',
  )
  await group.locator('[data-slot="collapsible-trigger"]').first().click()
  await until(
    async () => viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 3),
    'bottom pin after tool collapse',
  )
})

ramu.test('local diagnostics opt-in never copies messages, paths or native dumps', async () => {
  assert.equal((await api('settings.app.get')).localCrashReports, false)
  await openSettings(ramu, 'Background & updates')
  await page.getByRole('switch', { name: 'Keep local crash reports', exact: true }).check()
  await saveSettings(ramu)
  await assert.rejects(api('agent.get', 'secret-prompt-path'))
  const report = await api('diagnostics.export')
  assert.ok(JSON.parse(report).reports.length)
  assert.doesNotMatch(report, /secret-prompt-path|agent_sessions|stack|message|\.dmp/)
  await ramu.relaunch()
  assert.equal(await ramu.app.evaluate(({ crashReporter }) => crashReporter.getUploadToServer()), false)
  await api('diagnostics.clear')
  assert.deepEqual(JSON.parse(await api('diagnostics.export')).reports, [])
  ramu.noErrors()
})
