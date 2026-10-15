import { indonesian } from './locales/id'

export type Language = 'en' | 'id'
export type LanguagePreference = 'system' | Language
export type TranslationValues = Readonly<Record<string, string | number | boolean | null | undefined>>

/** Use the first supported OS preference; fall back to English for other languages. */
export function resolveLanguage(preference: LanguagePreference, systemLanguages: readonly string[]): Language {
  if (preference === 'en' || preference === 'id') return preference
  for (const locale of systemLanguages) {
    const language = locale.toLowerCase().replace(/_/g, '-').split('-')[0]
    if (language === 'id' || language === 'in') return 'id'
    if (language === 'en') return 'en'
  }
  return 'en'
}

export function translate(language: Language, source: string, values: TranslationValues = {}): string {
  // Preserve intentional JSX spacing around adjacent icons and interpolated values.
  const key = source.trim()
  const copy =
    language === 'id' && Object.hasOwn(indonesian, key)
      ? source.slice(0, source.indexOf(key)) + indonesian[key]! + source.slice(source.indexOf(key) + key.length)
      : source
  return copy.replace(/\{([\w]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
}
