import { notify } from '@/components/app-toaster'
import { t } from '../../i18n'
import { TOAST_MS } from '../../chat/notificationCenter'
import { formatSize, type TransferProgress } from './transfer'

const describe = (progress: TransferProgress) =>
  progress.totalFiles === 1
    ? t('{0} of {1}', { 0: formatSize(progress.bytes), 1: formatSize(progress.totalBytes) })
    : t('{0} of {1} files · {2} of {3}', {
        0: progress.files,
        1: progress.totalFiles,
        2: formatSize(progress.bytes),
        3: formatSize(progress.totalBytes),
      })

/**
 * Runs a copy between computers behind one toast: live progress with Cancel while it runs, then what happened.
 * Resolves to null when the person cancelled; other failures reject for the caller to report.
 */
export async function withTransferToast<T>(
  labels: { running: string; done: (result: T) => string; detail?: string },
  run: (signal: AbortSignal, onProgress: (progress: TransferProgress) => void) => Promise<T>,
): Promise<T | null> {
  const controller = new AbortController()
  const id = notify.add({
    type: 'loading',
    title: labels.running,
    description: t('Preparing…'),
    timeout: 0,
    actionProps: { children: t('Cancel'), onClick: () => controller.abort() },
  })
  let shown = 0
  const onProgress = (progress: TransferProgress) => {
    const now = Date.now()
    // Chunks can land many times a second; a few updates a second read as smooth without re-rendering constantly.
    if (now - shown < 200 && progress.bytes < progress.totalBytes) return
    shown = now
    notify.update(id, { description: describe(progress) })
  }
  try {
    const result = await run(controller.signal, onProgress)
    notify.update(id, {
      type: 'success',
      title: labels.done(result),
      description: labels.detail,
      timeout: TOAST_MS.success,
      actionProps: undefined,
    })
    return result
  } catch (reason) {
    notify.close(id)
    if (controller.signal.aborted) return null
    throw reason
  }
}
