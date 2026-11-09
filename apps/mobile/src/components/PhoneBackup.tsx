import { useEffect, useRef } from 'react'
import * as Device from 'expo-device'
import { ACCOUNT_LIMITS } from '@ramu/shared/account'
import { autoBackup, backUpPhone } from '../runtime/account'
import { secureRandom } from '../runtime/secureRandom'
import { useStore } from '../runtime/store'
import { useTheme } from '../theme'

/**
 * Backs this phone's preferences up after one changes, once the phone was backed up by hand: a few seconds after the
 * change, and at most once a minute, like a host's backups. Failures wait for the next change.
 */
export function PhoneBackup() {
  const store = useStore()
  const theme = useTheme()
  const layout = Object.entries(store.drafts ?? {}).filter(([key]) => key.startsWith('pref-device:'))
  const fingerprint = JSON.stringify([
    theme.appearance,
    theme.textSize,
    store.language,
    theme.themes.map((entry) => entry.id),
    theme.theme.id,
    layout,
  ])
  const last = useRef({ fingerprint, at: 0 })
  useEffect(() => {
    if (fingerprint === last.current.fingerprint) return
    const wait = Math.max(5_000, last.current.at + ACCOUNT_LIMITS.uploadEveryMs - Date.now())
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await autoBackup())) return
        const random = await secureRandom()
        if (!random) return
        await backUpPhone(
          {
            appearance: theme.appearance,
            textSize: theme.textSize,
            language: store.language,
            themes: theme.themes,
            selectedTheme: theme.themes.some((entry) => entry.id === theme.theme.id) ? theme.theme.id : null,
            layout: Object.fromEntries(layout),
          },
          Device.deviceName || Device.modelName || 'Ramu phone',
          random,
        )
        last.current = { fingerprint, at: Date.now() }
      })().catch(() => {})
    }, wait)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the fingerprint of what a backup carries
  }, [fingerprint])
  return null
}
