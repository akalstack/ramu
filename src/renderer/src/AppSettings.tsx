import { configureLanguage } from './i18n'
import { BootScreen } from './Brand'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '../../shared/types'
import { invoke } from './ipc'
import { notifyError } from './Notifications'

const Context = createContext<{ preferences: AppPreferences; reload: () => Promise<void>; save: (preferences: AppPreferences) => Promise<void> } | null>(null)
export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_APP_PREFERENCES)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void Promise.all([invoke('settings.app.get'), invoke('app.systemLanguages').catch(() => navigator.languages)]).then(([saved, languages]) => { const next = { ...DEFAULT_APP_PREFERENCES, ...saved }; configureLanguage(next.language, languages); setPreferences(next) }, (reason) => notifyError(String(reason), 'Settings')).finally(() => setLoaded(true))
  }, [])
  useEffect(() => {
    if (preferences.language !== 'system') return
    let disposed = false
    const refresh = () => { void invoke('app.systemLanguages').then((languages) => { if (!disposed) configureLanguage('system', languages) }, () => {}) }
    window.addEventListener('languagechange', refresh)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; window.removeEventListener('languagechange', refresh); window.removeEventListener('focus', refresh) }
  }, [preferences.language])
  useEffect(() => {
    const root = document.documentElement
    const colors = { blue: ['#0a84ff', '#3395ff', '#64a8ff'], violet: ['#7652d4', '#8060d8', '#b7a6f3'], teal: ['#087f7b', '#11928e', '#5bd4ca'] }[preferences.accent]
    root.style.setProperty('--primary', colors[0]!)
    root.style.setProperty('--primary-hover', colors[1]!)
    root.style.setProperty('--accent', colors[2]!)
    root.style.setProperty('--sans', preferences.fontFamily === 'system' ? "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif" : "'Geist Variable', -apple-system, BlinkMacSystemFont, sans-serif")
    root.style.setProperty('--ui-font-size', `${preferences.fontSize}px`)
  }, [preferences])
  return <Context.Provider value={{ preferences, reload: async () => { setPreferences({ ...DEFAULT_APP_PREFERENCES, ...await invoke('settings.app.get') }) }, save: async (value) => { await invoke('settings.app.set', value); const languages = value.language === 'system' ? await invoke('app.systemLanguages').catch(() => navigator.languages) : undefined; configureLanguage(value.language, languages); setPreferences(value) } }}>{loaded ? children : <BootScreen />}</Context.Provider>
}
export function useAppSettings() { const value = useContext(Context); if (!value) throw new Error('AppSettingsProvider missing'); return value }
