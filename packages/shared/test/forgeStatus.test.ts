import { describe, expect, it } from 'vitest'
import { forgeStatusText } from '../src/forgeStatus'
import type { ForgeConnectionSummary } from '../src/types'

// A translator that shows the key with its values, so the test reads the words a person would.
const t = (key: string, values?: Record<string, string>) =>
  key.replace(/\{(\d)\}/g, (_match, index: string) => values?.[index] ?? '')
const words = forgeStatusText(t)

const summary = (patch: Partial<ForgeConnectionSummary>): ForgeConnectionSummary => ({
  cli: 'signed-in',
  accounts: [],
  saved: [],
  checkedAt: 0,
  ...patch,
})

describe('forgeStatusText', () => {
  it('says what is missing when nothing is connected', () => {
    expect(words.connectionHeadline(summary({ cli: 'no-cli' }), false)).toBe('GitHub CLI not installed on this host.')
    expect(words.connectionHeadline(summary({ cli: 'signed-out' }), false)).toBe(
      'Not signed in to GitHub on this host.',
    )
    expect(words.connectionHeadline(null, true)).toBe('Could not check GitHub on this host.')
  })

  it('prefers the saved token the host selected and names its state in words', () => {
    const saved = {
      id: 'c1',
      origin: 'github.com',
      login: 'ana',
      enabled: true,
      selected: true,
      state: 'expired' as const,
      verifiedAt: null,
      scopes: [],
      detail: null,
    }
    expect(words.connectionHeadline(summary({ saved: [saved] }), false)).toBe(
      'The saved token for github.com needs attention.',
    )
    expect(words.savedDetail(saved)).toContain('Expired or revoked')
    expect(words.connectionHeadline(summary({ saved: [{ ...saved, state: 'connected' }] }), false)).toBe(
      'Connected as ana on github.com (saved token)',
    )
  })

  it('reports the CLI account in use', () => {
    const account = {
      host: 'github.com',
      login: 'bo',
      active: true,
      state: 'ok' as const,
      protocol: 'https',
      scopes: ['repo'],
    }
    expect(words.connectionHeadline(summary({ accounts: [account] }), false)).toBe(
      'Connected as bo on github.com (GitHub CLI)',
    )
    expect(words.accountDetail(account)).toBe('In use · Git over HTTPS · Permissions: repo')
  })
})
