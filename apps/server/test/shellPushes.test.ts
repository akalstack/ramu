import { expect, it, vi } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { ShellPushes } from '../src/agent/shellPushes'

const use = (toolUseId: string, input: string, name = 'Bash') =>
  ({ kind: 'tool-use', toolUseId, name, summary: input, input }) as AgentEvent
const result = (toolUseId: string, isError = false, running = false) =>
  ({ kind: 'tool-result', toolUseId, isError, summary: '', running }) as AgentEvent

it('follows a git push the agent ran once it finishes without an error', () => {
  const pushed = vi.fn()
  const pushes = new ShellPushes(pushed)
  pushes.observe('s1', use('a', 'git add . && git commit -m x && git push -u origin feature'))
  pushes.observe('s1', result('a', false, true))
  expect(pushed).not.toHaveBeenCalled()
  pushes.observe('s1', result('a'))
  expect(pushed).toHaveBeenCalledWith('s1', 'push')
  pushes.observe('s1', result('a'))
  expect(pushed).toHaveBeenCalledOnce()
})

it('ignores failed pushes, other commands, other tools and other threads’ results', () => {
  const pushed = vi.fn()
  const pushes = new ShellPushes(pushed)
  pushes.observe('s1', use('a', 'git -C app push'))
  pushes.observe('s1', result('a', true))
  pushes.observe('s1', use('b', 'echo "git pushes later" && git status'))
  pushes.observe('s1', result('b'))
  pushes.observe('s1', use('c', 'git push', 'Read'))
  pushes.observe('s1', result('c'))
  pushes.observe('s1', use('d', 'git push'))
  pushes.observe('s2', result('d'))
  expect(pushed).not.toHaveBeenCalled()
  pushes.observe('s1', use('e', 'git -C app push'))
  pushes.observe('s1', result('e'))
  expect(pushed).toHaveBeenCalledOnce()
})

it('reports gh pr commands that change a pull request, apart from pushes, and not ones that only read', () => {
  const changed = vi.fn()
  const shell = new ShellPushes(changed)
  shell.observe('s1', use('a', 'gh pr view --json state'))
  shell.observe('s1', result('a'))
  expect(changed).not.toHaveBeenCalled()
  shell.observe('s1', use('b', 'gh pr create --fill'))
  shell.observe('s1', result('b'))
  expect(changed).toHaveBeenCalledWith('s1', 'pull-request')
  shell.observe('s1', use('c', 'gh pr merge 12 --squash'))
  shell.observe('s1', result('c', true))
  expect(changed).toHaveBeenCalledOnce()
})
