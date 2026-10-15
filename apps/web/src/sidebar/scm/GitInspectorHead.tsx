import { CloudDownload, CloudUpload, GitBranch, RefreshCcw } from 'lucide-react'
import type { GitStatus, RepositoryBinding } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../../i18n'
import { useAppSettings } from '../../settings/AppSettings'
import { Dropdown } from '../../Menu'
import { GIT_INSPECTOR_HEAD, ICON_BUTTON } from './classes'
import { PULL_NAME } from './constants'
import { Caret } from './parts'

/** Foldable "Git" heading with the repository switcher, a branch summary when folded, and fetch / sync. */
export function GitInspectorHead({
  repoId,
  switchableRepos,
  status,
  busy,
  open,
  onToggle,
  onRepo,
  onFetch,
  onSync,
}: {
  repoId: string
  /** Repositories to switch between; empty when there is nothing to switch to. */
  switchableRepos: RepositoryBinding[]
  status: GitStatus | null
  busy: boolean
  open: boolean
  onToggle: () => void
  onRepo: (repoId: string) => void
  onFetch: () => void
  onSync: () => void
}) {
  const { preferences } = useAppSettings()
  return (
    <div className={GIT_INSPECTOR_HEAD}>
      <Button variant="tree" className="git-inspector-heading" aria-expanded={open} onClick={onToggle}>
        <Caret open={open} />
        Git
      </Button>
      {switchableRepos.length > 0 && (
        <Dropdown
          label={t('Switch repository')}
          value={repoId}
          className="git-repo-picker"
          options={switchableRepos.map((repo) => ({ value: repo.repoId, label: repo.repoName }))}
          onChange={onRepo}
        />
      )}
      {!open && status?.branch && (
        <span
          className="git-head-summary [&_>_span:first-of-type]:min-w-0 [&_>_span:first-of-type]:overflow-hidden [&_>_span:first-of-type]:text-ellipsis [&_svg]:flex-none inline-flex items-center gap-[5px] min-w-0 p-[0_6px_0_4px] text-muted-foreground text-caption whitespace-nowrap"
          title={status.upstream ?? undefined}
        >
          <GitBranch size={12} />
          <span>{status.branch}</span>
          {!!status.behind && (
            <span className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums">↓{status.behind}</span>
          )}
          {!!status.ahead && (
            <span className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums">↑{status.ahead}</span>
          )}
        </span>
      )}
      <span className="grow flex-1 min-w-0 text-left" />
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON}
        aria-label={t('Fetch repository')}
        title={t('Fetch from remote')}
        disabled={busy || !status?.remote}
        onClick={onFetch}
      >
        <CloudDownload size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON}
        aria-label={t('Sync repository')}
        title={
          status?.upstream
            ? t('Sync changes: pull {0} ({1}), then push {2}', {
                '0': status.behind,
                '1': PULL_NAME[preferences.pullMode],
                '2': status.ahead,
              })
            : t('Publish branch')
        }
        disabled={busy || !status?.branch || !!status.operation || !status.remote}
        onClick={onSync}
      >
        {status?.upstream || !status?.remote ? (
          <RefreshCcw size={13} className={busy ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} />
        ) : (
          <CloudUpload size={13} />
        )}
      </Button>
    </div>
  )
}
