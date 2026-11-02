import { notify } from '@/components/app-toaster'
import { t } from '../../i18n'
import { notifyError } from '../../chat/Notifications'
import { TOAST_MS } from '../../chat/notificationCenter'
import { errorText } from '../../workspace/TaskPane'

/**
 * After threads leave the list (marked done or archived), says so and offers to bring them back. Pinning, reopening and
 * unarchiving stay in view where the person did them, so a mis-click there is visible and costs one click.
 */
export function offerThreadUndo(change: 'done' | 'archived', count: number, undo: () => Promise<unknown>) {
  const title =
    change === 'done'
      ? count > 1
        ? t('Marked {0} threads done', { 0: count })
        : t('Marked done')
      : count > 1
        ? t('Archived {0} threads', { 0: count })
        : t('Archived')
  notify.add({
    timeout: TOAST_MS.info,
    title,
    actionProps: { children: t('Undo'), onClick: () => void undo().catch((error) => notifyError(errorText(error))) },
  })
}
