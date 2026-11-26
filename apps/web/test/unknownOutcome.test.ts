import { expect, it } from 'vitest'
import { errorText, isOfflineError } from '../src/lib/errors'

it('says a call cut off by the connection may already have run, and leaves a host’s own refusal as it is', () => {
  const lost = new Error("Error invoking remote method 'ramu:invoke': Error: Connection lost before the host answered")
  expect(errorText(lost)).toBe(
    'The connection dropped before the host answered. It may have done this already, so check before trying again.',
  )
  // Still read as a connection failure, so the view shows the host offline and reads again when it is back.
  expect(isOfflineError(lost)).toBe(true)
  expect(errorText(new Error('Error: That thread no longer exists'))).toBe('That thread no longer exists')
})
