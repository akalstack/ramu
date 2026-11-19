import { expect, it } from 'vitest'
import { quoteSource } from '../src/chat/quoteSource'

it('finds the newest message a quote came from, whatever Markdown and line breaks the source used', () => {
  const messages = [
    { id: 'a', text: 'Run **pnpm build** first.\nThen the smoke test.' },
    { id: 'b', text: 'Something else entirely.' },
    { id: 'c', text: 'Later: run pnpm build first, then smoke.' },
  ]
  expect(quoteSource(messages, '> Run pnpm build first. Then the smoke test.')?.id).toBe('a')
  expect(quoteSource(messages, 'run pnpm build first')?.id).toBe('c')
  expect(quoteSource(messages, 'not said anywhere')).toBeNull()
  expect(quoteSource(messages, '   ')).toBeNull()
})
