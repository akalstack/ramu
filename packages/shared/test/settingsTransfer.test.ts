import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '../src/types'
import { defaultGroups, portablePreferences, transferChanges, type SettingsExport } from '../src/settingsTransfer'

const empty = { identities: [], accounts: {}, pins: {} }

describe('moving settings between hosts', () => {
  it('exports only the chosen portable groups, never provider paths', () => {
    const exported = portablePreferences({ ...DEFAULT_APP_PREFERENCES, accent: 'teal' }, ['appearance'])
    expect(exported.accent).toBe('teal')
    expect(exported).not.toHaveProperty('providerBinaries')
    expect(exported).not.toHaveProperty('commitStyle')
  })

  it('lists every value that would change, and nothing that would not', () => {
    const file: SettingsExport = {
      format: 'ramu-settings',
      version: 2,
      exportedAt: 1,
      host: 'mac',
      groups: ['appearance', 'rules', 'memories'],
      preferences: { ...portablePreferences(DEFAULT_APP_PREFERENCES, ['appearance']), accent: 'teal' },
      rules: [
        {
          name: 'Sign commits',
          body: 'Sign every commit.',
          activation: 'always',
          paths: [],
          providers: [],
          enabled: true,
          identityId: null,
        },
      ],
      memories: [{ kind: 'user', title: 'Prefers pnpm', content: 'Use pnpm.', tags: [], importance: 3 }],
    }
    const changes = transferChanges(
      { preferences: DEFAULT_APP_PREFERENCES, models: null, rules: [], identities: empty, notes: [] },
      file,
      ['appearance', 'rules', 'memories'],
    )
    expect(changes.map((change) => change.label)).toEqual(['accent', 'Rule: Sign commits', 'Note: Prefers pnpm'])
    expect(
      transferChanges(
        { preferences: DEFAULT_APP_PREFERENCES, models: null, rules: [], identities: empty, notes: [] },
        file,
        ['appearance'],
      ),
    ).toHaveLength(1)
  })

  it('leaves identities and notes unchecked unless the source has its own identities', () => {
    expect(defaultGroups({})).not.toContain('identities')
    expect(defaultGroups({})).not.toContain('memories')
  })
})
