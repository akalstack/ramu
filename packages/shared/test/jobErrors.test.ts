import { expect, it } from 'vitest'
import { readableJobError } from '../src/jobErrors'

it('finds the message inside a provider result record and says a sign-in problem plainly', () => {
  const record = JSON.stringify({
    duration_ms: 30,
    is_error: true,
    terminal_reason: 'api_error',
    result: 'Not logged in · Please run /login',
  })
  expect(readableJobError(`Error: ${record}`)).toBe(
    'The provider was signed out. Sign in under Settings › Providers, then retry.',
  )
  expect(readableJobError(JSON.stringify({ is_error: true, result: 'Overloaded' }))).toBe('Overloaded')
  expect(readableJobError(JSON.stringify({ terminal_reason: 'api_error' }))).toBe('api_error')
})

it('keeps an ordinary error and shortens a very long one', () => {
  expect(readableJobError('Error: Antigravity stopped')).toBe('Antigravity stopped')
  expect(readableJobError('x'.repeat(500))).toHaveLength(300)
})
