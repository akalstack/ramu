import { useCallback, useEffect, useState } from 'react'
import { AppWindow, Pin } from 'lucide-react'
import type { PageInfo } from '@ramu/shared/pages'
import { declaredCapabilities } from '@ramu/shared/pages'
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

/** Every page kept on this host, newest first with pinned ones on top. */
export function usePages() {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [pages, setPages] = useState<PageInfo[] | null>(null)
  const reload = useCallback(() => {
    void invoke('pages.list')
      .then(setPages)
      .catch(() => setPages([]))
  }, [invoke])
  useEffect(() => {
    reload()
    return on('pages:changed', (payload) => {
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
  const [importing, setImporting] = useState(false)
  const viewOnly = useViewOnly()
  const [open, setOpen] = useState<string | null>(() => takePendingPage())
  useEffect(() => {
    const select = (event: Event) => {
      takePendingPage()
      setOpen((event as CustomEvent<{ id: string }>).detail.id)
    }
    window.addEventListener('ramu:open-page', select)
    return () => window.removeEventListener('ramu:open-page', select)
  }, [])
  if (open) return <PageView key={open} pageId={open} onBack={() => setOpen(null)} />
  const projects = new Map(ws.projects.map((project) => [project.id, project.name]))
  const shown = (pages ?? []).filter((page) => page.title.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pt-6 pb-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="m-[0_0_4px] text-heading font-semibold tracking-[-0.01em]">{t('Pages')}</h1>
            <p className="m-0 text-control text-muted-foreground">
              {t(
                'Sites agents made for you to keep. Open them here or on your phone, and change one by asking in any thread.',
              )}
            </p>
          </div>
          <Button variant="outline" className="flex-none" disabled={viewOnly} onClick={() => setImporting(true)}>
            {t('Import a page…')}
          </Button>
        </header>
        {pages && pages.length > 0 && (
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search pages')}
            aria-label={t('Search pages')}
          />
        )}
        {pages && pages.length === 0 && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AppWindow />
              </EmptyMedia>
              <EmptyTitle>{t('No pages yet')}</EmptyTitle>
              <EmptyDescription>
                {t('Ask an agent for “a page to …”, or choose Keep as page on any interactive card in a thread.')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {importing && <ImportPageDialog onClose={() => setImporting(false)} />}
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
                    <span className="block truncate text-caption text-muted-foreground">
                      {[
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
