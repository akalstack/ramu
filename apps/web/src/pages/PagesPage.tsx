import { useCallback, useEffect, useState } from 'react'
import { AppWindow, Pin, Plus } from 'lucide-react'
import { NO_PROJECT } from '@ramu/shared/types'
import { draftKey, draftStore, loadDraft, saveDraft } from '../composer/drafts'
import type { ArtifactInfo, ArtifactKind, ArtifactTemplate } from '@ramu/shared/artifacts'
import { ARTIFACT_KINDS, declaredCapabilities } from '@ramu/shared/artifacts'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RowButton } from '../components/row-button'
import { SearchInput } from '../SearchInput'
import { timeAgo } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { PageView } from './PageView'
import { takePendingPage } from './openPage'
import { ImportPageDialog } from './ImportPageDialog'
import { Button } from '../components/desktop-button'
import { useViewOnly } from '../composer/useViewOnly'
import { ArtifactKindMark, artifactKindLabel } from './ArtifactKindMark'

/** Every page kept on this host, newest first with pinned ones on top. */
export function usePages() {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [pages, setPages] = useState<ArtifactInfo[] | null>(null)
  const reload = useCallback(() => {
    void invoke('artifacts.list')
      .then(setPages)
      .catch(() => setPages([]))
  }, [invoke])
  useEffect(() => {
    reload()
    return on('artifacts:changed', (payload) => {
      if (!payload.run) reload()
    })
  }, [reload, on])
  return pages
}

export function PagesPage() {
  useLanguage()
  const pages = usePages()
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  const [importing, setImporting] = useState(false)
  const viewOnly = useViewOnly()
  const { invoke } = useHost()
  // Saved starting points: a new artifact from one gets its code and source, and a history of its own.
  const [templates, setTemplates] = useState<ArtifactTemplate[]>([])
  const loadTemplates = useCallback(() => {
    if (!viewOnly) void invoke('artifacts.templates').then(setTemplates, () => setTemplates([]))
  }, [invoke, viewOnly])
  useEffect(loadTemplates, [loadTemplates])
  const host = useHost()
  // A page starts as a request to an agent: New chat outside any project, with the request begun in the box.
  const newPage = () => {
    const key = draftKey.newChat(NO_PROJECT)
    const store = draftStore(host.id)
    if (!loadDraft(key, store).trim()) saveDraft(key, `${t('Make me a page to')} `, store)
    ws.newTask(NO_PROJECT)
  }
  const [open, setOpen] = useState<string | null>(() => takePendingPage())
  useEffect(() => {
    const select = (event: Event) => {
      takePendingPage()
      setOpen((event as CustomEvent<{ id: string }>).detail.id)
    }
    window.addEventListener('ramu:open-page', select)
    return () => window.removeEventListener('ramu:open-page', select)
  }, [])
  if (open) return <PageView key={open} artifactId={open} onBack={() => setOpen(null)} />
  const projects = new Map(ws.projects.map((project) => [project.id, project.name]))
  const shown = (pages ?? []).filter(
    (page) => (kind === 'all' || page.kind === kind) && page.title.toLowerCase().includes(query.trim().toLowerCase()),
  )
  // The kind filter appears once there is more than one kind to tell apart.
  const kinds = ARTIFACT_KINDS.filter((entry) => pages?.some((page) => page.kind === entry))
  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pt-6 pb-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="m-[0_0_4px] text-heading font-semibold tracking-[-0.01em]">{t('Artifacts')}</h1>
            <p className="m-0 text-control text-muted-foreground">
              {t(
                'Apps, docs and diagrams agents made for you to keep. Open them here or on your phone, and change one by asking in any thread.',
              )}
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <Button variant="outline" disabled={viewOnly} onClick={() => setImporting(true)}>
              {t('Import an artifact…')}
            </Button>
            <Button disabled={viewOnly} onClick={newPage}>
              <Plus size={14} />
              {t('New')}
            </Button>
          </div>
        </header>
        {pages && pages.length > 0 && (
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search artifacts')}
            aria-label={t('Search artifacts')}
          />
        )}
        {kinds.length > 1 && (
          <ToggleGroup
            size="sm"
            variant="outline"
            spacing={2}
            className="flex-wrap gap-1.5"
            aria-label={t('Kind')}
            value={[kind]}
            onValueChange={(values) => values[0] && setKind(values[0] as ArtifactKind | 'all')}
          >
            <ToggleGroupItem value="all" className="px-2.5">
              {t('All')}
            </ToggleGroupItem>
            {kinds.map((entry) => (
              <ToggleGroupItem key={entry} value={entry} className="gap-1.5 px-2.5">
                <ArtifactKindMark kind={entry} size={13} named={false} />
                {artifactKindLabel(entry)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {pages && pages.length === 0 && (
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
        {importing && <ImportPageDialog onClose={() => setImporting(false)} />}
        {templates.length > 0 && (
          <section aria-label={t('Templates')} className="flex flex-col gap-1">
            <h2 className="m-0 text-caption font-semibold text-muted-foreground">{t('Templates')}</h2>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {templates.map((template) => (
                <li key={template.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                  <span aria-hidden>{template.icon}</span>
                  <ArtifactKindMark kind={template.kind} size={13} className="flex-none text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{template.title}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void invoke('artifacts.fromTemplate', template.id).then(
                        (made) => setOpen(made.id),
                        () => loadTemplates(),
                      )
                    }
                  >
                    {t('Use')}
                  </Button>
                  {/* The starting set Ramu ships stays; only the person's own templates can be removed. */}
                  {!template.id.startsWith('starter:') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void invoke('artifacts.removeTemplate', template.id).then(loadTemplates)}
                    >
                      {t('Remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {shown.map((page) => {
            const uses = declaredCapabilities(page.capabilities)
            return (
              <li key={page.id}>
                <RowButton className="w-full" onClick={() => setOpen(page.id)}>
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
                          page.projectId ? projects.get(page.projectId) : null,
                          `v${page.version}`,
                          uses.includes('records') ? t('Records') : null,
                          uses.includes('ai') ? t('AI') : null,
                          page.lastError ? t('Has an error') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </span>
                  {page.pinned && (
                    <Pin size={12} className="flex-none text-muted-foreground" aria-label={t('Pinned')} />
                  )}
                  <span className="flex-none text-caption text-muted-foreground">{timeAgo(page.changedAt)}</span>
                </RowButton>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
