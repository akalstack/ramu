// Run after pnpm build. Real ACP wire + Electron renderer, with a local stub agent and isolated profile.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const cwd = resolve(import.meta.dirname, '..', 'apps', 'desktop')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-acp-ui-')),
  repo = join(fixture, 'repo'),
  binary = join(fixture, 'agent')
const shots = process.env.RAMU_E2E_SCREENSHOTS ?? join(fixture, 'screenshots')
mkdirSync(repo)
mkdirSync(shots, { recursive: true })
writeFileSync(join(repo, 'config.ts'), 'export const value = 1\n')
copyFileSync(join(cwd, 'assets/icon.png'), join(repo, 'preview.png'))
for (const args of [
  ['init', '-q'],
  ['add', '.'],
  [
    '-c',
    'user.name=ACP Test',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'initial',
  ],
])
  execFileSync('git', args, { cwd: repo })
const png = readFileSync(join(repo, 'preview.png')).toString('base64')
writeFileSync(
  binary,
  `#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
let prompt, timer; const session='acp-ui-session';
const update=u=>send({method:'session/update',params:{sessionId:session,update:u}});
rl.on('line',line=>{
 const m=JSON.parse(line); if(!m.method)return;
 if(m.method==='initialize'){send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:true}}}});return;}
 if(m.method==='authenticate'){send({id:m.id,result:{}});return;}
 if(m.method==='session/new'||m.method==='session/load'){send({id:m.id,result:{sessionId:session,models:{currentModelId:'wire-model',availableModels:[{modelId:'wire-model',name:'ACP fixture'}]}}});return;}
 if(m.method==='session/set_model'){send({id:m.id,result:{}});return;}
 if(m.method==='session/cancel'){clearTimeout(timer);if(prompt)send({id:prompt,result:{stopReason:'cancelled'}});return;}
 if(m.method==='session/prompt'){
  prompt=m.id;
  update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Inspect the shared configuration.'}});
  update({sessionUpdate:'plan',entries:[{content:'Inspect configuration',status:'completed',priority:'high'},{content:'Render a preview',status:'in_progress',priority:'medium'}]});
  update({sessionUpdate:'tool_call',toolCallId:'shell',name:'provider_shell',title:'Run the preview command',kind:'execute',status:'pending',rawInput:{command:'echo preview',description:'Generate a preview'}});
  update({sessionUpdate:'tool_call_update',toolCallId:'shell',status:'in_progress',title:'Generate the preview',content:[{type:'content',content:{type:'text',text:'Preview command is running'}}]});
  update({sessionUpdate:'tool_call',toolCallId:'image',kind:'read',title:'Inspect the generated image',status:'completed',content:[{type:'content',content:{type:'image',mimeType:'image/png',data:${JSON.stringify(png)}}}]});
  update({sessionUpdate:'tool_call',toolCallId:'edit',kind:'edit',title:'Update the configuration',status:'completed',content:[{type:'diff',path:${JSON.stringify(join(repo, 'config.ts'))},oldText:'export const value = 1\\n',newText:'export const value = 2\\n'},{type:'content',content:{type:'resource',resource:{uri:'file:///report.txt',mimeType:'text/plain',text:'A structured resource result.'}}},{type:'terminal',terminalId:'external-terminal'},{type:'content',content:{type:'provider-custom',value:'custom data'}}]});
  update({sessionUpdate:'agent_message_chunk',content:{type:'image',mimeType:'image/png',data:${JSON.stringify(png)}}});
  timer=setTimeout(()=>{update({sessionUpdate:'tool_call_update',toolCallId:'shell',status:'completed',content:[{type:'content',content:{type:'text',text:'Preview command finished'}}]});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Preview complete.'}});send({id:m.id,result:{stopReason:'end_turn'}})},60000);
 }
});
`,
)
chmodSync(binary, 0o755)
const env = {
  ...process.env,
  RAMU_USER_DATA: join(fixture, 'profile'),
  RAMU_CURSOR_BIN: binary,
  RAMU_CODEX_BIN: '/missing/codex',
  RAMU_CLAUDE_BIN: '/missing/claude',
  RAMU_OPENCODE_BIN: '/missing/opencode',
  RAMU_ANTIGRAVITY_BIN: '/missing/antigravity',
}
delete env.ELECTRON_RENDERER_URL
delete env.RAMU_FAKE_AGENT
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow(),
  errors = []
page.on('pageerror', (e) => {
  if (e.message !== 'Canceled') errors.push(e.message)
})
const api = (method, ...args) => page.evaluate(([method, args]) => window.ramu.invoke(method, ...args), [method, args])
let session
try {
  await page.waitForSelector('.shell')
  const preferences = await api('settings.app.get')
  await api('settings.app.set', { ...preferences, providerUpdateChecks: false, appUpdateChecks: false })
  const { project } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'ACP tool presentation', mode: 'current' })
  await api('tasks.setup', task.id)
  session = await api('agent.start', task.id, 'Show the ACP content fixture.', {
    provider: 'cursor',
    model: 'wire-model',
    effort: null,
    access: 'full',
    autoFallback: false,
  })
  await page.reload()
  await page.locator('.task-row').first().click()
  const chat = page.locator('.agent-view:visible')
  await chat.locator('.thinking').waitFor()
  await chat.locator('.agent-plan').waitFor()
  const group = chat
    .locator('.tool-group')
    .filter({ has: page.locator('.tool-group-label') })
    .first()
  await group.waitFor()
  assert.equal((await group.getAttribute('data-open')) !== null, true)
  const shell = group.locator('.tool').filter({ hasText: 'Generate the preview' })
  await shell.locator('[data-slot=collapsible-trigger]').click()
  await shell
    .locator('.tool-input')
    .getByText(/echo preview/)
    .waitFor()
  await shell.getByText('Preview command is running', { exact: true }).waitFor()
  assert.equal(await shell.locator('.tool-summary').textContent(), 'Generate the preview')
  assert.equal(await group.locator('.tool').count(), 3)
  const image = group.locator('.tool').filter({ hasText: 'Inspect the generated image' })
  await image.locator('[data-slot=collapsible-trigger]').click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tool .agent-image img')].some((img) => img.complete && img.naturalWidth > 0),
  )
  const edit = group.locator('.tool').filter({ hasText: 'Update the configuration' })
  await edit.locator('[data-slot=collapsible-trigger]').click()
  await edit.locator('.monaco-diff-editor').waitFor()
  await edit.getByText('A structured resource result.', { exact: true }).waitFor()
  await edit.getByText('Unsupported content: provider-custom', { exact: true }).waitFor()
  await edit.getByText('external-terminal', { exact: false }).waitFor()
  assert((await chat.locator('[data-content-type=image]').count()) >= 2)
  const before = await api('agent.events', session.id)
  assert.equal(before.filter((e) => e.kind === 'tool-use' && e.toolUseId === 'shell').length, 1)
  assert(before.some((e) => e.kind === 'tool-result' && e.toolUseId === 'shell' && e.running === true))
  await chat.locator('.transcript').evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(shots, 'acp-tools-live.png') })
  await edit.getByText('A structured resource result.', { exact: true }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(shots, 'acp-tool-details.png') })
  await api('agent.interrupt', session.id)
  await page.reload()
  await page.locator('.task-row').first().click()
  await chat
    .getByRole('button', { name: /Worked for|Working for|Worked/ })
    .first()
    .click()
  const restoredGroup = chat
    .locator('.tool-group')
    .filter({ has: page.locator('.tool-group-label') })
    .first()
  if ((await restoredGroup.getAttribute('data-open')) === null)
    await restoredGroup.locator('[data-slot=collapsible-trigger]').first().click()
  assert.equal(await restoredGroup.locator('.tool-summary').filter({ hasText: 'Generate the preview' }).count(), 1)
  assert(
    (await api('agent.events', session.id)).some(
      (e) => e.kind === 'tool-result' && e.content?.some((c) => c.type === 'image'),
    ),
  )
  assert.deepEqual(errors, [])
  console.log(
    'ok - ACP thinking, plans, human titles, live output, images, resources, diffs, terminal references and unsupported content render and survive reload',
  )
  console.log(`Screenshots: ${shots}`)
} catch (error) {
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  console.error('Renderer errors:', errors, '\n', await page.locator('body').innerText())
  throw error
} finally {
  if (session) await api('agent.stop', session.id).catch(() => {})
  await api('background.stop').catch(() => {})
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
