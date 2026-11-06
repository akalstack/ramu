import { useEffect, useState } from 'react'
import type { PageCapability, PageGrants, PageInfo, PageRun, PageShare, PageUsage } from '@ramu/shared/pages'
import { declaredCapabilities } from '@ramu/shared/pages'
import { Button } from '../components/desktop-button'
import { Checkbox } from '../components/desktop-checkbox'
import { Input } from '../components/desktop-input'
import { GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { Dialog, timeAgo } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { notifyError } from '../chat/Notifications'

/** What a capability does, in the words the grant sheet and settings use. */
export function capabilityLine(name: PageCapability, page: Pick<PageInfo, 'capabilities'>): string {
  const c = page.capabilities
  switch (name) {
    case 'records':
      return t('Keeps records on this host: {list}', { list: Object.keys(c.records ?? {}).join(', ') })
    case 'ai':
      return t('Uses a model on this host: {purpose}. The model sees only what the page sends it.', {
        purpose: c.ai?.purpose ?? '',
      })
    case 'camera':
      return t('Uses photos you choose: {purpose}', { purpose: c.camera?.purpose ?? '' })
    case 'notify':
      return t('Sends notifications: {purpose}. Their text reaches your phone through its push service.', {
        purpose: c.notify?.purpose ?? '',
      })
    case 'schedules':
      return t('Runs on its own: {list}', {
        list: (c.schedules ?? [])
          .map((s) => `${c.runs?.[s.run]?.label ?? s.run} · ${everyLabel(s.every)}${s.at ? ` ${s.at}` : ''}`)
          .join(', '),
      })
    case 'triggers':
      return t('Acts when records match: {list}', {
        list: (c.triggers ?? [])
          .map((tr) => `${tr.collection}.${tr.when.field} ${tr.when.op} ${tr.when.value}`)
          .join(', '),
      })
    case 'webhook':
      return t('Accepts records from outside services into {collection}', { collection: c.webhook?.collection ?? '' })
    case 'folder':
      return t('Reads one project folder: {path}', { path: c.folder?.path ?? '' })
  }
}

const everyLabel = (every: 'hourly' | 'daily' | 'weekly') =>
  every === 'hourly' ? t('Every hour') : every === 'daily' ? t('Every day') : t('Every week')

export const runStatusLabel = (status: PageRun['status']) =>
  ({
    running: t('Running'),
    done: t('Done'),
    failed: t('Failed'),
    stopped: t('Stopped'),
    undone: t('Undone'),
  })[status]

/** The grants a set of choices makes; AI keeps its model and daily limit. */
function grantsOf(chosen: Record<string, boolean>, model: 'fast' | 'smart', daily: number, page: PageInfo): PageGrants {
  const grants: PageGrants = {}
  for (const name of declaredCapabilities(page.capabilities)) {
    const on = chosen[name] ?? false
    if (name === 'ai')
      grants.ai = on
        ? {
            model,
            daily,
            ...(page.capabilities.ai?.web ? { web: !!chosen['ai:web'] } : {}),
            ...(page.capabilities.ai?.mcp?.length
              ? { mcp: page.capabilities.ai.mcp.filter((server) => chosen[`ai:mcp:${server}`]) }
              : {}),
          }
        : false
    else if (name === 'webhook') grants.webhook = on ? { token: '' } : false
    else grants[name] = on
  }
  return grants
}

function GrantChoices({
  page,
  names,
  chosen,
  setChosen,
  model,
  setModel,
  daily,
  setDaily,
}: {
  page: PageInfo
  names: PageCapability[]
  chosen: Record<string, boolean>
  setChosen(next: Record<string, boolean>): void
  model: 'fast' | 'smart'
  setModel(model: 'fast' | 'smart'): void
  daily: number
  setDaily(daily: number): void
}) {
  useLanguage()
  return (
    <div className="flex flex-col gap-2">
      {names.map((name) => (
        <label key={name} className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={chosen[name] ?? false}
            onCheckedChange={(checked) => setChosen({ ...chosen, [name]: checked === true })}
          />
          <span>{capabilityLine(name, page)}</span>
        </label>
      ))}
      {names.includes('ai') && chosen.ai && (
        <div className="ml-6 flex flex-wrap items-center gap-2 text-caption">
          <span className="text-muted-foreground">{t('Model')}</span>
          {(['fast', 'smart'] as const).map((value) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={model === value}
              className={`${GHOST_TEXT_BUTTON_CLASS} aria-pressed:bg-raised aria-pressed:text-foreground`}
              onClick={() => setModel(value)}
            >
              {value === 'fast' ? t('Fast') : t('Smart')}
            </Button>
          ))}
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t('Requests a day')}</span>
            <Input
              type="number"
              min={1}
              max={500}
              className="w-20"
              value={daily}
              onChange={(event) => setDaily(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
            />
          </label>
          {page.capabilities.ai?.web && (
            <label className="flex basis-full items-center gap-2">
              <Checkbox
                checked={!!chosen['ai:web']}
                onCheckedChange={(checked) => setChosen({ ...chosen, 'ai:web': checked === true })}
              />
              {t('Let its runs search the web')}
            </label>
          )}
          {(page.capabilities.ai?.mcp ?? []).map((server) => (
            <label key={server} className="flex basis-full items-center gap-2">
              <Checkbox
                checked={!!chosen[`ai:mcp:${server}`]}
                onCheckedChange={(checked) => setChosen({ ...chosen, [`ai:mcp:${server}`]: checked === true })}
              />
              {t('Let its runs use {server}; each call asks you first', { server })}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** Shown the first time a page asks for something, and again when a new version asks for more. */
export function GrantSheet({ page, onDone }: { page: PageInfo; onDone(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => ({
    ...Object.fromEntries(page.pendingGrants.map((name) => [name, true])),
    'ai:web': true,
  }))
  const [model, setModel] = useState<'fast' | 'smart'>(page.capabilities.ai?.quality ?? 'fast')
  const [daily, setDaily] = useState(page.capabilities.ai?.daily ?? 200)
  const [busy, setBusy] = useState(false)
  const save = async (all: Record<string, boolean>) => {
    setBusy(true)
    try {
      const grants = grantsOf(all, model, daily, page)
      await invoke(
        'pages.grant',
        page.id,
        Object.fromEntries(
          Object.entries(grants).filter(([name]) => page.pendingGrants.includes(name as PageCapability)),
        ),
      )
      onDone()
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error), page.title)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('{title} asks to', { title: page.title })}
      confirmLabel={t('Allow')}
      busy={busy}
      onConfirm={() => void save(chosen)}
      onCancel={() => void save({})}
    >
      <GrantChoices
        page={page}
        names={page.pendingGrants}
        chosen={chosen}
        setChosen={setChosen}
        model={model}
        setModel={setModel}
        daily={daily}
        setDaily={setDaily}
      />
      <p className="mt-3 text-caption text-muted-foreground">
        {t('The page never sees your keys or other pages. Change this later in Page settings.')}
      </p>
    </Dialog>
  )
}

/** Grants, usage, run history with Undo, share links, the webhook address and records export and import. */
export function PageSettings({ page, onClose }: { page: PageInfo; onClose(): void }) {
  useLanguage()
  const { invoke, id: hostId } = useHost()
  const { on } = useHostRuntime()
  const names = declaredCapabilities(page.capabilities)
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => ({
    ...Object.fromEntries(names.map((name) => [name, !!page.grants[name]])),
    'ai:web': !!(page.grants.ai && page.grants.ai.web),
    ...Object.fromEntries(((page.grants.ai && page.grants.ai.mcp) || []).map((server) => [`ai:mcp:${server}`, true])),
  }))
  const [model, setModel] = useState<'fast' | 'smart'>((page.grants.ai && page.grants.ai.model) || 'fast')
  const [daily, setDaily] = useState((page.grants.ai && page.grants.ai.daily) || 200)
  const [usage, setUsage] = useState<PageUsage | null>(null)
  const [runs, setRuns] = useState<PageRun[]>([])
  const [shares, setShares] = useState<PageShare[]>([])
  const [hooks, setHooks] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    const load = () => {
      void invoke('pages.usage', page.id)
        .then(setUsage)
        .catch(() => {})
      void invoke('pages.runs', page.id)
        .then(setRuns)
        .catch(() => {})
      void invoke('pages.shares', page.id)
        .then(setShares)
        .catch(() => {})
      void invoke('pages.webhookUrls', page.id)
        .then(setHooks)
        .catch(() => {})
    }
    load()
    return on('pages:changed', (payload) => {
      if (payload.pageId === page.id) load()
    })
  }, [invoke, on, page.id])
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error), page.title)
    }
  }
  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const shareLink = (share: PageShare) =>
    `ramu://page/${encodeURIComponent(hostId)}/${share.pageId}?share=${share.token}`
  return (
    <Dialog
      title={t('Page settings')}
      confirmLabel={t('Save')}
      busy={busy}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true)
        void act(() => invoke('pages.grant', page.id, grantsOf(chosen, model, daily, page))).finally(() => {
          setBusy(false)
          onClose()
        })
      }}
    >
      <div className="flex flex-col gap-4">
        {names.length ? (
          <section>
            <h4 className="m-0 mb-1.5 text-body font-medium text-foreground">{t('Allowed')}</h4>
            <GrantChoices
              page={page}
              names={names}
              chosen={chosen}
              setChosen={setChosen}
              model={model}
              setModel={setModel}
              daily={daily}
              setDaily={setDaily}
            />
            {usage && (
              <p className="mt-2 mb-0 text-caption text-muted-foreground">
                {t('Today: {ai} model requests, {notify} notifications', { ai: usage.ai, notify: usage.notify })}
              </p>
            )}
          </section>
        ) : (
          <p className="m-0 text-muted-foreground">{t('This page uses nothing beyond its own frame.')}</p>
        )}
        {hooks.length > 0 && (
          <section>
            <h4 className="m-0 mb-1.5 text-body font-medium text-foreground">{t('Webhook')}</h4>
            {hooks.map((url) => (
              <div key={url} className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-caption">{url}</code>
                <Button
                  variant="ghost"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  onClick={() => void navigator.clipboard?.writeText(url)}
                >
                  {t('Copy')}
                </Button>
              </div>
            ))}
          </section>
        )}
        <section>
          <h4 className="m-0 mb-1.5 text-body font-medium text-foreground">{t('Share links')}</h4>
          <p className="mt-0 mb-2 text-caption text-muted-foreground">
            {t('For devices paired with this host. Links expire after 30 days unless renewed.')}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void act(() => invoke('pages.share', page.id, false))}>
              {t('Read-only link')}
            </Button>
            {page.capabilities.records && (
              <Button variant="outline" onClick={() => void act(() => invoke('pages.share', page.id, true))}>
                {t('Link that can add records')}
              </Button>
            )}
          </div>
          {shares.map((share) => (
            <div key={share.token} className="mt-1.5 flex items-center gap-1.5 text-caption">
              <span className="min-w-0 flex-1 truncate">
                {share.canAdd ? t('Can add records') : t('Read-only')} ·{' '}
                {t('expires {when}', { when: new Date(share.expiresAt).toLocaleDateString() })}
              </span>
              <Button
                variant="ghost"
                className={GHOST_TEXT_BUTTON_CLASS}
                onClick={() => void navigator.clipboard?.writeText(shareLink(share))}
              >
                {t('Copy link')}
              </Button>
              <Button
                variant="ghost"
                className={GHOST_TEXT_BUTTON_CLASS}
                onClick={() => void act(() => invoke('pages.renewShare', share.token))}
              >
                {t('Renew')}
              </Button>
              <Button
                variant="ghost"
                className={GHOST_TEXT_BUTTON_CLASS}
                onClick={() => void act(() => invoke('pages.revokeShare', share.token))}
              >
                {t('Revoke')}
              </Button>
            </div>
          ))}
        </section>
        {page.capabilities.records && (
          <section>
            <h4 className="m-0 mb-1.5 text-body font-medium text-foreground">{t('Records')}</h4>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void act(async () => {
                    const exported = await invoke('pages.exportRecords', page.id)
                    download(`${page.title}.json`, exported.json, 'application/json')
                    for (const [name, csv] of Object.entries(exported.csv))
                      download(`${page.title}-${name}.csv`, csv, 'text/csv')
                  })
                }
              >
                {t('Export records')}
              </Button>
              {Object.keys(page.capabilities.records).map((collection) => (
                <label key={collection} className="inline-flex cursor-pointer items-center">
                  <span className="rounded-md border border-border px-3 py-1 text-body">
                    {t('Import CSV into {collection}', { collection })}
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file)
                        void act(async () => {
                          const { added } = await invoke('pages.importCsv', page.id, collection, await file.text())
                          setStatus(t('Imported {count} records', { count: added }))
                        })
                    }}
                  />
                </label>
              ))}
            </div>
            {status && (
              <p role="status" className="mt-1.5 mb-0 text-caption text-muted-foreground">
                {status}
              </p>
            )}
          </section>
        )}
        {runs.length > 0 && (
          <section>
            <h4 className="m-0 mb-1.5 text-body font-medium text-foreground">{t('History')}</h4>
            {runs.slice(0, 20).map((run) => (
              <div key={run.id} className="border-b border-border py-1.5 text-caption last:border-0">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    className={`${GHOST_TEXT_BUTTON_CLASS} min-w-0 flex-1 justify-start truncate`}
                    aria-expanded={open === run.id}
                    onClick={() => setOpen(open === run.id ? null : run.id)}
                  >
                    {run.name ? (page.capabilities.runs?.[run.name]?.label ?? run.name) : run.task.slice(0, 60)}
                  </Button>
                  <span className="flex-none text-muted-foreground">
                    {runStatusLabel(run.status)} · {timeAgo(run.startedAt)}
                    {run.changes ? ` · ${t('{count} changes', { count: run.changes })}` : ''}
                  </span>
                  {run.changes > 0 && run.status !== 'undone' && run.status !== 'running' && (
                    <Button
                      variant="ghost"
                      className={GHOST_TEXT_BUTTON_CLASS}
                      onClick={() => void act(() => invoke('pages.runUndo', run.id))}
                    >
                      {t('Undo run')}
                    </Button>
                  )}
                </div>
                {open === run.id && (
                  <ol className="m-0 mt-1 pl-5 text-muted-foreground">
                    {run.steps.map((step, index) => (
                      <li key={index}>{step.text}</li>
                    ))}
                    {run.error && <li className="text-bad">{run.error}</li>}
                  </ol>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </Dialog>
  )
}
