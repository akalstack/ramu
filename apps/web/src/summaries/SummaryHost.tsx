import { notify, type AppToastData } from '@/components/app-toaster'
import { Sparkles } from 'lucide-react'
import { useEffect } from 'react'
import { notices, TOAST_MS } from '../chat/notificationCenter'
import { t } from '../i18n'
import { invoke, ramu } from '../ipc'
import { openSummary, useOpenSummary } from './openSummary'
import { SummaryView } from './SummaryView'

/**
 * Mounted once: shows the summary view wherever it was opened from, and raises a notification when a new summary is ready.
 * The notification waits in the activity popover until it is opened or dismissed.
 */
export function SummaryHost() {
  const open = useOpenSummary()
  useEffect(
    () =>
      ramu.on('summaries:changed', ({ created }) => {
        if (!created) return
        const id = `summary:${created}`
        void invoke('summaries.get')
          .then((snapshot) => {
            const summary = snapshot.summaries.find((entry) => entry.id === created)
            if (!summary || summary.status !== 'unread') return
            const view = () => {
              notify.close(id)
              notices.remove(id)
              openSummary(created)
            }
            const icon = <Sparkles size={16} />
            notify.add<AppToastData>({
              id,
              timeout: TOAST_MS.info,
              title: t('What Ramu learned'),
              description: summary.headline,
              data: { icon, onDismiss: () => notices.remove(id) },
              actionProps: { children: t('View'), onClick: view },
            })
            notices.add({
              id,
              title: t('What Ramu learned'),
              description: summary.headline,
              type: 'info',
              icon,
              actionLabel: t('View'),
              onAction: view,
            })
          })
          .catch(() => {})
      }),
    [],
  )
  return open ? <SummaryView key={open.id} id={open.id} call={open.call} /> : null
}
