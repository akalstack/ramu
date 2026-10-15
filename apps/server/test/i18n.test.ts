import { describe, expect, it } from 'vitest'
import { resolveLanguage, translate } from '@ramu/shared/i18n'
import { indonesian } from '@ramu/shared/locales/id'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { formatChatDate } from '@ramu/shared/chatDates'
import { createDispatcher, type Services } from '../src/ipc'
import { configureProviderBinaries } from '../src/providers/providerBinaries'

describe('app languages', () => {
  it('follows OS language preferences, including regional and legacy Indonesian codes', () => {
    expect(DEFAULT_APP_PREFERENCES.language).toBe('system')
    for (const locale of ['id', 'id-ID', 'ID_id', 'in-ID']) expect(resolveLanguage('system', [locale])).toBe('id')
    expect(resolveLanguage('system', ['en-GB', 'id-ID'])).toBe('en')
    expect(resolveLanguage('system', ['ja-JP', 'id-ID', 'en-US'])).toBe('id')
    expect(resolveLanguage('system', ['fr-FR'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
  })
  it('keeps explicit choices independent of OS preferences', () => {
    expect(resolveLanguage('en', ['id-ID'])).toBe('en')
    expect(resolveLanguage('id', ['en-US'])).toBe('id')
  })
  it('uses friendly Indonesian with English fallback and preserves adjacent spacing', () => {
    expect(translate('id', 'What should we work on?')).toBe('Mau kerjain apa hari ini?')
    expect(translate('id', ' Save changes ')).toBe(' Simpan perubahan ')
    expect(translate('en', ' Save changes ')).toBe(' Save changes ')
    expect(translate('id', 'New untranslated copy')).toBe('New untranslated copy')
    expect(translate('id', 'constructor')).toBe('constructor')
  })
  it('interpolates user values once and leaves missing placeholders intact', () => {
    expect(translate('id', 'New chat in {0}', { 0: 'My {project} $repo' })).toBe('Obrolan baru di My {project} $repo')
    expect(translate('en', 'New chat in {0}', { 0: 'Project' })).toBe('New chat in Project')
    expect(translate('id', 'New chat in {0}')).toBe('Obrolan baru di {0}')
    expect(translate('id', 'Context {0}% full', { 0: 0 })).toBe('Konteks terisi 0%')
  })
  it('keeps every catalog placeholder and never has an empty translation', () => {
    const placeholders = (copy: string) => [...copy.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [source, copy] of Object.entries(indonesian)) {
      expect(copy.trim(), source).not.toBe('')
      expect(placeholders(copy), source).toEqual(placeholders(source))
    }
  })
  it('formats conversation dates in the selected language', () => {
    const now = new Date(2026, 9, 11, 14, 5).getTime()
    expect(formatChatDate(now, now)).toMatch(/^Today /)
    expect(formatChatDate(now, now, 'id')).toMatch(/^Hari ini /)
    expect(formatChatDate(now - 86400_000, now, 'id')).toMatch(/^Kemarin /)
    expect(formatChatDate(now, now, 'id')).not.toMatch(/PM|AM/)
  })
  it('migrates old preferences, persists language, and validates the preference', () => {
    let saved: unknown = { accent: 'teal' }
    const dispatcher = createDispatcher({ userData: '/tmp/ramu-i18n-test', send: () => {}, native: async () => null }, {
      workspace: {
        getAppState: (key: string, fallback: unknown) => (key === 'app-preferences' ? saved : fallback),
        setAppState: (_key: string, value: unknown) => {
          saved = value
        },
      },
      recaps: { settingsChanged: () => {} },
      providers: { settingsChanged: () => {} },
      agents: { invalidateCatalog: () => {}, goalsSettingsChanged: () => {} },
    } as unknown as Services)
    try {
      expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ language: 'system', accent: 'teal' })
      for (const language of ['id', 'en', 'system']) {
        dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, language }])
        expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ language })
      }
      expect(() => dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, language: 'fr' }])).toThrow()
      dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, language: undefined }])
      expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ language: 'system' })
    } finally {
      dispatcher.close()
      configureProviderBinaries({})
    }
  })
})
