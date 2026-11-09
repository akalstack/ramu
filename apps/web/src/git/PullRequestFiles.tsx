import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import type { PullRequestFile } from '@ramu/shared/types'
import { cn } from 'cn'
import { t } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { useHost } from '../workspace/HostProvider'
import { queryInvokerFor } from './hostQuery'

const STATUS_LABEL: Partial<Record<PullRequestFile['status'], string>> = {
  added: 'Added',
  removed: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
}

/** A patch's lines coloured as a diff reads: additions, removals and hunk headers. */
function Patch({ patch, truncated }: { patch: string; truncated?: boolean }) {
  return (
    <pre className="m-0 max-h-[480px] overflow-auto rounded-(--radius-s) bg-(--code,var(--fill)) p-2 font-mono text-[12px] leading-[18px]">
      {patch.split('\n').map((line, index) => (
        <div
          key={index}
          className={cn(
            'whitespace-pre',
            line.startsWith('+') && 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-foreground',
            line.startsWith('-') && 'bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] text-foreground',
            line.startsWith('@@') && 'text-muted-foreground',
          )}
        >
          {line || ' '}
        </div>
      ))}
      {truncated && (
        <div className="pt-1 text-muted-foreground">{t('The rest of this diff is too long to show here.')}</div>
      )}
    </pre>
  )
}

function FileRow({ file }: { file: PullRequestFile }) {
  const [open, setOpen] = useState(false)
  const status = STATUS_LABEL[file.status]
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto min-h-7 justify-start gap-1.5 px-1 py-1 text-left font-normal"
        aria-expanded={open}
        disabled={!file.patch}
        title={file.patch ? undefined : t('No diff to show for this file.')}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={12} className={cn('flex-none transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        {status && <span className="flex-none text-caption text-muted-foreground">{t(status)}</span>}
        <span className="flex-none text-caption tabular-nums">
          <span className="text-ok">+{file.additions}</span> <span className="text-bad">−{file.deletions}</span>
        </span>
      </Button>
      {open && file.patch && <Patch patch={file.patch} truncated={file.truncated} />}
    </div>
  )
}

/**
 * The files a pull request changes, each opening to its diff, so a review can start from the code without leaving
 * Ramu. Nothing shows where the service is not supported yet.
 */
export function PullRequestFiles({ taskId, repoId, url }: { taskId: string; repoId: string; url: string }) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const files = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequestFiles', taskId, repoId, url),
    queryFn: () => call('forge.pullRequestFiles', taskId, repoId, url),
    staleTime: 60_000,
  })
  const [open, setOpen] = useState(false)
  const data = files.data
  if (!data?.files.length) return null
  const added = data.files.reduce((sum, file) => sum + file.additions, 0)
  const removed = data.files.reduce((sum, file) => sum + file.deletions, 0)
  return (
    <section className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 justify-start gap-1.5 px-0 text-control font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
        {t('Changed files')}
        <span className="font-normal text-muted-foreground tabular-nums">
          {data.files.length}
          {data.more ? '+' : ''} · <span className="text-ok">+{added}</span>{' '}
          <span className="text-bad">−{removed}</span>
        </span>
      </Button>
      {open && (
        <div className="flex flex-col gap-px">
          {data.files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
          {data.more && (
            <p className="m-0 px-1 text-caption text-muted-foreground">
              {t('Showing the first {0} files. Open it on the hosting service for the rest.', {
                '0': data.files.length,
              })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
