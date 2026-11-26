import { ChevronDown, CloudUpload, GitPullRequest, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { formatKeys } from '../commands'
import { Menu } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useWorkspace } from '../workspace/workspace'
import { GHOST_TEXT_BUTTON_CLASS } from '../views/agent/styles'
import { commitAndPush } from './commitShortcut'
import { useAnyGitBusy } from './gitBusy'
import { useGitChangeCount } from './useGitChangeCount'
import { useAnyPullRequestSupport } from './usePullRequestSupport'
import { useHost } from '../workspace/HostProvider'

/** Source Control's Commit & push for a chat's or project's checkout: shown only while it has changes, same smart commit as the shortcut. */
export function CommitPushButton({ taskId }: { taskId: string }) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke } = useHost()
  const bindings = (ws.bindings[taskId] ?? []).filter((binding) => !binding.folderOnly)
  const changes = useGitChangeCount(taskId, bindings)
  // Spinning only while git is really working; choosing in the popup, or cancelling it, leaves the button alone.
  const busy = useAnyGitBusy(
    taskId,
    bindings.map((binding) => binding.repoId),
  )
  const canCreatePr = useAnyPullRequestSupport(
    taskId,
    bindings.map((binding) => binding.repoId),
  )
  if (!changes && !busy) return null
  return (
    // One control in two parts: pointing at either lights the whole of it, with a line between, so the arrow reads
    // as belonging to the button rather than as a stray icon beside it.
    <span className="commit-push-group group/split inline-flex items-stretch rounded-(--radius-s) transition-colors hover:bg-fill-hover focus-within:bg-fill-hover has-[[aria-expanded=true]]:bg-fill-hover">
      <Button
        variant="ghost"
        size="sm"
        className={`${GHOST_TEXT_BUTTON_CLASS} commit-push-chip gap-1.5 rounded-r-none pr-2 text-soft`}
        disabled={busy}
        title={`${t('Commit & Push')} (${formatKeys('mod+alt+p')})`}
        onClick={() => void commitAndPush(ws, taskId, false, invoke).catch(() => {})}
      >
        {busy ? (
          <LoaderCircle size={13} className="spin [animation:spin_0.9s_linear_infinite]" />
        ) : (
          <CloudUpload size={13} />
        )}
        {t('Commit & Push')}
      </Button>
      <span
        aria-hidden
        className="my-1.5 w-px flex-none bg-transparent transition-colors group-hover/split:bg-(--line-strong) group-focus-within/split:bg-(--line-strong)"
      />
      <Menu
        disabled={busy}
        label={t('More commit actions')}
        icon={<ChevronDown size={12} />}
        className={`${GHOST_TEXT_BUTTON_CLASS} h-auto rounded-l-none px-1.5 text-soft`}
        align="end"
        items={[
          {
            key: 'push',
            label: (
              <>
                <CloudUpload size={14} />
                {t('Commit & Push')}
              </>
            ),
            onSelect: () => void commitAndPush(ws, taskId, false, invoke).catch(() => {}),
          },
          ...(canCreatePr
            ? [
                {
                  key: 'pull-request',
                  label: (
                    <>
                      <GitPullRequest size={14} />
                      {t('Commit, Push & PR')}
                    </>
                  ),
                  onSelect: () => void commitAndPush(ws, taskId, true, invoke).catch(() => {}),
                },
              ]
            : []),
        ]}
      />
    </span>
  )
}
