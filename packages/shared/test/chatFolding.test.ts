import { expect, it } from 'vitest'
import { foldChatTurn, type ChatBlock, type ToolUse, type ToolResult } from '../src/chatFolding'
import type { AgentEvent } from '../src/types'
const tool = (id: string): ToolUse => ({ kind: 'tool-use', toolUseId: id, name: 'Bash', summary: id })
const result = (id: string, isError = false): ToolResult => ({ kind: 'tool-result', toolUseId: id, summary: id, isError })
const answer: ChatBlock = { kind: 'event', event: { kind: 'text', text: 'Final answer' } }
const event = (event: AgentEvent): ChatBlock => ({ kind: 'event', event })
it('keeps failures visible while retaining successful calls and their final answer', () => {
  const calls = [tool('success'), tool('failure'), tool('missing')]
  const results = new Map([['success', result('success')], ['failure', result('failure', true)]])
  const folded = foldChatTurn([{ kind: 'tools', tools: calls }, answer], new Map(), results)
  expect(folded.folded).toEqual([{ kind: 'tools', tools: [calls[0]] }])
  expect(folded.kept).toEqual([{ kind: 'tools', tools: [calls[1], calls[2]] }])
  expect(folded.answer).toEqual([answer])
  expect(results.get('failure')?.summary).toBe('failure')
})
it('keeps unfinished background tools out of completed work', () => {
  const call = tool('background')
  expect(foldChatTurn([{ kind: 'tools', tools: [call] }, answer], new Map(), new Map([['background', { ...result('background'), running: true }]])).kept).toHaveLength(1)
})
it('retains pending or declined permissions, and folds approved ones', () => {
  const permission = (id: string) => event({ kind: 'permission-request', requestId: id, toolName: 'Bash', title: id, detail: '' })
  const pending = permission('pending'), denied = permission('denied'), allowed = permission('allowed')
  const folded = foldChatTurn([pending, denied, allowed, answer], new Map([['denied', 'denied'], ['allowed', 'allowed']]), new Map())
  expect(folded.kept).toEqual([pending, denied])
  expect(folded.folded).toEqual([allowed])
})
it('keeps each advisor consultation and failed helper visible', () => {
  const agent = (id: string, status: 'completed' | 'failed', taskType?: string) => event({ kind: 'agent', agentId: id, name: id, status, taskType })
  const first = agent('advisor-1', 'completed', 'advisor'), second = agent('advisor-2', 'completed', 'advisor'), failed = agent('failed', 'failed'), done = agent('done', 'completed')
  const folded = foldChatTurn([first, second, failed, done, answer], new Map(), new Map())
  expect(folded.kept).toEqual([first, second, failed])
  expect(folded.folded).toEqual([done])
})
it('keeps errors and pending plans visible while folding completed plans', () => {
  const error = event({ kind: 'error', message: 'Failed' })
  const pending = event({ kind: 'plan', messageId: 'p', entries: [{ content: 'Work', status: 'pending', priority: 'high' }] })
  const done = event({ kind: 'plan', messageId: 'd', entries: [{ content: 'Work', status: 'completed', priority: 'high' }] })
  expect(foldChatTurn([error, pending, done, answer], new Map(), new Map())).toEqual({ kept: [error, pending], folded: [done], answer: [answer] })
})
