import { CloudUpload, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { formatKeys } from '../commands'
import { t, useLanguage } from '../i18n'
import { useWorkspace } from '../workspace/workspace'
import { GHOST_TEXT_BUTTON_CLASS } from '../views/agent/styles'
import { commitAndPush } from './commitShortcut'
import { useAnyGitBusy } from './gitBusy'
import { useGitChangeCount } from './useGitChangeCount'

/** Source Control's Commit & push for a chat's or project's checkout: shown only while it has changes, same smart commit as the shortcut. */
export function CommitPushButton({ taskId }: { taskId: string }) {
  useLanguage()
  const ws = useWorkspace()
  const changes = useGitChangeCount(taskId, ws.bindings[taskId] ?? [])
  // Spinning only while git is really working; choosing in the popup, or cancelling it, leaves the button alone.
  const busy = useAnyGitBusy(
    taskId,
    (ws.bindings[taskId] ?? []).map((binding) => binding.repoId),
  )
  if (!changes && !busy) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`${GHOST_TEXT_BUTTON_CLASS} commit-push-chip gap-1.5 text-soft`}
      disabled={busy}
      title={`${t('Commit & Push')} (${formatKeys('mod+alt+p')})`}
      onClick={() => void commitAndPush(ws, taskId).catch(() => {})}
    >
      {busy ? (
        <LoaderCircle size={13} className="spin [animation:spin_0.9s_linear_infinite]" />
      ) : (
        <CloudUpload size={13} />
      )}
      {t('Commit & Push')}
    </Button>
  )
}
