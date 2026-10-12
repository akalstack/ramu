import { resolveLanguage, translate, type Language, type LanguagePreference, type TranslationValues } from '../shared/i18n'

let language: Language = 'en'
export function configureDesktopLanguage(preference: LanguagePreference, systemLanguages: readonly string[]) {
  language = resolveLanguage(preference, systemLanguages)
}
export function desktopLanguage() { return language }
export function t(source: string, values?: TranslationValues) { return translate(language, source, values) }
