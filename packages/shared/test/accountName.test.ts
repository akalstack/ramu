import { expect, it } from 'vitest'
import { accountName, type ProviderConfiguration } from '../src/providers/providers'

const config: ProviderConfiguration = {
  'claude-code': { binary: '', accounts: [{ id: 'a1', name: 'Work' }, { id: 'b2' }, { id: 'c3' }] },
}
const say = (text: string, values?: Record<string, string | number>) => text.replace('{0}', String(values?.['0'] ?? ''))

it('names a login by its label, then its email, then its place, never by its id', () => {
  expect(accountName(config, 'claude-code', 'a1', { email: 'me@work.com' }, say)).toBe('Work')
  expect(accountName(config, 'claude-code', 'b2', { email: 'me@home.com' }, say)).toBe('me@home.com')
  expect(accountName(config, 'claude-code', 'c3', undefined, say)).toBe('Account 4')
  expect(accountName(config, 'claude-code', 'default', undefined, say)).toBe('Default CLI account')
  expect(accountName(config, 'antigravity', 'default', undefined, say)).toBe('Default account')
})

it('marks a login that runs on an API key', () => {
  expect(accountName(config, 'claude-code', 'c3', { apiKey: true }, say)).toBe('Account 4 · API key')
})

it('leaves labels and emails out when they are hidden', () => {
  expect(accountName(config, 'claude-code', 'a1', { email: 'me@work.com' }, say, false)).toBe('Account 2')
  expect(accountName(config, 'claude-code', 'default', { email: 'me@x.com', apiKey: true }, say, false)).toBe(
    'Default CLI account · API key',
  )
})
