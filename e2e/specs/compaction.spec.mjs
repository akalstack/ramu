import { fakeAgent, showChat, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('compaction')
const { page, api, check, until } = ramu

ramu.test('shows live compaction beside tool activity and preserves exact context counts', async () => {
  const chat = await startChat(ramu, {
    title: 'Context compaction',
    prompt: '[compaction]',
    settings: fakeAgent.codex,
    state: 'running',
  })
  await showChat(ramu, chat)
  const live = page.locator('[data-compacting="true"]:visible')
  await live.waitFor()
  check((await live.innerText()).includes('Compacting context…'), 'Compaction stays visible when a tool group exists')
  await ramu.shot('compacting')
  await until(async () => (await api('agent.get', chat.session.id)).state === 'idle', 'compaction to complete')
  const marker = page.locator('.compaction-separator:visible')
  await marker.getByText('After: 33,700 tokens', { exact: true }).waitFor()
  check((await marker.count()) === 1, 'Delayed usage updates the same compaction marker')
  check((await marker.innerText()).includes('Before: 212,000 tokens'), 'Previous context token count is visible')
  check((await marker.innerText()).includes('Context window: 258,400 tokens'), 'Context window capacity is visible')
  check((await live.count()) === 0, 'Live compaction status clears on completion')
  await ramu.shot('compacted')
  await ramu.reload()
  await page
    .locator('.task-row')
    .filter({ has: page.getByText(chat.task.title, { exact: true }) })
    .click()
  await page.locator('.compaction-separator:visible').getByText('After: 33,700 tokens', { exact: true }).waitFor()
  check(true, 'Compaction counts survive reloading the chat')
  ramu.noErrors()
})
