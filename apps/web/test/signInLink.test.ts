import { describe, expect, it } from 'vitest'
import { cliOpensBrowser, signInLinkIn } from '../src/models/signInLink'

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

  it('knows when the command opens the browser itself, as Claude Code, Codex and GitHub say they do', () => {
    expect(
      cliOpensBrowser(
        "Opening browser to sign in…\r\nIf the browser didn't open, visit:\r\nhttps://claude.ai/oauth/authorize?a\r\n",
      ),
    ).toBe(true)
    expect(
      cliOpensBrowser(
        'If your browser did not open, navigate to this URL to authenticate:\r\nhttps://auth.openai.com/x\r\n',
      ),
    ).toBe(true)
    expect(
      cliOpensBrowser('Press \x1b[1mEnter\x1b[0m to open https://github.com/login/device in your browser...'),
    ).toBe(true)
    expect(cliOpensBrowser('Go to https://console.example.com/keys and paste the key:\r\n')).toBe(false)
  })
})
