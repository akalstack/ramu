import { expect, it } from 'vitest'
import { toolStepDetail } from '../src/chat/agentActivity'

it('keeps a plain summary’s first line', () => {
  expect(toolStepDetail({ summary: 'pnpm test\n--run' })).toBe('pnpm test')
})

it('reads the telling argument from a JSON input instead of showing "{"', () => {
  expect(toolStepDetail({ summary: '{\n  "absolute_path": "/repo/src/learning.ts"\n}' })).toBe('learning.ts')
  expect(toolStepDetail({ summary: '{"command": "git status", "dir_path": "/repo"}' })).toBe('git status')
  expect(toolStepDetail({ summary: '{\n  "pattern": "TODO",\n  "path": "/repo/very/long/inp' })).toBe('TODO')
  expect(toolStepDetail({ summary: '{\n  "file_path": "/repo/a \\"b\\".ts", "content": "x' })).toBe('a "b".ts')
})

it('falls back to the call’s location, then to nothing', () => {
  expect(toolStepDetail({ summary: '{"limit": 10}', locations: [{ path: '/repo/README.md' }] })).toBe('README.md')
  expect(toolStepDetail({ summary: '{"limit": 10}' })).toBe('')
  expect(toolStepDetail({ summary: '{' })).toBe('')
})
