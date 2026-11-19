import { expect, it } from 'vitest'
import {
  environmentProblem,
  formatDotEnv,
  parseDotEnv,
  pasteDotEnv,
  scopedEnvironment,
} from '../src/providers/environment'

it('reads a pasted .env file with comments, export, quotes and multi-line values', () => {
  const text = [
    '# comment',
    'export ANTHROPIC_BASE_URL=https://proxy.example.com/v1',
    'TOKEN="a b\\nc"',
    "RAW='keep $HOME \\n'",
    'INLINE=value # note',
    'HASH=abc#def',
    'KEY=sk-abc==',
    'PEM="-----BEGIN',
    'body',
    '-----END"',
    'not an assignment',
    'TOKEN=override',
  ].join('\r\n')
  expect(parseDotEnv(text)).toEqual([
    { key: 'ANTHROPIC_BASE_URL', value: 'https://proxy.example.com/v1' },
    { key: 'RAW', value: 'keep $HOME \\n' },
    { key: 'INLINE', value: 'value' },
    { key: 'HASH', value: 'abc#def' },
    { key: 'KEY', value: 'sk-abc==' },
    { key: 'PEM', value: '-----BEGIN\nbody\n-----END' },
    { key: 'TOKEN', value: 'override' },
  ])
})

it('copies as .env text that reads back unchanged', () => {
  const variables = [
    { key: 'PLAIN', value: 'https://x.dev/a?b=1' },
    { key: 'SPACED', value: 'two words "quoted" \\ back' },
    { key: 'LINES', value: 'one\ntwo' },
    { key: 'EMPTY', value: '' },
  ]
  const text = formatDotEnv(variables)
  expect(text.split('\n')[0]).toBe('PLAIN=https://x.dev/a?b=1')
  expect(parseDotEnv(text)).toEqual(variables)
})

it('fills the pasted row, updates rows with the same name and appends the rest', () => {
  const rows = [
    { key: 'A', value: 'old' },
    { key: '', value: '' },
  ]
  expect(pasteDotEnv(rows, 1, 'B=1\nA=new\nC=3')).toEqual([
    { key: 'A', value: 'new' },
    { key: 'B', value: '1' },
    { key: 'C', value: '3' },
  ])
  expect(pasteDotEnv(rows, 1, 'just text')).toBeNull()
})

it('rejects names providers cannot receive and Ramu’s own variables', () => {
  const rows = [
    { key: 'OK_1', value: 'x' },
    { key: 'DUP', value: '1' },
    { key: 'DUP', value: '2' },
  ]
  expect(environmentProblem(rows[0]!, rows)).toBeNull()
  expect(environmentProblem(rows[1]!, rows)).toMatch(/twice/)
  expect(environmentProblem({ key: '1BAD', value: '' }, [])).toMatch(/letters/)
  expect(environmentProblem({ key: 'my.key', value: '' }, [])).toMatch(/letters/)
  expect(environmentProblem({ key: 'RAMU_TOKEN', value: '' }, [])).toMatch(/reserved/)
})

it('lets a provider’s own variable win over the global one', () => {
  const values = {
    global: [
      { key: 'HTTPS_PROXY', value: 'global' },
      { key: 'SHARED', value: 'yes' },
    ],
    codex: [{ key: 'HTTPS_PROXY', value: 'codex' }],
  }
  expect(scopedEnvironment(values, 'codex')).toEqual({ HTTPS_PROXY: 'codex', SHARED: 'yes' })
  expect(scopedEnvironment(values, 'claude-code')).toEqual({ HTTPS_PROXY: 'global', SHARED: 'yes' })
})
