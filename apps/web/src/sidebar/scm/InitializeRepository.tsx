import { Button } from '@/components/desktop-button'
import type { RepositoryBinding } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { invoke } from '../../ipc'
import { errorText } from '../../workspace/TaskPane'
import { useGitBusy, withGitBusy } from '../../git/gitBusy'
import { notifyError } from '../../chat/Notifications'
import { useWorkspace } from '../../workspace/workspace'
import { PRIMARY_BUTTON } from './classes'

/** A project folder without Git: offers `git init`, like VS Code's Initialize Repository. */
export function InitializeRepository({ taskId, binding }: { taskId: string; binding: RepositoryBinding }) {
  useLanguage()
  const ws = useWorkspace()
  const busy = useGitBusy(taskId, binding.repoId)
  const init = () =>
    void withGitBusy(taskId, binding.repoId, () => invoke('git.init', taskId, binding.repoId))
      .then(() => ws.refreshBindings(taskId))
      .then(() => window.dispatchEvent(new Event('ramu:git-updated')))
      .catch((reason) => notifyError(errorText(reason), `Git · ${binding.repoName}`))
  return (
    <div className="scm-init flex flex-col gap-2 p-[4px_8px_12px]">
      <p className="muted text-muted-foreground text-control leading-[1.5]">
        {t("The folder “{0}” isn't a Git repository. You can initialize one to track changes with Source Control.", {
          '0': binding.repoName,
        })}
      </p>
      <Button variant="default" className={PRIMARY_BUTTON} disabled={busy} onClick={init}>
        {t('Initialize Repository')}
      </Button>
    </div>
  )
}
