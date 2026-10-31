import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { AgentSettings, StartedThread } from '@ramu/shared/types'
import { SPLIT_LIMIT, splitThreadPrompt, type RoutingCandidate } from '@ramu/shared/workspace/projectRouting'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Textarea } from '@/components/ui/textarea'
import { t, useLanguage } from './i18n'
import { invokeOn } from './ipc'
import { hostStorageFor } from './hostStorage'
import { useComputers } from './workspace/computers'
import { useWorkspacesOf } from './workspace/workspace'

/** One thread of a split prompt, as the person reviews it before anything starts. */
export interface SplitRow {
  key: string
  hostId: string
  projectId: string
  label: string
  title: string
  brief: string
}

export interface SplitDraft {
  original: string
  contract: string
  rows: SplitRow[]
  settings: AgentSettings
}

/** Where a routing id points: a project on this host, or one on another connected host. */
export interface RouteTarget {
  hostId: string
  projectId: string
  name: string
  hostName?: string
}

const DRAFT_KEY = 'ramu.splitDraft'

/** The split under review survives closing Home or the window, until it is started or cancelled. */
export function useSplitDraft(hostId: string): [SplitDraft | null, (draft: SplitDraft | null) => void] {
  const storage = hostStorageFor(hostId)
  const [draft, setDraft] = useState<SplitDraft | null>(() => {
    try {
      const saved = JSON.parse(storage.getItem(DRAFT_KEY) ?? 'null') as SplitDraft | null
      return saved && Array.isArray(saved.rows) && saved.rows.length ? saved : null
    } catch {
      return null
    }
  })
  return [
    draft,
    (next) => {
      setDraft(next)
      if (next) storage.setItem(DRAFT_KEY, JSON.stringify(next))
      else storage.removeItem(DRAFT_KEY)
    },
  ]
}

/**
 * Projects on the other connected hosts, for Auto to consider beside this host's. Their routing ids are local to this
 * request; only names, aliases, descriptions and host names are sent.
 */
export function useOtherHostTargets(hostId: string, enabled: boolean) {
  const computers = useComputers()
  const others = useMemo(
    () =>
      enabled
        ? (computers?.computers ?? []).filter((computer) => computer.id !== hostId && computer.status === 'connected')
        : [],
    [computers, hostId, enabled],
  )
  const stores = useWorkspacesOf(others.map((computer) => computer.id))
  return useMemo(() => {
    const targets = new Map<string, RouteTarget>()
    const candidates: RoutingCandidate[] = []
    others.forEach((computer, index) => {
      for (const project of stores[index]?.projects ?? []) {
        if (candidates.length >= 40) return
        const id = `host${index}:${project.id}`
        targets.set(id, { hostId: computer.id, projectId: project.id, name: project.name, hostName: computer.name })
        candidates.push({
          id,
          name: project.name,
          host: computer.name,
          ...(project.aliases?.length ? { aliases: project.aliases } : {}),
          ...(project.description ? { description: project.description } : {}),
        })
      }
    })
    return { targets, candidates }
  }, [others, stores])
}

/** Starts every reviewed row, one group across hosts; each host starts its own rows. Failures are per row. */
export async function startSplit(draft: SplitDraft): Promise<(StartedThread & { hostId: string })[]> {
  const groupId = crypto.randomUUID()
  const together = draft.rows.map((row) => row.title)
  const byHost = new Map<string, SplitRow[]>()
  for (const row of draft.rows) byHost.set(row.hostId, [...(byHost.get(row.hostId) ?? []), row])
  const results = await Promise.all(
    [...byHost].map(async ([hostId, rows]) => {
      try {
        const started = await invokeOn(
          hostId,
          'threads.startGroup',
          {
            groupId,
            threads: rows.map((row) => ({
              projectId: row.projectId,
              title: row.title,
              prompt: splitThreadPrompt(row.brief, draft.contract, draft.original),
            })),
            together,
          },
          draft.settings,
        )
        return started.map((entry) => ({ ...entry, hostId }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return rows.map((row) => ({ taskId: '', title: row.title, projectName: row.label, error: message, hostId }))
      }
    }),
  )
  return results.flat()
}

/** The review list for one Home prompt that needs work in several projects. Nothing starts until **Start all**. */
export function SplitReview({
  draft,
  busy,
  onChange,
  onStart,
  onOneThread,
  onCancel,
}: {
  draft: SplitDraft
  busy: boolean
  onChange: (draft: SplitDraft) => void
  onStart: () => void
  onOneThread: () => void
  onCancel: () => void
}) {
  useLanguage()
  const update = (key: string, change: Partial<SplitRow>) =>
    onChange({ ...draft, rows: draft.rows.map((row) => (row.key === key ? { ...row, ...change } : row)) })
  const ready = draft.rows.length > 0 && draft.rows.every((row) => row.title.trim() && row.brief.trim())
  return (
    <section className="flex flex-col gap-2 px-2 py-1.5" aria-label={t('Review threads to start')}>
      <p className="m-0 text-caption text-muted-foreground">
        {t('This needs work in several projects. Review each thread, then start them together.')}
      </p>
      <label className="flex flex-col gap-1 text-caption text-muted-foreground">
        {t('Shared contract')}
        <Textarea
          rows={2}
          maxLength={4000}
          value={draft.contract}
          disabled={busy}
          placeholder={t('What every thread must agree on, such as names, fields and endpoints')}
          onChange={(event) => onChange({ ...draft, contract: event.target.value })}
        />
      </label>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {draft.rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1 rounded-(--radius-m) bg-fill p-2">
            <div className="flex items-center gap-2">
              <span className="flex-none text-caption text-muted-foreground">{row.label}</span>
              <Input
                aria-label={t('Thread title')}
                className="h-7 min-w-0 flex-1"
                maxLength={200}
                value={row.title}
                disabled={busy}
                onChange={(event) => update(row.key, { title: event.target.value })}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                title={t('Remove this thread')}
                aria-label={t('Remove this thread')}
                disabled={busy}
                onClick={() => onChange({ ...draft, rows: draft.rows.filter((entry) => entry.key !== row.key) })}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </div>
            <Textarea
              aria-label={t('Brief for {0}', { '0': row.label })}
              rows={3}
              maxLength={8000}
              value={row.brief}
              disabled={busy}
              onChange={(event) => update(row.key, { brief: event.target.value })}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" disabled={busy || !ready || draft.rows.length > SPLIT_LIMIT} onClick={onStart}>
          <Plus size={13} aria-hidden="true" />
          {draft.rows.length === 1 ? t('Start thread') : t('Start all {0}', { '0': draft.rows.length })}
        </Button>
        <Button variant="secondary" size="xs" disabled={busy} onClick={onOneThread}>
          {t('Start as one thread')}
        </Button>
        <Button variant="ghost" size="xs" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </section>
  )
}
