import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, CircleAlert, Pin } from 'lucide-react'
import { LegendList } from '@legendapp/list/react'
import type { ArtifactInfo, ArtifactKind } from '@ramu/shared/artifacts'
import { ARTIFACT_KINDS, declaredCapabilities } from '@ramu/shared/artifacts'
import { appendPage, mergedPages } from '@ramu/shared/paging'
import { ChoiceChip, ChoiceChips } from '@/components/choice-group'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RowButton } from '../components/row-button'
import { SearchInput } from '../SearchInput'
import { timeAgo } from '../Menu'
import { t, useLanguage } from '../i18n'
import { HostProvider, useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { HostContent } from '../workspace/HostContent'
import { useHostSelection } from '../workspace/HostSelection'
import { statusText, useScopedHosts } from '../workspace/computers'
import { DeviceIcon } from '@/components/device-icon'
import { ContentSkeleton } from '@/components/content-skeleton'
import { PageView } from './PageView'
import { takePendingPage, type PageTarget } from './openPage'
import { ImportPageDialog } from './ImportPageDialog'
import { Button } from '../components/desktop-button'
import { useViewOnly } from '../composer/useViewOnly'
import { ArtifactKindMark, artifactKindLabel } from './ArtifactKindMark'

/** Artifacts each host sends at a time. */
const ARTIFACT_PAGE = 50
/** A row's two lines and the line between rows; the list measures each row once it is drawn. */
const ROW_PX = 53

type ShownArtifact = { page: ArtifactInfo; host: string }
const shownKey = ({ page, host }: ShownArtifact) => `${host}\n${page.id}`

/** The list's order, as the host keeps it: pinned first, then the newest change. */
const byListOrder = (a: ArtifactInfo, b: ArtifactInfo) =>
  Number(b.pinned) - Number(a.pinned) || b.changedAt - a.changedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

type ArtifactFilter = { query?: string; kind?: ArtifactKind }

/**
 * This host's artifacts for a search and kind, a page at a time in the list's order. A host too old to page gives its
 * whole list, filtered here.
 */
function useArtifactPages(filter: ArtifactFilter) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const key = JSON.stringify(filter)
  const [state, setState] = useState<{
    key: string
    pages: ArtifactInfo[]
    next: string | null
    kinds: ArtifactKind[]
  } | null>(null)
  const latest = useRef(key)
  latest.current = key
  const busy = useRef(false)
  const read = useCallback(
    async (cursor: string | null) => {
      const asked = key
      const parsed = JSON.parse(asked) as ArtifactFilter
      const page = await invoke('artifacts.page', parsed, cursor, ARTIFACT_PAGE).catch(async (error: unknown) => {
        if (cursor) throw error
        const all = await invoke('artifacts.list')
        const needle = parsed.query?.toLowerCase() ?? ''
        return {
          items: all.filter(
            (page) => (!parsed.kind || page.kind === parsed.kind) && page.title.toLowerCase().includes(needle),
          ),
          next: null,
          kinds: [...new Set(all.map((page) => page.kind))],
        }
      })
      if (asked !== latest.current) return
      setState((current) => ({
        key: asked,
        pages:
          cursor && current?.key === asked ? appendPage(current.pages, page.items, (entry) => entry.id) : page.items,
        next: page.next,
        kinds: page.kinds,
      }))
    },
    [invoke, key],
  )
  useEffect(() => {
    void read(null).catch(() => setState({ key, pages: [], next: null, kinds: [] }))
    return on('artifacts:changed', (payload) => {
      if (!payload.run) void read(null).catch(() => {})
    })
  }, [read, on, key])
  const next = state?.key === key ? state.next : null
  const loadMore = useCallback(() => {
    if (!next || busy.current) return
    busy.current = true
    void read(next)
      .catch(() => {})
      .finally(() => {
        busy.current = false
      })
  }, [next, read])
  return { pages: state ? state.pages : null, next, kinds: state?.kinds ?? [], loadMore }
}

/** One host's artifacts as the Artifacts page lists them, with the names of that host's projects. */
interface HostPages {
  pages: ArtifactInfo[] | null
  next: string | null
  kinds: ArtifactKind[]
  loadMore: () => void
  projects: Map<string, string>
}

/** Reads one host's artifacts for the Artifacts page, below that host's `HostContent`; it draws nothing itself. */
function HostPagesFeed({
  filter,
  onChange,
}: {
  filter: ArtifactFilter
  onChange(host: string, pages: HostPages | null): void
}) {
  const host = useHost().id
  const { pages, next, kinds, loadMore } = useArtifactPages(filter)
  const { projects } = useWorkspace()
  useEffect(() => {
    onChange(host, {
      pages,
      next,
      kinds,
      loadMore,
      projects: new Map(projects.map((project) => [project.id, project.name])),
    })
  }, [host, pages, next, kinds, loadMore, projects, onChange])
  useEffect(() => () => onChange(host, null), [host, onChange])
  return null
}

/**
 * Every artifact on the hosts the sidebar's host filter shows, in one list: newest first with pinned ones on top, each
 * saying which host keeps it when there are several. An artifact opens from its own host; a new one starts on the
 * filtered host, or the one on screen under All hosts.
 */
export function PagesPage() {
  useLanguage()
  const { activeHost } = useHostSelection()
  const hosts = useScopedHosts()
  const manyHosts = hosts.length > 1
  const [lists, setLists] = useState<Record<string, HostPages>>({})
  const report = useCallback(
    (host: string, entry: HostPages | null) =>
      setLists((current) => {
        if (entry) return { ...current, [host]: entry }
        const { [host]: _gone, ...rest } = current
        return rest
      }),
    [],
  )
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  // The search goes to each host as typing pauses, so one word is one request.
  const [searched, setSearched] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  const filter = useMemo(
    () => ({ ...(searched ? { query: searched } : {}), ...(kind === 'all' ? {} : { kind }) }),
    [searched, kind],
  )
  const [importing, setImporting] = useState(false)
  const viewOnly = useViewOnly()
  const connected = hosts.filter((entry) => entry.status === 'connected')
  // Import acts on the host the filter shows, or the one on screen under All hosts.
  const target = (manyHosts ? undefined : hosts[0]?.id) ?? activeHost
  const targetReady = connected.some((entry) => entry.id === target)
  const hostName = (id: string) => hosts.find((entry) => entry.id === id)?.name ?? ''
  // A page starts as a request to an agent: New chat outside any project, with the request begun in the box.
  const [open, setOpen] = useState<PageTarget | null>(() => takePendingPage())
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    const choose = (event: Event) => {
      takePendingPage()
      setOpen((event as CustomEvent<PageTarget>).detail)
    }
    window.addEventListener('ramu:open-page', choose)
    return () => window.removeEventListener('ramu:open-page', choose)
  }, [])
  const feeds = connected.map((entry) => (
    <HostContent key={entry.id} host={entry.id}>
      <HostPagesFeed filter={filter} onChange={report} />
    </HostContent>
  ))
  if (open)
    return (
      <>
        {feeds}
        <HostContent
          key={`${open.host}\n${open.id}`}
          host={open.host}
          fallback={
            <div className="flex-1 p-6">
              <ContentSkeleton />
            </div>
          }
        >
          <PageView artifactId={open.id} onBack={() => setOpen(null)} />
        </HostContent>
      </>
    )
  const loaded = connected.filter((entry) => lists[entry.id]?.pages)
  const loading = loaded.length < connected.length
  const needle = query.trim().toLowerCase()
  const shown = mergedPages(
    connected.map((entry) => ({
      items: (lists[entry.id]?.pages ?? []).map((page) => ({ page, host: entry.id })),
      next: lists[entry.id]?.next ?? null,
    })),
    (a, b) => byListOrder(a.page, b.page),
  ).filter(({ page }) => (kind === 'all' || page.kind === kind) && page.title.toLowerCase().includes(needle))
  // Whether any artifact is kept at all, beyond what this search and kind show.
  const any = connected.some((entry) => lists[entry.id]?.kinds.length)
  const offline = hosts.filter((entry) => entry.status !== 'connected')
  // The kind filter appears once there is more than one kind to tell apart.
  const kinds = ARTIFACT_KINDS.filter((entry) => connected.some((host) => lists[host.id]?.kinds.includes(entry)))
  const loadMore = () => {
    for (const entry of connected) if (lists[entry.id]?.next) lists[entry.id]!.loadMore()
  }
  return (
    <div ref={setScroller} className="h-full w-full overflow-auto">
      {feeds}
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pt-6 pb-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="m-[0_0_4px] text-heading font-semibold tracking-[-0.01em]">{t('Artifacts')}</h1>
            <p className="m-0 text-control text-muted-foreground">
              {t(
                'Apps, docs and diagrams agents made for you to keep. Open them here or on your phone, and ask in any thread to change one.',
              )}
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <Button variant="outline" disabled={viewOnly || !targetReady} onClick={() => setImporting(true)}>
              {t('Import an artifact…')}
            </Button>
          </div>
        </header>
        {offline.map((entry) => (
          <p key={entry.id} role="status" className="m-0 flex items-center gap-1.5 text-caption text-muted-foreground">
            {manyHosts && <DeviceIcon name={entry.name} size={12} />}
            {[
              manyHosts ? entry.name : '',
              t('{0}. Its artifacts show when it is back.', { '0': statusText(entry.status) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ))}
        {any && (
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search artifacts')}
            aria-label={t('Search artifacts')}
          />
        )}
        {kinds.length > 1 && (
          <ChoiceChips
            size="sm"
            className="flex-wrap gap-1.5"
            aria-label={t('Kind')}
            value={[kind]}
            onValueChange={(values) => values[0] && setKind(values[0] as ArtifactKind | 'all')}
          >
            <ChoiceChip value="all" className="px-2.5">
              {t('All')}
            </ChoiceChip>
            {kinds.map((entry) => (
              <ChoiceChip key={entry} value={entry} className="gap-1.5 px-2.5">
                <ArtifactKindMark kind={entry} size={13} named={false} />
                {artifactKindLabel(entry)}
              </ChoiceChip>
            ))}
          </ChoiceChips>
        )}
        {loading && !any && <ContentSkeleton />}
        {!loading && !any && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AppWindow />
              </EmptyMedia>
              <EmptyTitle>{t('No artifacts yet')}</EmptyTitle>
              <EmptyDescription>
                {t(
                  'Ask an agent for something to keep, like “a tracker for …”, or choose Keep as artifact on any interactive card in a thread.',
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {importing && (
          <HostProvider hostId={target}>
            <ImportPageDialog onClose={() => setImporting(false)} />
          </HostProvider>
        )}
        {any && !shown.length && (
          <p role="status" className="m-0 py-8 text-center text-control text-muted-foreground">
            {t('No matches')}
          </p>
        )}
        {/* One card divided by lines, as the Inbox's lists are. Only the rows near the view are drawn, and the next
            page is on its way a screen before the end. */}
        <LegendList<ShownArtifact>
          scrollElement={scroller}
          data={shown}
          keyExtractor={shownKey}
          extraData={manyHosts}
          estimatedItemSize={ROW_PX}
          onEndReached={loadMore}
          onEndReachedThreshold={1}
          role="list"
          className={`overflow-hidden rounded-(--radius-m) bg-card ${shown.length ? '' : 'hidden'}`}
          renderItem={({ item: { page, host }, index }) => {
            const uses = declaredCapabilities(page.capabilities)
            return (
              <div role="listitem" className={index ? 'border-t border-(--line)' : undefined}>
                <RowButton
                  size="lg"
                  className="w-full rounded-none px-3 hover:bg-hover"
                  onClick={() => setOpen({ id: page.id, host })}
                >
                  <span aria-hidden className="w-6 flex-none text-center text-[17px] leading-none">
                    {page.icon}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-body text-foreground">{page.title}</span>
                    <span className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
                      <ArtifactKindMark kind={page.kind} size={12} className="flex-none" named={false} />
                      <span className="truncate">
                        {[
                          artifactKindLabel(page.kind),
                          page.projectId ? lists[host]?.projects.get(page.projectId) : null,
                          `v${page.version}`,
                          uses.includes('records') ? t('Records') : null,
                          uses.includes('ai') ? t('AI') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {page.lastError && (
                        <span className="flex flex-none items-center gap-1 text-bad">
                          · <CircleAlert size={11} aria-hidden="true" />
                          {t('Has an error')}
                        </span>
                      )}
                    </span>
                  </span>
                  {manyHosts && (
                    <span
                      className="inline-flex max-w-[140px] flex-none items-center gap-1 text-caption text-muted-foreground"
                      title={t('On {0}', { '0': hostName(host) })}
                    >
                      <DeviceIcon name={hostName(host)} size={11} />
                      <span className="truncate">{hostName(host)}</span>
                    </span>
                  )}
                  {page.pinned && (
                    <Pin size={12} className="flex-none text-muted-foreground" aria-label={t('Pinned')} />
                  )}
                  <span className="flex-none text-caption text-muted-foreground">{timeAgo(page.changedAt)}</span>
                </RowButton>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
