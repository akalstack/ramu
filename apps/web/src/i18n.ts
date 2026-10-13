import { useSyncExternalStore } from 'react'
import { resolveLanguage, translate, type Language, type LanguagePreference, type TranslationValues } from '@ramu/shared/i18n'

let language: Language = resolveLanguage('system', navigator.languages)
let preference: LanguagePreference = 'system'
let systemLanguages: readonly string[] = navigator.languages
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => language

export function configureLanguage(nextPreference: LanguagePreference, nextSystemLanguages = systemLanguages) {
  preference = nextPreference
  systemLanguages = nextSystemLanguages
  const next = resolveLanguage(preference, systemLanguages)
  document.documentElement.lang = next
  if (language === next) return
  language = next
  for (const listener of listeners) listener()
}

/** Subscribe without remounting editors, terminals, or active chats. */
export function useLanguage() { return useSyncExternalStore(subscribe, snapshot) }
export function currentLanguage() { return language }
export function formatLocale() { return language === 'id' ? 'id-ID' : 'en-US' }
export function t(source: string, values?: TranslationValues) { return translate(language, source, values) }

