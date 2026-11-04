import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'
import { translate } from '@ramu/shared/i18n'
import { providerName } from '@ramu/shared/providers/providers'
import type { ModelNotice } from '@ramu/shared/types'
import { useStore } from '../runtime/store'
import { showToast } from '../runtime/toast'

/**
 * Tells the person once when a host's provider starts offering a new model, as the desktop does. Seeing the models
 * dismisses it on every device; a notice the host still lists is not shown again on this phone.
 */
export function ModelNewsToast() {
  const store = useStore()
  const router = useRouter()
  const latest = useRef({ store, router })
  latest.current = { store, router }
  const shown = useRef(new Set<string>())
  const online = store.computers.filter((computer) => store.isOnline(computer.id)).map((computer) => computer.id)
  const key = online.join(',')
  useEffect(() => {
    let live = true
    const show = (hostId: string, notices: ModelNotice[]) => {
      if (!live || latest.current.store.appPreferences[hostId]?.newModelNotices === false) return
      for (const notice of notices) {
        const id = `${hostId}:${notice.provider}:${notice.model}`
        if (shown.current.has(id)) continue
        shown.current.add(id)
        const say = (text: string, values?: Record<string, string>) =>
          translate(latest.current.store.language, text, values)
        showToast(`${say('New model: {0}', { '0': notice.name })} · ${providerName(notice.provider)}`, {
          label: 'seeModels',
          run: () => {
            void latest.current.store
              .invoke(hostId, 'models.dismissNews', notice.provider, notice.model)
              .catch(() => {})
            latest.current.router.push({ pathname: '/settings/[section]', params: { section: 'models' } })
          },
        })
      }
    }
    const offs = online.map((hostId) => {
      void latest.current.store
        .invoke(hostId, 'models.news')
        .then((notices) => show(hostId, notices))
        .catch(() => {})
      return latest.current.store.subscribe(hostId, (...[channel, payload]) => {
        if (channel === 'models:news') show(hostId, payload as ModelNotice[])
      })
    })
    return () => {
      live = false
      for (const off of offs) off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the hosts that are online
  }, [key])
  return null
}
