import { ContentSkeleton } from '@/components/content-skeleton'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { TabsContent } from '@/components/ui/tabs'
import type { GitCommit, GitStatus, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { CommitHistoryRow } from '../CommitHistoryRow'

/** Commit history list of the Git section. */
export function CommitsPane({
  taskId,
  binding,
  status,
  commits,
  loading,
  canUndo,
  onUndo,
}: {
  taskId: string
  binding: RepositoryBinding
  status: GitStatus | null
  commits: GitCommit[]
  loading: boolean
  canUndo: boolean
  onUndo: (commit: GitCommit) => void
}) {
  return (
    <TabsContent value="commits" className="git-pane">
      <OverlayScrollArea className="git-history">
        {loading ? (
          <ContentSkeleton />
        ) : commits.length ? (
          <div className="git-graph [&_.commit-file-tree]:m-[2px_0_4px] [&_.commit-file-tree]:pl-5 [&_.commit-file-tree::before]:[content:none] flex flex-col">
            {commits.map((commit) => (
              <CommitHistoryRow
                key={commit.oid}
                taskId={taskId}
                binding={binding}
                commit={commit}
                branch={status?.branch ?? null}
                onUndo={commit.oid === status?.oid ? () => onUndo(commit) : undefined}
                undoDisabled={!canUndo}
              />
            ))}
          </div>
        ) : (
          <p className="muted text-muted-foreground small text-caption git-empty m-[2px_0] p-1.5 text-caption leading-[1.5]">
            {t('No commits yet.')}
          </p>
        )}
      </OverlayScrollArea>
    </TabsContent>
  )
}
