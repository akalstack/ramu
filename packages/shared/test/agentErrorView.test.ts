import { expect, it } from 'vitest'
import { agentErrorView } from '../src/chat/agentErrorView'

it('offers the step that fixes a known error', () => {
  expect(agentErrorView("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.")).toEqual({
    title: 'This model isn’t available',
    action: 'model',
  })
  expect(agentErrorView('Not logged in. Please run /login').action).toBe('providers')
  expect(agentErrorView('429 Too many requests').action).toBe('retry')
})

it('stays general for anything else', () => {
  expect(agentErrorView('Process exited with code 1').title).toBe('The agent stopped with an error')
})
