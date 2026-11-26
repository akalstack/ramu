import { describe, expect, it } from 'vitest'
import { signInLinkIn } from '../src/models/signInLink'

describe('sign-in link', () => {
  it('finds the first finished link, through terminal colors', () => {
    expect(
      signInLinkIn(
        'Open this page:\r\n\x1b[4mhttps://claude.ai/oauth/authorize?code=true&state=a1\x1b[0m\r\nPaste code',
      ),
    ).toBe('https://claude.ai/oauth/authorize?code=true&state=a1')
  })

  it('waits for a link that is still arriving', () => {
    expect(signInLinkIn('Visit https://github.com/login/dev')).toBeNull()
    expect(signInLinkIn('no link here\n')).toBeNull()
  })
})
