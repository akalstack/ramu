import { ArrowRight } from 'lucide-react'
import type { ReviewBranchState } from '@ramu/shared/types'
import { t } from '../i18n'

export function ReviewBranchContext({ branches, error }: { branches: ReviewBranchState[]; error: string | null }) {
  return (
    <div
      className="review-branch-context flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-caption text-muted-foreground [border-bottom:1px_solid_var(--line)]"
      aria-label={t('Snapshot branch context')}
    >
      <span>{t('Run snapshot')}</span>
      {branches.map((branch) => (
        <div key={branch.repoId} className="flex min-w-0 flex-wrap items-center gap-1.5">
          {branches.length > 1 && <strong className="font-medium text-foreground">{branch.repoName}</strong>}
          <span>{t('Current')}</span>
          <span className="max-w-48 truncate text-foreground" title={branch.currentBranch ?? undefined}>
            {branch.currentBranch ?? t('No branch')}
          </span>
          <ArrowRight size={12} className="shrink-0" />
          <span>{t('Target')}</span>
          <span className="max-w-48 truncate text-foreground" title={branch.targetBranch ?? undefined}>
            {branch.targetBranch ?? t('No target')}
          </span>
          {branch.recordedBranch && branch.recordedBranch !== branch.currentBranch && (
            <span className="min-w-0 truncate" title={branch.recordedBranch}>
              {t('Recorded on {0}', { '0': branch.recordedBranch })}
            </span>
          )}
        </div>
      ))}
      {error && (
        <span role="status" title={error}>
          {t('Branch context unavailable')}
        </span>
      )}
    </div>
  )
}
