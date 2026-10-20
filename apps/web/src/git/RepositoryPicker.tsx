import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check, ChevronDown, RefreshCcw } from 'lucide-react'
import type { GitBranchInfo, GitStatus, PullMode, RepositoryBinding } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from '@/components/ui/popover'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { queryInvokerFor } from './hostQuery'
import { repositoryQueryKey } from './repositoryQueryKey'
import { BranchPicker, SyncButton } from './GitControls'
import { useGitBusy } from './gitBusy'

/** All repository branches stay within reach without changing the status bar's target first. */
export function RepositoryPicker({
  taskId,
  bindings,
  value,
  onChange,
  onBranchChange,
  onSync,
  onSyncAll,
  onPublishRepository,
  pullMode,
}: {
  taskId: string
  bindings: RepositoryBinding[]
  value: string
  onChange: (repoId: string) => void
  onBranchChange: (binding: RepositoryBinding, branch: string) => void
  onSync: (binding: RepositoryBinding) => void
  onSyncAll: () => void
  onPublishRepository: (binding: RepositoryBinding) => void
  pullMode: PullMode
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const { id: host } = useHost()
  const call = queryInvokerFor(host)
  const statuses = useQueries({
    queries: bindings.map((binding) => ({
      queryKey: repositoryQueryKey(host, 'git.status', binding),
      queryFn: () => call('git.status', taskId, binding.repoId),
      enabled: open,
    })),
  })
  const branches = useQueries({
    queries: bindings.map((binding) => ({
      queryKey: repositoryQueryKey(host, 'git.branches', binding),
      queryFn: () => call('git.branches', taskId, binding.repoId),
      enabled: open,
    })),
  })
  const selected = bindings.find((binding) => binding.repoId === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" className="status-repo strong font-semibold" />}
        aria-label={t('Switch repository')}
        title={t('Switch repository')}
      >
        <span className="min-w-0 truncate">{selected?.repoName}</span>
        <span className="text-muted-foreground">{bindings.length}</span>
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[520px] max-w-[calc(100vw-16px)] gap-1 p-2 text-caption">
        <div className="flex items-center justify-between gap-2 px-1.5 py-1">
          <PopoverTitle className="m-0 text-caption text-muted-foreground">{t('Repositories')}</PopoverTitle>
          <Button
            variant="ghost"
            className="min-h-6 gap-1.5 px-1.5 py-0 text-caption!"
            onClick={() => {
              setOpen(false)
              onSyncAll()
            }}
          >
            <RefreshCcw data-icon="inline-start" />
            {t('Sync all')}
          </Button>
        </div>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {bindings.map((binding, index) => {
            const result = statuses[index]!
            const branchResult = branches[index]!
            const error = result.isError || branchResult.isError
            return (
              <div key={binding.repoId} role="group" aria-label={binding.repoName} className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start gap-1.5 px-1.5 py-1 text-caption!"
                  aria-pressed={binding.repoId === value}
                  title={binding.cwd}
                  onClick={() => onChange(binding.repoId)}
                >
                  <Check className={binding.repoId === value ? 'shrink-0' : 'invisible shrink-0'} aria-hidden="true" />
                  <span className="truncate">{binding.repoName}</span>
                </Button>
                <div className="min-w-0 flex-[2]">
                  {result.data ? (
                    <RepositoryBranchControl
                      taskId={taskId}
                      binding={binding}
                      status={result.data}
                      branches={branchResult.data ?? []}
                      onChange={(branch) => onBranchChange(binding, branch)}
                      onSync={() => onSync(binding)}
                      onPublishRepository={() => {
                        setOpen(false)
                        onPublishRepository(binding)
                      }}
                      pullMode={pullMode}
                    />
                  ) : (
                    <span className="block truncate px-1.5 text-caption text-muted-foreground">
                      {error ? t('Could not load branch') : t('Loading…')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RepositoryBranchControl({
  taskId,
  ...props
}: {
  taskId: string
  binding: RepositoryBinding
  status: GitStatus
  branches: GitBranchInfo[]
  onChange: (branch: string) => void
  onSync: () => void
  onPublishRepository: () => void
  pullMode: PullMode
}) {
  const busy = useGitBusy(taskId, props.binding.repoId)
  return (
    <div className="flex min-w-0 items-center gap-1">
      <BranchPicker {...props} busy={busy} className="min-w-0 flex-1 text-caption!" />
      <div className="flex w-24 shrink-0 justify-end [&_button]:min-h-6 [&_button]:text-caption!">
        <SyncButton
          status={props.status}
          busy={busy}
          pullMode={props.pullMode}
          onSync={props.onSync}
          onPublishRepository={props.onPublishRepository}
        />
      </div>
    </div>
  )
}
