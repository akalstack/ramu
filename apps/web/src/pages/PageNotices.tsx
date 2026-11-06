import { useEffect } from 'react'
import { notify, type AppToastData } from '@/components/app-toaster'
import { t } from '../i18n'
import { useHostRuntime } from '../workspace/workspace'
import { TOAST_MS } from '../chat/notificationCenter'
import { openPage } from './openPage'

/** A page's notification on this desktop: a toast that opens the page. Phones get the same one as a push. */
export function PageNotices() {
  const { on } = useHostRuntime()
  useEffect(
    () =>
      on('pages:changed', (payload) => {
        const notice = payload.notice
        if (!notice) return
        const id = `page:${payload.pageId}:${Date.now()}`
        notify.add<AppToastData>({
          id,
          title: notice.title,
          description: notice.body,
          timeout: TOAST_MS.info,
          type: 'info',
          priority: 'high',
          actionProps: {
            children: t('Open page'),
            onClick: () => {
              openPage(payload.pageId)
              notify.close(id)
            },
          },
        })
      }),
    [on],
  )
  return null
}
