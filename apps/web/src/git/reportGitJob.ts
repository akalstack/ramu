import { notify, type AppToastData } from '@/components/app-toaster'
import { notices } from '../chat/notificationCenter'

/** Shown briefly when nothing else on screen (the Source Control panel) tells the user a shortcut commit went through. */
const SHORTCUT_SUCCESS_MS = 3000

/**
 * Reports a git job the user started: the busy state already shows it running and success is only a bell notice, so
 * nothing pops up. A failure also stays as a toast until dismissed. `toastSuccess` adds a short success toast for
 * jobs started where no panel shows the result.
 */
export function reportGitJob<T>(
  work: Promise<T>,
  options: {
    id: string
    success: (result: T) => string
    failure: { description: string; message: (reason: unknown) => string }
    toastSuccess?: boolean
  },
): Promise<void> {
  const { id } = options
  return work.then(
    (result) => {
      const title = options.success(result)
      notices.add({ id, title, type: 'success' })
      if (options.toastSuccess) notify.add({ id, title, type: 'success', timeout: SHORTCUT_SUCCESS_MS })
    },
    (reason) => {
      const title = options.failure.message(reason)
      const { description } = options.failure
      notices.add({ id, title, description, type: 'error' })
      notify.add<AppToastData>({
        id,
        title,
        description,
        type: 'error',
        timeout: 0,
        data: { onDismiss: () => notices.remove(id) },
      })
    },
  )
}
