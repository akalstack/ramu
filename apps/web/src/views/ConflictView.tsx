import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleCheck, FileText, Sparkles } from 'lucide-react'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Button } from '@/components/desktop-button'
import type { ConflictChoice, ConflictHunk } from '@ramu/shared/conflicts'
import type { RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { cn } from 'cn'
import { t, useLanguage } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { queryInvokerFor } from '../git/hostQuery'
import { useModelSets } from '../models/ModelSets'
import { CHOICE_LABEL } from '../sidebar/scm/ConflictList'
import { startConflictChat } from '../sidebar/scm/useResolveWithAi'
import { errorText } from '../workspace/TaskPane'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace } from '../workspace/workspace'

type View = Extract<ViewDescriptor, { kind: 'conflict' }>

const FILE_LABEL: Record<ConflictChoice, string> = {
  current: 'Accept current in this file',
  incoming: 'Accept incoming in this file',
  both: 'Accept both in this file',
}

/** Lines shown above each conflict so it can be told apart from the others. */
const CONTEXT = 3

const REASON: Record<'binary' | 'too-large' | 'deleted', string> = {
  binary: 'This is a binary file, so it has no conflict markers. Keep one side of the whole file.',
  'too-large': 'This file is too large to show here. Keep one side of the whole file, or edit it in the editor.',
  deleted: 'One side deleted this file and the other changed it. Keep the change or the deletion.',
}

function Side({ title, lines, tone }: { title: string; lines: string[]; tone: 'current' | 'incoming' | 'base' }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div
        className={cn(
          'px-2 py-0.5 text-caption font-medium',
          tone === 'current' ? 'text-ok' : tone === 'incoming' ? 'text-brand' : 'text-muted-foreground',
        )}
      >
        {title}
      </div>
      <pre
        className={cn(
          'm-0 min-h-6 overflow-x-auto px-2 py-1 font-mono text-[length:var(--font-code,12px)] leading-[1.5] whitespace-pre',
          tone === 'current' ? 'bg-ok/10' : tone === 'incoming' ? 'bg-brand/10' : 'bg-fill',
        )}
      >
        {lines.length ? lines.join('\n') : <span className="text-muted-foreground">{t('(nothing)')}</span>}
      </pre>
    </div>
  )
}

/**
 * A conflicted file one conflict at a time, as editors show it: what you have (current), what is coming in, and the
 * common ancestor when Git recorded it. Each conflict, or the whole file, keeps a side; the file is staged once none
 * are left.
 */
export function ConflictView({ taskId, view, binding }: { taskId: string; view: View; binding: RepositoryBinding }) {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const { invoke } = host
  const call = queryInvokerFor(host.id)
  const { initialSettings } = useModelSets()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'git.conflictFile', taskId, view.repoId, view.path),
    queryFn: () => call('git.conflictFile', taskId, view.repoId, view.path),
    retry: false,
  })
  const status = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'git.status', taskId, view.repoId),
    queryFn: () => call('git.status', taskId, view.repoId),
  })
  const others = (status.data?.entries ?? []).filter((entry) => entry.staged === 'unmerged' && entry.path !== view.path)

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      if (Object.values(ws.dirty).some(Boolean))
        throw new Error(t('Save or close unsaved editor buffers before changing files or branches.'))
      await work()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
      await Promise.all([file.refetch(), status.refetch()])
      window.dispatchEvent(new Event('ramu:git-updated'))
    }
  }
  const choose = (choice: ConflictChoice, hunk?: number) =>
    run(() => invoke('git.resolveConflict', taskId, view.repoId, view.path, choice, hunk, file.data?.hash ?? undefined))
  const openNext = () => {
    const next = others[0]
    if (next) ws.openView(taskId, { kind: 'conflict', repoId: view.repoId, path: next.path })
  }
  const withAi = () =>
    run(() =>
      startConflictChat(ws, invoke, {
        taskId,
        binding,
        kind: status.data?.operation ?? 'merge',
        paths: [view.path],
        whole: false,
        settings: initialSettings,
      }),
    )

  // A file that is no longer conflicted was resolved here, by an agent or by hand.
  const resolved = file.isError && /no conflict to resolve/i.test(errorText(file.error))
  const data = file.data
  const contextOf = (hunk: ConflictHunk) => {
    const all = data?.text?.split(/\r?\n/) ?? []
    return all.slice(Math.max(0, hunk.line - CONTEXT), hunk.line).filter((line) => !/^[<=>|]{7}/.test(line))
  }
  const sides = (['current', 'incoming', 'both'] as const).filter(
    (choice) => (data?.hunks.length ?? 0) > 0 || choice !== 'both',
  )

  return (
    <OverlayScrollArea className="flex-1 min-h-0">
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 p-6">
        <header className="flex flex-col gap-2">
          <h2 className="m-0 min-w-0 font-mono text-control font-semibold [overflow-wrap:anywhere]">{view.path}</h2>
          {data && (
            <p className="m-0 text-caption text-muted-foreground">
              {data.hunks.length
                ? t('{0} conflicts left. Changes Git merged cleanly are kept.', { '0': String(data.hunks.length) })
                : data.reason
                  ? t(REASON[data.reason])
                  : t('No conflict markers are left. Mark it resolved in Source Control when it looks right.')}
            </p>
          )}
          {data && (
            <div className="flex flex-wrap gap-1.5">
              {sides.map((choice) => (
                <Button
                  key={choice}
                  variant={choice === 'current' ? 'default' : 'secondary'}
                  size="sm"
                  disabled={busy}
                  onClick={() => void choose(choice)}
                >
                  {t((data.hunks.length ? FILE_LABEL : CHOICE_LABEL)[choice])}
                </Button>
              ))}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void withAi()}>
                <Sparkles size={13} />
                {t('Resolve this file with AI')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => ws.openView(taskId, { kind: 'file', repoId: view.repoId, path: view.path })}
              >
                <FileText size={13} />
                {t('Edit in the editor')}
              </Button>
            </div>
          )}
          {error && <p className="m-0 whitespace-pre-wrap text-caption text-bad">{error}</p>}
        </header>

        {file.isPending && <ContentSkeleton />}
        {file.isError && !resolved && <p className="m-0 text-caption text-bad">{errorText(file.error)}</p>}
        {resolved && (
          <div className="flex flex-col items-start gap-2 rounded-(--radius-s) border border-line p-4">
            <p className="m-0 inline-flex items-center gap-1.5 text-control text-ok">
              <CircleCheck size={14} />
              {t('Resolved and staged.')}
            </p>
            {others.length ? (
              <Button size="sm" onClick={openNext}>
                {t('Next conflicted file')}
                <ArrowRight size={13} />
              </Button>
            ) : (
              <p className="m-0 text-caption text-muted-foreground">
                {status.data?.operation
                  ? t('Every conflict is resolved. Continue the {0} in Source Control.', { '0': status.data.operation })
                  : t('Every conflict is resolved. Commit the result in Source Control.')}
              </p>
            )}
          </div>
        )}

        {data?.hunks.map((hunk) => {
          const context = contextOf(hunk)
          return (
            <article
              key={`${hunk.index}:${hunk.line}`}
              className="flex flex-col overflow-hidden rounded-(--radius-s) border border-line"
            >
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-fill px-2 py-1.5">
                <span className="mr-auto text-caption text-muted-foreground">
                  {t('Conflict {0} · line {1}', { '0': String(hunk.index + 1), '1': String(hunk.line + 1) })}
                </span>
                {(['current', 'incoming', 'both'] as const).map((choice) => (
                  <Button
                    key={choice}
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => void choose(choice, hunk.index)}
                  >
                    {t(CHOICE_LABEL[choice])}
                  </Button>
                ))}
              </div>
              {context.length > 0 && (
                <pre className="m-0 overflow-x-auto px-2 py-1 font-mono text-[length:var(--font-code,12px)] leading-[1.5] whitespace-pre text-muted-foreground">
                  {context.join('\n')}
                </pre>
              )}
              <div className={cn('grid gap-px bg-(--line)', hunk.base ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
                <div className="bg-background">
                  <Side
                    title={hunk.currentLabel ? t('Current · {0}', { '0': hunk.currentLabel }) : t('Current')}
                    lines={hunk.current}
                    tone="current"
                  />
                </div>
                {hunk.base && (
                  <div className="bg-background">
                    <Side title={t('Common ancestor')} lines={hunk.base} tone="base" />
                  </div>
                )}
                <div className="bg-background">
                  <Side
                    title={hunk.incomingLabel ? t('Incoming · {0}', { '0': hunk.incomingLabel }) : t('Incoming')}
                    lines={hunk.incoming}
                    tone="incoming"
                  />
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </OverlayScrollArea>
  )
}
