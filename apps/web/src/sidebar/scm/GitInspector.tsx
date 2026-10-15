import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Archive, GitCommitHorizontal } from 'lucide-react'
import type { GitBranchInfo, GitCommit, GitStash, GitStatus, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { BranchSection } from './BranchSection'
import { GIT_INSPECTOR } from './classes'
import { CommitsPane } from './CommitsPane'
import { GitInspectorHead } from './GitInspectorHead'
import { StashesPane } from './StashesPane'
import type { GitTab } from './types'

/** The pinned Git section: branch, tracking state, commit history and stashes of one repository. */
export function GitInspector({
  taskId,
  binding,
  status,
  branches,
  commits,
  stashes,
  loading,
  busy,
  canStash,
  canUndo,
  open,
  tab,
  switchableRepos,
  onOpen,
  onTab,
  onRepo,
  onFetch,
  onSync,
  onCheckout,
  onUndo,
  onApplyStash,
  onPopStash,
  onDropStash,
  onStash,
}: {
  taskId: string
  binding: RepositoryBinding
  status: GitStatus | null
  branches: GitBranchInfo[]
  commits: GitCommit[]
  stashes: GitStash[]
  loading: boolean
  busy: boolean
  canStash: boolean
  canUndo: boolean
  open: boolean
  tab: GitTab
  switchableRepos: RepositoryBinding[]
  onOpen: (open: boolean) => void
  onTab: (tab: GitTab) => void
  onRepo: (repoId: string) => void
  onFetch: () => void
  onSync: () => void
  onCheckout: (branch: string) => void
  onUndo: (commit: GitCommit) => void
  onApplyStash: (stash: GitStash) => void
  onPopStash: (stash: GitStash) => void
  onDropStash: (stash: GitStash) => void
  onStash: () => void
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTab(value as GitTab)}
      render={<section />}
      className={`${GIT_INSPECTOR} ${open ? '' : ' collapsed'}`}
    >
      <GitInspectorHead
        repoId={binding.repoId}
        switchableRepos={switchableRepos}
        status={status}
        busy={busy}
        open={open}
        onToggle={() => onOpen(!open)}
        onRepo={onRepo}
        onFetch={onFetch}
        onSync={onSync}
      />
      {open && (
        <>
          <BranchSection
            taskId={taskId}
            binding={binding}
            status={status}
            branches={branches}
            busy={busy}
            onCheckout={onCheckout}
          />
          <TabsList className="git-tabs" aria-label={t('Git view')}>
            <TabsTrigger value="commits" className="git-tab" aria-label={t('Commits')}>
              <GitCommitHorizontal size={14} className="flex-none" aria-hidden="true" />
              {t('Commits')}
            </TabsTrigger>
            <TabsTrigger value="stashes" className="git-tab" aria-label={t('Stashes ({0})', { '0': stashes.length })}>
              <Archive size={14} className="flex-none" aria-hidden="true" />
              {t('Stashes')}
              {!!stashes.length && (
                <span className="git-tab-count inline-grid place-items-center min-w-4 h-4 p-[0_4px] rounded-(--radius-s) bg-accent text-soft text-[length:10px] leading-[1] tabular-nums">
                  {stashes.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <CommitsPane
            taskId={taskId}
            binding={binding}
            status={status}
            commits={commits}
            loading={loading}
            canUndo={canUndo}
            onUndo={onUndo}
          />
          <StashesPane
            taskId={taskId}
            binding={binding}
            stashes={stashes}
            loading={loading}
            busy={busy}
            canStash={canStash}
            onApply={onApplyStash}
            onPop={onPopStash}
            onDrop={onDropStash}
            onStash={onStash}
          />
        </>
      )}
    </Tabs>
  )
}
