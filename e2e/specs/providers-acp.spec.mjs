// A real ACP wire against a local stub agent: thinking, plans, tool titles, live output, images, resources, diffs and
// terminal references render in chat and survive a reload.
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { appDir, startRamu } from '../support/index.mjs'

const fixture = mkdtempSync(join(tmpdir(), 'ramu-e2e-acp-'))
after(() => rmSync(fixture, { recursive: true, force: true }))
const binary = join(fixture, 'agent')
const config = 'export const value = 1\n'
const icon = join(fixture, 'preview.png')
copyFileSync(join(appDir, '..', '..', 'assets', 'icon.png'), icon)
const png = readFileSync(icon).toString('base64')

const ramu = await startRamu('providers-acp', {
  launch: false,
  repos: { repo: { 'config.ts': config } },
  env: {
    RAMU_FAKE_AGENT: '',
    RAMU_CURSOR_BIN: '/missing/cursor',
    RAMU_CODEX_BIN: '/missing/codex',
    RAMU_CLAUDE_BIN: '/missing/claude',
    RAMU_OPENCODE_BIN: '/missing/opencode',
    RAMU_ANTIGRAVITY_BIN: binary,
  },
})
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
  update({sessionUpdate:'tool_call',toolCallId:'edit',kind:'edit',title:'Update the configuration',status:'completed',content:[{type:'diff',path:${JSON.stringify(join(ramu.repos.repo, 'config.ts'))},oldText:'export const value = 1\\n',newText:'export const value = 2\\n'},{type:'content',content:{type:'resource',resource:{uri:'file:///report.txt',mimeType:'text/plain',text:'A structured resource result.'}}},{type:'terminal',terminalId:'external-terminal'},{type:'content',content:{type:'provider-custom',value:'custom data'}}]});
  update({sessionUpdate:'agent_message_chunk',content:{type:'image',mimeType:'image/png',data:${JSON.stringify(png)}}});
  timer=setTimeout(()=>{update({sessionUpdate:'tool_call_update',toolCallId:'shell',status:'completed',content:[{type:'content',content:{type:'text',text:'Preview command finished'}}]});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Preview complete.'}});send({id:m.id,result:{stopReason:'end_turn'}})},60000);
 }
});
`,
)
chmodSync(binary, 0o755)
await ramu.launch()
let session

ramu.test('ACP tool calls render live in thread', async () => {
  const { page } = ramu
  const preferences = await ramu.api('settings.app.get')
  await ramu.api('settings.app.set', { ...preferences, providerUpdateChecks: false, appUpdateChecks: false })
  const { project } = await ramu.api('projects.addFolder', ramu.repos.repo)
  const task = await ramu.api('tasks.create', {
    projectId: project.id,
    title: 'ACP tool presentation',
    mode: 'current',
  })
  await ramu.api('tasks.setup', task.id)
  session = await ramu.api('agent.start', task.id, 'Show the ACP content fixture.', {
    provider: 'antigravity',
    model: 'wire-model',
    effort: null,
    access: 'full',
    autoFallback: false,
  })
  await ramu.reload()
  await page.locator('.task-row').first().click()
  const chat = page.locator('.agent-view:visible')
  await chat.locator('.thinking').waitFor()
  await chat.locator('.agent-plan').waitFor()
  const group = chat
    .locator('.tool-group')
    .filter({ has: page.locator('.tool-group-label') })
    .first()
  await group.waitFor()
  if ((await group.getAttribute('data-open')) === null)
    await group.locator('[data-slot=collapsible-trigger]').first().click()
  assert.equal(await group.locator('.tool').count(), 3)

  const shell = group.locator('.tool').filter({ hasText: 'Generate the preview' })
  await shell.locator('[data-slot=collapsible-trigger]').click()
  await shell
    .locator('.tool-input')
    .getByText(/echo preview/)
    .waitFor()
  await shell.getByText('Preview command is running', { exact: true }).waitFor()
  assert.equal(await shell.locator('.tool-summary').textContent(), 'Generate the preview')

  const image = group.locator('.tool').filter({ hasText: 'Inspect the generated image' })
  await image.locator('[data-slot=collapsible-trigger]').click()
  // Stored tool transcripts drop inline image bytes (stripToolBulk), so the tool shows a placeholder; the reply's image renders.
  await image.getByText('Image preview unavailable', { exact: true }).waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.agent-image img')].some((img) => img.complete && img.naturalWidth > 0),
  )

  const edit = group.locator('.tool').filter({ hasText: 'Update the configuration' })
  await edit.locator('[data-slot=collapsible-trigger]').click()
  await edit.locator('.monaco-diff-editor').waitFor()
  await edit.getByText('A structured resource result.', { exact: true }).waitFor()
  await edit.getByText('Unsupported content: provider-custom', { exact: true }).waitFor()
  await edit.getByText('external-terminal', { exact: false }).waitFor()
  assert.ok((await chat.locator('[data-content-type=image]').count()) >= 2)

  const events = await ramu.api('agent.events', session.id)
  assert.equal(events.filter((e) => e.kind === 'tool-use' && e.toolUseId === 'shell').length, 1)
  assert.ok(events.some((e) => e.kind === 'tool-result' && e.toolUseId === 'shell' && e.running === true))
  await ramu.shot('acp-tools-live')
})

ramu.test('the tool trail survives interrupting and reloading', async () => {
  const { page } = ramu
  await ramu.api('agent.interrupt', session.id)
  await ramu.reload()
  await page.locator('.task-row').first().click()
  const chat = page.locator('.agent-view:visible')
  await chat
    .getByRole('button', { name: /Worked for|Working for|Worked/ })
    .first()
    .click()
  const group = chat
    .locator('.tool-group')
    .filter({ has: page.locator('.tool-group-label') })
    .first()
  if ((await group.getAttribute('data-open')) === null)
    await group.locator('[data-slot=collapsible-trigger]').first().click()
  // The interrupted shell call stays visible outside the completed work, marked Stopped.
  for (const title of ['Inspect the generated image', 'Update the configuration'])
    assert.equal(await group.locator('.tool-summary').filter({ hasText: title }).count(), 1)
  await chat.locator('.tool').filter({ hasText: 'Generate the preview' }).getByText('Stopped').first().waitFor()
  assert.ok(
    (await ramu.api('agent.events', session.id)).some(
      (e) => e.kind === 'tool-result' && e.content?.some((c) => c.type === 'image'),
    ),
  )
  ramu.noErrors()
})
