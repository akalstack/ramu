import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bug,
  MessageSquarePlus,
  Monitor,
  MoreHorizontal,
  MousePointerClick,
  PenLine,
  Play,
  Smartphone,
  Square,
  Tablet,
  X,
} from 'lucide-react'
import type { InteractiveDocument, InteractiveState } from '@ramu/shared/interactive'
import {
  ARTIFACT_SOURCE_FILES,
  type ArtifactInfo,
  type ArtifactRun,
  type ArtifactVersion,
} from '@ramu/shared/artifacts'
import { interactiveExport, slideCount } from '@ramu/shared/interactiveExport'
import type { Slide } from '@ramu/shared/artifactSource'
import { Button } from '../components/desktop-button'
import { Input } from '../components/desktop-input'
import { Textarea } from '@/components/ui/textarea'
import { GHOST_ICON_BUTTON_CLASS, GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { Dialog, Menu, type MenuEntry } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { notifyError } from '../chat/Notifications'
import { useViewOnly } from '../composer/useViewOnly'
import { ContentFrame } from '../interactive/ContentFrame'
import { useContentDocument } from '../interactive/useContentDocument'
import { appThemeVariables } from '../interactive/InteractiveContent'
import { usePageBridge, type PickedElement } from './usePageBridge'
import { GrantSheet, PageSettings, runStatusLabel } from './PageSettings'
import { openPage } from './openPage'
import { PublishDialog } from './PublishDialog'
import { ArtifactKindMark, hostExportEntries, kindExportEntries } from './ArtifactKindMark'
import { SlideToolbar, useSlideControls } from './SlideControls'

const VIEWPORTS = [
  { id: 'fit', label: 'Fit to width', width: undefined, Icon: Monitor },
  { id: 'tablet', label: 'Tablet (768 px)', width: 768, Icon: Tablet },
  { id: 'phone', label: 'Phone (390 px)', width: 390, Icon: Smartphone },
] as const

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error)

/** One page, full window: its frame, toolbar, runs, questions about its records and everything the person can do with it. */
export function PageView({ artifactId, onBack }: { artifactId: string; onBack(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const ws = useWorkspace()
  const viewOnly = useViewOnly()
  const [page, setPage] = useState<ArtifactInfo | null>(null)
  const [document, setDocument] = useState<InteractiveDocument | null>(null)
  const [missing, setMissing] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]['id']>('fit')
  const [ready, setReady] = useState(false)
  const [frameError, setFrameError] = useState('')
  const [dialog, setDialog] = useState<
    | null
    | { kind: 'settings' | 'versions' | 'delete' | 'project' | 'rename' | 'publish' }
    | { kind: 'thread'; prompt: string; resolve?: (agreed: boolean) => void; title: string }
  >(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElement | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<ArtifactRun | null>(null)
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState('')
  // A doc's Markdown while the person edits it, and the version that edit started from.
  const [editing, setEditing] = useState<{ base: number; text: string } | null>(null)
  // A deck's slide text while the person edits it, slide by slide, and the version it started from.
  const [editingSlides, setEditingSlides] = useState<{ base: number; slides: Slide[] } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const state = useRef<InteractiveState | null>(null)
  const revision = useRef(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const load = useCallback(async () => {
    try {
      const [info, saved] = await Promise.all([
        invoke('artifacts.get', artifactId),
        invoke('artifacts.state', artifactId),
      ])
      setPage(info)
      setDocument((current) => {
        if (current?.reference.version === info.version) return current
        void invoke('artifacts.document', artifactId)
          .then(setDocument)
          .catch(() => {})
        return current
      })
      // Another device's values replace these only when they are newer than what this frame last saw.
      if (saved.revision !== revision.current) {
        revision.current = saved.revision
        state.current = saved.state
        bridgeRestore.current?.(saved.state)
      }
      setMissing(false)
    } catch {
      setMissing(true)
    }
  }, [invoke, artifactId])
  const bridgeRestore = useRef<((state: InteractiveState | null) => void) | null>(null)
  useEffect(() => {
    void load()
    return on('artifacts:changed', (payload) => {
      if (payload.artifactId === artifactId && !payload.run) void load()
    })
  }, [load, on, artifactId])
  const instance = `page:${artifactId}:${document?.reference.version ?? 0}:${generation}`
  const { url } = useContentDocument(document?.html, instance, !!document, state, document?.reference.network)
  const slides = document ? slideCount(document) : 0
  const slideControls = useSlideControls(frame, stage, instance, slides)
  useEffect(() => setReady(false), [url])
  const askThread = useCallback(
    (prompt: string, title: string) =>
      new Promise<boolean>((resolve) => setDialog({ kind: 'thread', prompt, resolve, title })),
    [],
  )
  const bridge = usePageBridge({
    artifactId,
    version: document?.reference.version ?? 1,
    frame,
    instance,
    stateRevision: revision,
    onPicked: (element) => {
      setPicking(false)
      setPicked(element)
    },
    onError: setFrameError,
    onStartThread: (prompt) => askThread(prompt, t('The page asks to start a thread')),
  })
  bridgeRestore.current = bridge.restore
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const m = event.data as { ramuInteractive?: number; instance?: string; type?: string }
      if (m?.ramuInteractive !== 1 || m.instance !== instance) return
      if (m.type === 'ready') {
        frame.current?.contentWindow?.postMessage(
          { ramuInteractive: 1, instance, type: 'theme', value: appThemeVariables() },
          '*',
        )
        frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'active', value: true }, '*')
        setReady(true)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [instance])
  const startThread = async (prompt: string, selector?: string) => {
    try {
      const started = await invoke('artifacts.startThread', artifactId, prompt, selector)
      await ws.refresh()
      ws.openTask(started.taskId)
    } catch (error) {
      notifyError(message(error), page?.title)
    }
  }
  if (missing)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>{t('This artifact was deleted or is on a host that is not connected.')}</p>
        <Button variant="outline" onClick={onBack}>
          {t('Back to Artifacts')}
        </Button>
      </div>
    )
  if (!page) return <div className="p-6 text-muted-foreground">{t('Loading…')}</div>
  const width = VIEWPORTS.find((entry) => entry.id === viewport)?.width
  const runs = Object.entries(page.capabilities.runs ?? {})
  const hasRecords = !!page.capabilities.records && !!page.grants.records && !!page.grants.ai
  const outdated = page.published && page.published.version < page.version
  const exportHtml = () => {
    if (!document) return
    const exported = interactiveExport(document, state.current, false, appThemeVariables())
    const link = window.document.createElement('a')
    link.href = URL.createObjectURL(new Blob([exported.html], { type: exported.mimeType }))
    link.download = `${page.title}.html`
    link.click()
  }
  const menu: MenuEntry[] = [
    { key: 'settings', label: t('Page settings…'), onSelect: () => setDialog({ kind: 'settings' }) },
    { key: 'versions', label: t('Versions…'), onSelect: () => setDialog({ kind: 'versions' }) },
    { key: 'rename', label: t('Rename…'), disabled: viewOnly, onSelect: () => setDialog({ kind: 'rename' }) },
    {
      key: 'pin',
      label: page.pinned ? t('Unpin') : t('Pin to top'),
      disabled: viewOnly,
      onSelect: () => void invoke('artifacts.update', artifactId, { pinned: !page.pinned }).catch(() => {}),
    },
    { key: 'sep1', separator: true },
    ...(page.kind === 'app'
      ? [{ key: 'export', label: t('Export HTML'), disabled: !document, onSelect: exportHtml }]
      : kindExportEntries(document, appThemeVariables())),
    ...hostExportEntries(
      page.kind,
      page.title,
      (format) => invoke('artifacts.export', artifactId, document?.reference.version, format),
      !document,
    ),
    {
      key: 'publish',
      label: outdated ? t('Update live site') : t('Publish to the web…'),
      disabled: viewOnly,
      // A page with records or AI needs a server of its own: Make it a project explains and offers that.
      onSelect: () => setDialog({ kind: page.capabilities.records || page.capabilities.ai ? 'project' : 'publish' }),
    },
    {
      key: 'project',
      label: t('Make it a project…'),
      disabled: viewOnly,
      onSelect: () => setDialog({ kind: 'project' }),
    },
    {
      key: 'duplicate',
      label: t('Duplicate'),
      disabled: viewOnly,
      onSelect: () =>
        void invoke('artifacts.duplicate', artifactId)
          .then((copy) => openPage(copy.id))
          .catch((e) => notifyError(message(e))),
    },
    { key: 'sep2', separator: true },
    {
      key: 'delete',
      label: t('Delete artifact…'),
      danger: true,
      disabled: viewOnly,
      onSelect: () => setDialog({ kind: 'delete' }),
    },
  ]
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <header className="flex min-h-11 flex-none items-center gap-1.5 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className={GHOST_ICON_BUTTON_CLASS}
          aria-label={t('Back to Artifacts')}
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </Button>
        <span aria-hidden className="text-[17px] leading-none">
          {page.icon}
        </span>
        <ArtifactKindMark kind={page.kind} size={13} className="flex-none text-muted-foreground" />
        <h1 className="m-0 min-w-0 truncate text-body font-semibold">{page.title}</h1>
        <span className="flex-none text-caption text-muted-foreground">v{page.version}</span>
        {page.published && (
          <a
            className="min-w-0 truncate text-caption text-muted-foreground underline"
            href={page.published.url}
            target="_blank"
            rel="noreferrer"
          >
            {page.published.url.replace(/^https:\/\//, '')}
          </a>
        )}
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {slides > 0 && <SlideToolbar controls={slideControls} count={slides} disabled={!ready} />}
          {page.kind === 'slides' && !editingSlides && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={viewOnly || !document}
              title={t('Change the words yourself; the agent keeps your edit when it revises')}
              onClick={() => {
                const stored = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.slides)?.content
                if (document && stored)
                  setEditingSlides({
                    base: document.reference.version,
                    slides: (JSON.parse(stored) as { slides: Slide[] }).slides,
                  })
              }}
            >
              <PenLine size={13} /> {t('Edit text')}
            </Button>
          )}
          {page.kind === 'doc' && !editing && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={viewOnly || !document}
              title={t('Change the words yourself; the agent keeps your edit when it revises')}
              onClick={() => {
                const text = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.doc)?.content
                if (document && text !== undefined) setEditing({ base: document.reference.version, text })
              }}
            >
              <PenLine size={13} /> {t('Edit text')}
            </Button>
          )}
          {runs.map(([name, run]) => (
            <Button
              key={name}
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={viewOnly || !!bridge.running || !page.grants.ai}
              title={run.prompt}
              onClick={() =>
                void invoke('artifacts.runFlow', artifactId, name).catch((e) => notifyError(message(e), page.title))
              }
            >
              <Play size={12} /> {run.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            className={GHOST_TEXT_BUTTON_CLASS}
            aria-pressed={picking}
            disabled={viewOnly || !ready}
            title={t('Point at something on the page and say what to change')}
            onClick={() => {
              const next = !picking
              setPicking(next)
              bridge.pick(next)
            }}
          >
            <MousePointerClick size={13} /> {t('Edit')}
          </Button>
          <Button
            variant="ghost"
            className={GHOST_TEXT_BUTTON_CLASS}
            disabled={viewOnly}
            onClick={() => setDialog({ kind: 'thread', prompt: '', title: t('Ask about this page') })}
          >
            <MessageSquarePlus size={13} /> {t('Ask about this')}
          </Button>
          <div role="group" aria-label={t('Preview width')} className="mx-1 flex items-center rounded-md bg-fill p-0.5">
            {VIEWPORTS.map(({ id, label, Icon }) => (
              <Button
                key={id}
                variant="ghost"
                size="icon-sm"
                aria-pressed={viewport === id}
                aria-label={t(label)}
                title={t(label)}
                className={`${GHOST_ICON_BUTTON_CLASS} size-6 min-h-0 aria-pressed:bg-raised aria-pressed:text-foreground`}
                onClick={() => setViewport(id)}
              >
                <Icon size={13} />
              </Button>
            ))}
          </div>
          <Menu
            label={t('Page actions')}
            icon={<MoreHorizontal size={14} />}
            className={GHOST_ICON_BUTTON_CLASS}
            align="end"
            items={menu}
          />
        </div>
      </header>
      {page.lastError && (
        <div role="alert" className="flex items-center gap-2 border-b border-border bg-fill px-3 py-1.5 text-caption">
          <Bug size={13} className="flex-none text-bad" />
          <span className="min-w-0 flex-1 truncate">
            {t('This page hit an error: {message}', { message: page.lastError.message })}
          </span>
          {!viewOnly && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              onClick={() => {
                const error = page.lastError!
                void startThread(
                  `Fix this error in my page. Reproduce it with artifact_preview, then publish the fixed version with artifact_publish {artifact: "${page.id}", changes}.\nError on ${error.device ?? 'a device'} in v${error.version}: ${error.message}${error.steps?.length ? `\nWhat the person did before it: ${error.steps.join(' → ')}` : ''}`,
                ).then(() => invoke('artifacts.clearError', artifactId))
              }}
            >
              {t('Fix this')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className={`${GHOST_ICON_BUTTON_CLASS} size-6`}
            aria-label={t('Dismiss')}
            onClick={() => void invoke('artifacts.clearError', artifactId)}
          >
            <X size={12} />
          </Button>
        </div>
      )}
      {outdated && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-caption text-muted-foreground">
          <span className="flex-1">
            {t('The live site shows v{live}; this page is at v{version}.', {
              live: page.published!.version,
              version: page.version,
            })}
          </span>
          {!viewOnly && (
            <Button variant="ghost" className={GHOST_TEXT_BUTTON_CLASS} onClick={() => setDialog({ kind: 'publish' })}>
              {t('Update live site')}
            </Button>
          )}
        </div>
      )}
      {bridge.running && (
        <div role="status" className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-caption">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {runStatusLabel('running')} · {bridge.running.steps.at(-1)?.text ?? bridge.running.task.slice(0, 80)}
          </span>
          <Button variant="ghost" className={GHOST_TEXT_BUTTON_CLASS} onClick={bridge.stopRun}>
            <Square size={11} /> {t('Stop')}
          </Button>
        </div>
      )}
      {bridge.confirm && (
        <div
          role="alertdialog"
          className="flex items-center gap-2 border-b border-border bg-fill px-3 py-1.5 text-caption"
        >
          <span className="flex-1">{bridge.confirm.text}</span>
          <Button variant="outline" onClick={() => bridge.answerConfirm(false)}>
            {t('Keep them')}
          </Button>
          <Button variant="destructive" onClick={() => bridge.answerConfirm(true)}>
            {t('Allow')}
          </Button>
        </div>
      )}
      {picked && (
        <form
          className="flex items-center gap-2 border-b border-border px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const input = (event.currentTarget.elements.namedItem('change') as HTMLInputElement).value.trim()
            if (!input) return
            void startThread(
              `${input}\nChange only this element of the page (the person pointed at it): ${picked.selector}\nIts text: ${JSON.stringify(picked.text)}\nIts HTML: ${picked.html}`,
              picked.selector,
            )
            setPicked(null)
          }}
        >
          <span className="max-w-[40%] flex-none truncate text-caption text-muted-foreground" title={picked.text}>
            {picked.text || picked.selector}
          </span>
          <Input
            name="change"
            autoFocus
            placeholder={t('What should change here?')}
            aria-label={t('What should change here?')}
          />
          <Button type="submit">{t('Ask')}</Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={GHOST_ICON_BUTTON_CLASS}
            aria-label={t('Cancel')}
            onClick={() => setPicked(null)}
          >
            <X size={13} />
          </Button>
        </form>
      )}
      {hasRecords && (
        <form
          className="flex items-center gap-2 border-b border-border px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (question.trim().length < 2) return
            setAsking(true)
            setAnswer(null)
            void invoke('artifacts.ask', artifactId, question.trim())
              .then(setAnswer)
              .catch((e) => notifyError(message(e), page.title))
              .finally(() => setAsking(false))
          }}
        >
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('Ask this page, such as “how much on food in March?”')}
            aria-label={t('Ask this page')}
          />
          <Button type="submit" variant="outline" disabled={asking || question.trim().length < 2}>
            {asking ? t('Asking…') : t('Ask')}
          </Button>
        </form>
      )}
      {answer && (
        <PageAnswer
          run={answer}
          question={question}
          onKeep={(prompt) => void startThread(prompt)}
          onClose={() => setAnswer(null)}
        />
      )}
      {frameError && (
        <p role="status" className="m-0 border-b border-border px-3 py-1.5 text-caption text-muted-foreground">
          {frameError}{' '}
          <Button
            variant="ghost"
            className={GHOST_TEXT_BUTTON_CLASS}
            onClick={() => {
              setFrameError('')
              setGeneration((n) => n + 1)
            }}
          >
            {t('Reload')}
          </Button>
        </p>
      )}
      {status && (
        <p role="status" className="m-0 border-b border-border px-3 py-1.5 text-caption text-muted-foreground">
          {status}
        </p>
      )}
      {editing && (
        <form
          aria-label={t('Edit text')}
          className="flex min-h-0 flex-1 flex-col gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            invoke('artifacts.editDoc', artifactId, editing.base, editing.text)
              .then(() => {
                setEditing(null)
                void load()
              })
              // A newer version or a problem in the text keeps the edit open, so nothing typed is lost.
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          <Textarea
            aria-label={t('Markdown')}
            className="min-h-0 flex-1 resize-none font-mono text-control"
            value={editing.text}
            onChange={(event) => setEditing({ ...editing, text: event.target.value })}
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-caption text-muted-foreground">
              {t('Saving makes v{version}, marked Edited by you.', { version: editing.base + 1 })}
            </span>
            <Button type="button" variant="ghost" disabled={savingEdit} onClick={() => setEditing(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      {editingSlides && (
        <form
          aria-label={t('Edit text')}
          className="flex min-h-0 flex-1 flex-col gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            const edits = editingSlides.slides.map(({ title, body, columns, by, notes }) => ({
              title: title ?? '',
              body: body ?? '',
              by: by ?? '',
              notes: notes ?? '',
              ...(columns ? { columns } : {}),
            }))
            invoke('artifacts.editSlides', artifactId, editingSlides.base, edits)
              .then(() => {
                setEditingSlides(null)
                void load()
              })
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          <ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-4 overflow-auto p-0">
            {editingSlides.slides.map((slide, index) => {
              const change = (patch: Partial<Slide>) =>
                setEditingSlides({
                  ...editingSlides,
                  slides: editingSlides.slides.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
                })
              return (
                <li key={index} className="flex flex-col gap-1.5">
                  <strong className="text-caption text-muted-foreground">
                    {t('Slide {number}', { number: index + 1 })}
                  </strong>
                  {slide.layout !== 'quote' && (
                    <Input
                      aria-label={t('Title of slide {number}', { number: index + 1 })}
                      value={slide.title ?? ''}
                      onChange={(event) => change({ title: event.target.value })}
                    />
                  )}
                  {slide.layout === 'two-columns' && slide.columns ? (
                    slide.columns.map((column, at) => (
                      <Textarea
                        key={at}
                        aria-label={t('Column {column} of slide {number}', { column: at + 1, number: index + 1 })}
                        value={column}
                        onChange={(event) =>
                          change({
                            columns: (at === 0
                              ? [event.target.value, slide.columns![1]]
                              : [slide.columns![0], event.target.value]) as [string, string],
                          })
                        }
                      />
                    ))
                  ) : (
                    <Textarea
                      aria-label={t('Text of slide {number}', { number: index + 1 })}
                      value={slide.body ?? ''}
                      onChange={(event) => change({ body: event.target.value })}
                    />
                  )}
                  {slide.layout === 'quote' && (
                    <Input
                      aria-label={t('Who said it, slide {number}', { number: index + 1 })}
                      value={slide.by ?? ''}
                      onChange={(event) => change({ by: event.target.value })}
                    />
                  )}
                  <Textarea
                    aria-label={t('Speaker notes of slide {number}', { number: index + 1 })}
                    placeholder={t('Speaker notes')}
                    value={slide.notes ?? ''}
                    onChange={(event) => change({ notes: event.target.value })}
                  />
                </li>
              )
            })}
          </ol>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-caption text-muted-foreground">
              {t('Saving makes v{version}, marked Edited by you.', { version: editingSlides.base + 1 })}
            </span>
            <Button type="button" variant="ghost" disabled={savingEdit} onClick={() => setEditingSlides(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      <div
        hidden={!!editing || !!editingSlides}
        className={`relative min-h-0 flex-1 overflow-auto ${width ? 'flex justify-center bg-fill px-3 py-4' : ''}`}
      >
        <div
          ref={stage}
          className={`relative ${width ? 'h-full overflow-hidden rounded-lg bg-(--canvas)' : 'size-full'} ${slideControls.presenting ? '[&>iframe]:pointer-events-none' : ''}`}
          style={{ width }}
        >
          {url && <ContentFrame ref={frame} key={url} title={page.title} url={url} ready={ready} onLoad={() => {}} />}
          {!ready && (
            <p className="absolute inset-0 m-0 flex items-center justify-center text-muted-foreground">
              {t('Loading…')}
            </p>
          )}
        </div>
      </div>
      {!viewOnly && page.pendingGrants.length > 0 && <GrantSheet page={page} onDone={() => void load()} />}
      {dialog?.kind === 'settings' && <PageSettings page={page} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'publish' && <PublishDialog page={page} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'versions' && (
        <VersionsDialog
          page={page}
          onClose={() => setDialog(null)}
          onRestore={(version) =>
            void invoke('artifacts.restoreVersion', artifactId, version)
              .then(() => setStatus(t('Restored v{version} as the newest version.', { version })))
              .catch((e) => notifyError(message(e), page.title))
          }
        />
      )}
      {dialog?.kind === 'rename' && <RenameDialog page={page} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <Dialog
          title={t('Delete {title}?', { title: page.title })}
          confirmLabel={t('Delete artifact')}
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void invoke('artifacts.delete', artifactId)
              .then(onBack)
              .catch((e) => notifyError(message(e)))
          }
        >
          <p>{t('Its records, photos, runs and share links are deleted too. Threads keep their cards.')}</p>
        </Dialog>
      )}
      {dialog?.kind === 'project' && (
        <Dialog
          title={t('Make it a project?')}
          confirmLabel={t('Make it a project')}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void invoke('artifacts.makeProject', artifactId)
              .then(async (made) => {
                await ws.refresh()
                ws.openTask(made.thread.taskId)
              })
              .catch((e) => notifyError(message(e), page.title))
          }}
        >
          <p>
            {page.capabilities.records || page.capabilities.ai
              ? t(
                  'This page keeps records or uses a model on this host, so it cannot go on the web as it is. A project can have its own database and server.',
                )
              : t('A project can have a backend, more files, sign-in and its own domain.')}
          </p>
          <p>
            {t(
              'Ramu writes the page’s sources and records to a new folder in Ramu Projects and starts a thread there to turn it into an app.',
            )}
          </p>
        </Dialog>
      )}
      {dialog?.kind === 'thread' && (
        <ThreadDialog
          title={dialog.title}
          prompt={dialog.prompt}
          onCancel={() => {
            dialog.resolve?.(false)
            setDialog(null)
          }}
          onConfirm={(prompt) => {
            setDialog(null)
            if (dialog.resolve) dialog.resolve(true)
            else void startThread(prompt)
          }}
        />
      )}
    </div>
  )
}

/** The answer to a question about the page's records, with a small bar chart when it has a breakdown. */
function PageAnswer({
  run,
  question,
  onKeep,
  onClose,
}: {
  run: ArtifactRun
  question: string
  onKeep(prompt: string): void
  onClose(): void
}) {
  useLanguage()
  const value = (run.answer ?? {}) as { text?: string; rows?: { label?: unknown; value?: unknown }[] }
  const rows = Array.isArray(value.rows)
    ? value.rows
        .flatMap((row) =>
          typeof row?.value === 'number' ? [{ label: String(row.label ?? ''), value: row.value }] : [],
        )
        .slice(0, 12)
    : []
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
  return (
    <section className="border-b border-border px-3 py-2" aria-label={t('Answer')}>
      <div className="flex items-start gap-2">
        <p className="m-0 flex-1">{run.status === 'done' ? (value.text ?? '') : (run.error ?? t('No answer.'))}</p>
        {run.status === 'done' && (
          <Button
            variant="ghost"
            className={GHOST_TEXT_BUTTON_CLASS}
            onClick={() =>
              onKeep(
                `Add a panel to my page that always shows the answer to "${question}" from its records (today it is: ${value.text ?? ''}). Compute it with ramuContent.records, not a model call, and publish the new version.`,
              )
            }
          >
            {t('Keep as a panel')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className={`${GHOST_ICON_BUTTON_CLASS} size-6`}
          aria-label={t('Close')}
          onClick={onClose}
        >
          <X size={12} />
        </Button>
      </div>
      {rows.length > 0 && (
        <div className="mt-2 grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-x-2 gap-y-1 text-caption">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <span className="truncate text-muted-foreground">{row.label}</span>
              <span
                className="h-2 rounded-sm bg-(--accent)"
                style={{ width: `${(Math.abs(row.value) / max) * 100}%` }}
              />
              <span className="text-right tabular-nums">{row.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Every version with its phone and desktop screenshots and what it changed, so the right one is restored. */
function VersionsDialog({
  page,
  onClose,
  onRestore,
}: {
  page: ArtifactInfo
  onClose(): void
  onRestore(version: number): void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [versions, setVersions] = useState<ArtifactVersion[] | null>(null)
  useEffect(() => {
    void invoke('artifacts.versions', page.id)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [invoke, page.id])
  return (
    <Dialog
      title={t('Versions of {title}', { title: page.title })}
      confirmLabel={t('Done')}
      onCancel={onClose}
      onConfirm={onClose}
    >
      <div className="undo-preview flex flex-col gap-3">
        {!versions && <p>{t('Loading…')}</p>}
        {versions?.map((version) => (
          <div key={version.reference.version} className="flex gap-3 border-b border-border pb-3 last:border-0">
            {version.preview ? (
              <img
                src={version.preview}
                alt={t('Phone preview of {title}', { title: `v${version.reference.version}` })}
                className="h-40 w-24 flex-none rounded-md object-cover object-top"
              />
            ) : (
              <div className="h-40 w-24 flex-none rounded-md bg-fill" />
            )}
            {version.wide && (
              <img
                src={version.wide}
                alt={t('Desktop preview of {title}', { title: `v${version.reference.version}` })}
                className="h-40 w-56 flex-none rounded-md object-cover object-top"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="m-0 font-medium text-foreground">
                v{version.reference.version}
                {version.reference.version === page.version ? ` · ${t('Current')}` : ''}
              </p>
              <p className="m-0 text-caption text-muted-foreground">
                {new Date(version.reference.createdAt).toLocaleString()}
              </p>
              <p className="m-0 mt-1">{version.reference.changes ?? version.reference.summary}</p>
              {version.reference.version !== page.version && (
                <Button variant="outline" className="mt-2" onClick={() => onRestore(version.reference.version)}>
                  {t('Restore v{version}', { version: version.reference.version })}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

function RenameDialog({ page, onClose }: { page: ArtifactInfo; onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [title, setTitle] = useState(page.title)
  const [icon, setIcon] = useState(page.icon)
  return (
    <Dialog
      title={t('Rename artifact')}
      confirmLabel={t('Save')}
      confirmDisabled={!title.trim()}
      onCancel={onClose}
      onConfirm={() =>
        void invoke('artifacts.update', page.id, { title, icon })
          .then(onClose)
          .catch((e) => notifyError(message(e)))
      }
    >
      <div className="flex gap-2">
        <Input
          className="w-14 text-center"
          aria-label={t('Icon')}
          value={icon}
          maxLength={4}
          onChange={(e) => setIcon(e.target.value)}
        />
        <Input
          aria-label={t('Title')}
          value={title}
          maxLength={160}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
    </Dialog>
  )
}

/** Confirms a thread a page or the person starts, with the request editable before it goes. */
function ThreadDialog({
  title,
  prompt,
  onCancel,
  onConfirm,
}: {
  title: string
  prompt: string
  onCancel(): void
  onConfirm(prompt: string): void
}) {
  useLanguage()
  const [text, setText] = useState(prompt)
  return (
    <Dialog
      title={title}
      confirmLabel={t('Start thread')}
      confirmDisabled={!text.trim()}
      onCancel={onCancel}
      onConfirm={() => onConfirm(text.trim())}
    >
      <p>{t('A new thread starts with this page attached. It works with its usual access and approvals.')}</p>
      <Textarea
        className="min-h-24 bg-field text-body"
        aria-label={t('Request')}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </Dialog>
  )
}
