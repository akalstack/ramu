import { ContentFrame } from './ContentFrame'
import { observeContentVisibility } from './contentVisibility'
import { useContentDocument } from './useContentDocument'
import { InteractiveFollowupPicker } from './InteractiveFollowupPicker'
import { interactiveExport } from '@ramu/shared/interactiveExport'
import { Input } from '../components/desktop-input'
import { interactiveVersions, canCopyInteractiveState } from '@ramu/shared/interactiveVersions'
import { t, useLanguage } from '../i18n'
import { claimInteractive } from '@ramu/shared/interactiveLease'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InteractiveDocument, InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveFollowup, readInteractiveState } from '@ramu/shared/interactive'
import { interactiveStorage } from '@ramu/shared/interactiveStorage'
import { INTERACTIVE_FOLLOWUP_EVENT, type InteractiveFollowupDetail } from './followup'
import { interactivePaletteFromVariant, interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { DEFAULT_DARK, DEFAULT_LIGHT } from '@ramu/shared/theme'
import { useHost } from '../workspace/HostProvider'
import { hostStorageFor } from '../hostStorage'
import { Button } from '../components/desktop-button'
import { GHOST_ICON_BUTTON_CLASS, GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { Menu, type MenuEntry } from '../Menu'
import { ChatCodeBlock } from '../chat/ChatCodeBlock'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { usePageIndex } from '../pages/pageIndex'
import { openPage } from '../pages/openPage'
import { ArtifactKindMark, kindExportEntries } from '../pages/ArtifactKindMark'
import type { InteractiveRevision, InteractiveUpdate } from '@ramu/shared/interactiveRevisions'
import {
  InteractiveCarriedValues,
  InteractiveCompare,
  InteractiveVersionRow,
  interactiveAnchor,
} from './InteractiveRevision'
import { Maximize2, Minimize2, Monitor, MoreHorizontal, RotateCcw, Smartphone, Tablet, X } from 'lucide-react'

/** Live documents per renderer; offscreen cards unload, so this only bounds several cards visible together. */
const LIVE_LIMIT = 3
/** Widths a reader can preview the document at; Fit uses the card's own width. */
const VIEWPORTS = [
  { id: 'fit', label: 'Fit to width', width: undefined, Icon: Monitor },
  { id: 'tablet', label: 'Tablet (768 px)', width: 768, Icon: Tablet },
  { id: 'phone', label: 'Phone (390 px)', width: 390, Icon: Smartphone },
] as const
type Viewport = (typeof VIEWPORTS)[number]['id']
/** Last measured height per version, so remounting after scrolling back does not jump. */
const heights = new Map<string, number>()

/** The app's live palette as the theme tokens a document is drawn with. */
export function appThemeVariables(): Record<string, string> {
  const style = getComputedStyle(window.document.documentElement)
  const dark = style.colorScheme !== 'light'
  const fallback = interactivePaletteFromVariant(dark ? DEFAULT_DARK : DEFAULT_LIGHT, dark ? 'dark' : 'light')
  const read = (name: string, value: string) => style.getPropertyValue(name).trim() || value
  return interactiveThemeVariables({
    scheme: fallback.scheme,
    background: read('--canvas', fallback.background),
    foreground: read('--text', fallback.foreground),
    muted: read('--muted', fallback.muted),
    primary: read('--accent', fallback.primary),
    surface: read('--raised', fallback.surface),
    surfaceRaised: read('--bubble', fallback.surfaceRaised),
    codeBackground: read('--code-bg', fallback.codeBackground),
    button: read('--primary', fallback.button),
    buttonForeground: read('--primary-ink', fallback.buttonForeground),
    success: read('--ok', fallback.success),
    warning: read('--warn', fallback.warning),
    danger: read('--bad', fallback.danger),
  })
}

/** A document is never inserted in the application DOM and never receives a privileged bridge. */
function InteractiveDocumentCard({
  reference,
  copyFrom,
  versions,
  onClose,
  previous,
  update,
  page,
}: {
  reference: InteractiveReference
  copyFrom?: InteractiveReference
  versions?: { load(): void; items: MenuEntry[] }
  onClose?: () => void
  /** The kept page this document belongs to, and whether the card shows a version another thread published. */
  page?: { info: ArtifactInfo | null; elsewhere: boolean }
  /** The version this one replaced, for Compare and carrying values over. */
  previous?: InteractiveReference
  /** A revision of this document the agent is checking now. */
  update?: InteractiveUpdate
}) {
  useLanguage()
  const host = useHost()
  const { invoke } = host
  const cache = useMemo(() => interactiveStorage(hostStorageFor(host.id), 'content'), [host.id])
  const [document, setDocument] = useState<InteractiveDocument | null>(() =>
    cache.document(reference.id, reference.version),
  )
  const [selectionId, setSelectionId] = useState(0)
  const [selection, setSelection] = useState<InteractiveState | null>(null)
  const [scenariosOpen, setScenariosOpen] = useState(false)
  const [scenarioName, setScenarioName] = useState('')
  const [, setScenarioRevision] = useState(0)
  const scenarios = cache.scenarios(reference.id, reference.version)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(false)
  const [evicted, setEvicted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [file, setFile] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [viewport, setViewport] = useState<Viewport>('fit')
  const [expanded, setExpanded] = useState(false)
  const width = VIEWPORTS.find((entry) => entry.id === viewport)?.width
  const key = `${reference.id}:${reference.version}`
  const [height, setHeight] = useState(() => heights.get(key) ?? 360)
  const pending = useRef<{ id: string; run: () => void; timer: ReturnType<typeof setTimeout> } | null>(null)
  const requestSequence = useRef(0)
  const loaded = useRef('')
  const frame = useRef<HTMLIFrameElement>(null)
  const root = useRef<HTMLElement>(null)
  const state = useRef(cache.state(reference.id, reference.version))
  const [comparing, setComparing] = useState(false)
  const [carried, setCarried] = useState<
    { kind: 'moved'; from: number } | { kind: 'kept'; from: number; state: InteractiveState } | null
  >(null)
  // A new version takes the values entered in the one it replaced once, when their meaning is declared the same.
  useEffect(() => {
    if (!previous || state.current) return
    const store = hostStorageFor(host.id)
    const flag = `ramu.interactive.carried.${reference.id}:${reference.version}`
    try {
      if (store.getItem(flag)) return
      store.setItem(flag, '1')
    } catch {
      return
    }
    const saved = cache.state(previous.id, previous.version)
    if (!saved) return
    if (canCopyInteractiveState(previous, reference)) {
      state.current = saved
      cache.saveState(reference.id, reference.version, saved)
      setCarried({ kind: 'moved', from: previous.version })
      setGeneration((n) => n + 1)
    } else setCarried({ kind: 'kept', from: previous.version, state: saved })
  }, [previous, reference, cache, host.id])
  // Scrolling away releases the document; hiding the app pauses it without losing its in-memory playback state.
  const live = !!document && visible && !evicted && !failed && view === 'preview'
  const instance = `${key}:${generation}`
  const html = document?.html
  const { url, error: mountError } = useContentDocument(html, instance, live, state, document?.reference.network)
  useEffect(() => {
    setReady(false)
  }, [live, html, instance])
  useEffect(() => {
    if (mountError) {
      setError(mountError)
      setFailed(true)
    }
  }, [mountError])
  useEffect(() => {
    let cancelled = false
    void invoke('interactive.get', reference.sessionId, reference.id, reference.version)
      .then((value) => {
        if (cancelled) return
        cache.saveDocument(value)
        setDocument(value)
        setError('')
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [invoke, cache, reference, host.status])
  useEffect(() => {
    const sendTheme = () => {
      frame.current?.contentWindow?.postMessage(
        {
          ramuInteractive: 1,
          instance,
          type: 'theme',
          value: appThemeVariables(),
        },
        '*',
      )
    }
    const observer = new MutationObserver(sendTheme)
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-appearance'],
    })
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const m = event.data
      if (!m || m.ramuInteractive !== 1 || m.instance !== instance) return
      if (m.type === 'ready') {
        frame.current?.contentWindow?.postMessage(
          { ramuInteractive: 1, instance, type: 'active', value: !window.document.hidden },
          '*',
        )
        sendTheme()
        setReady(true)
      }
      if (m.type === 'state') {
        const next = readInteractiveState(m.value)
        if (next) {
          state.current = next
          cache.saveState(reference.id, reference.version, next)
          if (pending.current && m.requestId === pending.current.id) {
            const action = pending.current
            pending.current = null
            clearTimeout(action.timer)
            action.run()
          }
        }
      }
      if (m.type === 'height' && Number.isFinite(m.value)) {
        const next = Math.max(48, Math.min(2000, m.value))
        heights.set(key, next)
        setHeight(next)
      }
      // A script error is reported but the document keeps running; Reset reloads the saved version.
      if (m.type === 'error') setError(t('An interaction failed. Reset or ask the agent to revise this version.'))
    }
    window.addEventListener('message', receive)
    return () => {
      observer.disconnect()
      window.removeEventListener('message', receive)
    }
  }, [instance, cache, reference, key])
  useEffect(() => {
    if (!root.current) return
    return observeContentVisibility(root.current, window.document, {
      visible: () => {
        setEvicted(false)
        setVisible(true)
      },
      hidden: () => setVisible(false),
      active: (value) =>
        frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'active', value }, '*'),
    })
  }, [instance])
  useEffect(() => (live ? claimInteractive(() => setEvicted(true), LIVE_LIMIT) : undefined), [live])
  useEffect(() => {
    if (!expanded) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [expanded])
  const restart = () => {
    setError('')
    setFailed(false)
    setEvicted(false)
    setGeneration((n) => n + 1)
  }
  const capture = (run: () => void) => {
    if (!live || !ready) {
      run()
      return
    }
    if (pending.current) clearTimeout(pending.current.timer)
    const id = `${instance}:${++requestSequence.current}`
    const timer = setTimeout(() => {
      pending.current = null
      setError(t('Could not capture the current scenario. Reset and try again.'))
    }, 1500)
    pending.current = { id, run, timer }
    frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'snapshot', requestId: id }, '*')
  }
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer)
    },
    [instance],
  )
  const download = (raw = false) => {
    const run = () => {
      if (!document) return
      // Exports keep the palette the reader is looking at, so they open looking the same.
      const exported = interactiveExport(document, state.current, raw, appThemeVariables())
      const url = URL.createObjectURL(new Blob([exported.html], { type: exported.mimeType }))
      const link = window.document.createElement('a')
      link.href = url
      link.download = exported.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    if (raw) run()
    else capture(run)
  }
  // The thread's composer shows this as a chip and sends the text as hidden context with the next message.
  const stage = (detail: string, text: string) =>
    window.dispatchEvent(
      new CustomEvent<InteractiveFollowupDetail>(INTERACTIVE_FOLLOWUP_EVENT, {
        detail: {
          host: host.id,
          session: reference.sessionId,
          attachment: { id: reference.id, version: reference.version, title: reference.title, detail, text },
        },
      }),
    )
  const reset = () => {
    state.current = null
    cache.saveState(reference.id, reference.version, null)
    restart()
  }
  const files = document?.files ?? []
  const menu: MenuEntry[] = [
    ...(onClose
      ? []
      : page?.info
        ? [{ key: 'open-page', label: t('Open'), onSelect: () => openPage(page.info!.id) }]
        : [
            {
              key: 'keep',
              label: t('Keep as artifact'),
              title: t('List it under Artifacts, open it on any device and change it from any thread'),
              onSelect: () =>
                void invoke('artifacts.keep', reference.sessionId, reference.id)
                  .then((kept) => openPage(kept.id))
                  .catch((e) => setError(String(e))),
            },
          ]),
    {
      key: 'ask',
      label: t('Ask about this'),
      title: t('Add this content and its current scenario to your message'),
      onSelect: () =>
        capture(() =>
          stage(state.current ? t('Current scenario') : t('As shown'), interactiveFollowup(reference, state.current)),
        ),
    },
    {
      key: 'choose',
      label: t('Choose values…'),
      disabled: !document,
      onSelect: () =>
        capture(() => {
          if (state.current) {
            setSelection(state.current)
            setSelectionId((n) => n + 1)
          } else setError(t('Change a control first, then choose values to add to your draft.'))
        }),
    },
    { key: 'scenarios', label: t('Saved scenarios…'), disabled: !document, onSelect: () => setScenariosOpen(true) },
    ...(copyFrom && canCopyInteractiveState(copyFrom, reference)
      ? [
          {
            key: 'copy',
            label: t('Copy saved scenario from v{version}', { version: copyFrom.version }),
            onSelect: () =>
              capture(() => {
                const saved = cache.state(copyFrom.id, copyFrom.version)
                if (!saved) {
                  setError(t('v{version} has no saved scenario yet.', { version: copyFrom.version }))
                  return
                }
                state.current = saved
                cache.saveState(reference.id, reference.version, saved)
                restart()
              }),
          },
        ]
      : []),
    ...(versions
      ? [
          { key: 'versions-sep', separator: true as const },
          { key: 'versions', label: t('Versions'), submenu: versions.items },
        ]
      : []),
    { key: 'export-sep', separator: true },
    ...(reference.kind
      ? kindExportEntries(document, appThemeVariables())
      : [
          { key: 'export', label: t('Export HTML'), disabled: !document, onSelect: () => download() },
          {
            key: 'source',
            label: files.length ? t('Export bundled source') : t('Export source'),
            disabled: !document,
            onSelect: () => download(true),
          },
        ]),
  ]
  const checked = reference.checked ? t('Controls checked in preview') : t('Rendering checked in preview')
  return (
    <>
      <section
        ref={root}
        // Expanding restyles this same element, so the live frame and its state stay as they are.
        className={
          expanded
            ? 'fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl bg-(--canvas) shadow-2xl'
            : 'my-3 overflow-hidden rounded-xl bg-(--canvas)'
        }
        id={onClose ? undefined : interactiveAnchor(reference.id)}
        aria-label={reference.title}
        aria-describedby={`interactive-summary-${key}`}
      >
        <header className="flex min-h-9 items-center gap-1.5 py-1 pr-1.5 pl-3">
          <ArtifactKindMark kind={reference.kind ?? 'app'} className="flex-none text-muted-foreground" />
          <h3 className="m-0 min-w-0 truncate text-body font-medium">{reference.title}</h3>
          <span className="flex-none text-caption text-muted-foreground" title={checked}>
            v{reference.version}
          </span>
          {page?.info && (
            <Button
              variant="ghost"
              className={`${GHOST_TEXT_BUTTON_CLASS} h-6 min-h-0 flex-none`}
              title={t('Open')}
              onClick={() => openPage(page.info!.id)}
            >
              <span aria-hidden>{page.info.icon}</span> {t('Artifact')}
            </Button>
          )}
          {page && !page.info && reference.artifactId && (
            <span className="flex-none text-caption text-muted-foreground">{t('Artifact deleted')}</span>
          )}
          {page?.elsewhere && (
            <span className="flex-none text-caption text-muted-foreground">{t('Updated in another thread')}</span>
          )}
          {update?.state === 'updating' && (
            <span role="status" className="flex-none animate-pulse text-caption text-muted-foreground">
              {t('Updating…')}
            </span>
          )}
          <p id={`interactive-summary-${key}`} className="sr-only">
            {reference.summary}
          </p>
          <div className="ml-auto flex flex-none items-center gap-0.5">
            {files.length > 0 && (
              <div role="group" aria-label={t('View')} className="mr-1 flex items-center rounded-md bg-fill p-0.5">
                {(['preview', 'code'] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant="ghost"
                    aria-pressed={view === mode}
                    className={`${GHOST_TEXT_BUTTON_CLASS} h-6 min-h-0 px-2 aria-pressed:bg-raised aria-pressed:text-foreground`}
                    onClick={() => setView(mode)}
                  >
                    {mode === 'preview' ? t('Preview') : t('Code')}
                  </Button>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className={GHOST_ICON_BUTTON_CLASS}
              aria-label={t('Reset')}
              title={t('Reset')}
              disabled={!document}
              onClick={reset}
            >
              <RotateCcw size={14} />
            </Button>
            {view === 'preview' && (
              <div
                role="group"
                aria-label={t('Preview width')}
                className="mr-1 flex items-center rounded-md bg-fill p-0.5"
              >
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
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className={GHOST_ICON_BUTTON_CLASS}
              aria-label={expanded ? t('Collapse') : t('Expand')}
              title={expanded ? t('Collapse (Esc)') : t('Expand')}
              aria-pressed={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
            <Menu
              label={t('Content actions')}
              icon={<MoreHorizontal size={14} />}
              className={GHOST_ICON_BUTTON_CLASS}
              align="end"
              items={menu}
              onOpen={versions?.load}
            />
            {onClose && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={GHOST_ICON_BUTTON_CLASS}
                aria-label={t('Close')}
                title={t('Close')}
                onClick={onClose}
              >
                <X size={14} />
              </Button>
            )}
          </div>
        </header>
        {reference.changes && !onClose && (
          <div className="flex items-center gap-1.5 border-t border-border px-3 py-1 text-caption text-muted-foreground">
            <span className="min-w-0 truncate" title={reference.changes}>
              {t('Updated · v{version}', { version: reference.version })} · {reference.changes}
            </span>
            {previous && (
              <Button
                variant="ghost"
                aria-pressed={comparing}
                className={`${GHOST_TEXT_BUTTON_CLASS} ml-auto h-6 min-h-0 flex-none aria-pressed:bg-raised aria-pressed:text-foreground`}
                onClick={() => setComparing((value) => !value)}
              >
                {t('Compare')}
              </Button>
            )}
          </div>
        )}
        {update?.state === 'failed' && (
          <p role="status" className="m-0 border-t border-border px-3 py-1.5 text-caption text-muted-foreground">
            {t('The latest revision did not publish, so this version is unchanged: {detail}', {
              detail: update.detail,
            })}
          </p>
        )}
        {carried && (
          <div role="status" className="border-t border-border px-3 py-1.5 text-caption text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1">
                {carried.kind === 'moved'
                  ? t('Your values from v{version} carried over.', { version: carried.from })
                  : t('Values from v{version} could not carry over because this version changed what they mean.', {
                      version: carried.from,
                    })}
              </span>
              {carried.kind === 'moved' && (
                <Button
                  variant="ghost"
                  className={`${GHOST_TEXT_BUTTON_CLASS} h-6 min-h-0`}
                  onClick={() => {
                    setCarried(null)
                    reset()
                  }}
                >
                  {t('Undo')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className={`${GHOST_ICON_BUTTON_CLASS} size-6`}
                aria-label={t('Dismiss')}
                onClick={() => setCarried(null)}
              >
                <X size={12} />
              </Button>
            </div>
            {carried.kind === 'kept' && <InteractiveCarriedValues state={carried.state} />}
          </div>
        )}
        {comparing && previous && <InteractiveCompare previous={previous} current={reference} document={document} />}
        {selection && (
          <InteractiveFollowupPicker
            key={selectionId}
            reference={reference}
            state={selection}
            onStage={(text) => stage(t('Chosen values'), text)}
            onClose={() => setSelection(null)}
          />
        )}
        {scenariosOpen && (
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('Scenario name')}
                placeholder={t('Name the current scenario')}
                value={scenarioName}
                maxLength={80}
                autoFocus
                onChange={(e) => setScenarioName(e.target.value)}
              />
              <Button
                disabled={!scenarioName.trim() || !document}
                onClick={() =>
                  capture(() => {
                    if (!cache.saveScenario(reference.id, reference.version, scenarioName, state.current)) {
                      setError(
                        t('Change a control before saving. Save up to six scenarios per version and 20 per host.'),
                      )
                      return
                    }
                    setScenarioName('')
                    setScenarioRevision((n) => n + 1)
                  })
                }
              >
                {t('Save')}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={GHOST_ICON_BUTTON_CLASS}
                aria-label={t('Close saved scenarios')}
                onClick={() => setScenariosOpen(false)}
              >
                <X size={14} />
              </Button>
            </div>
            {!scenarios.length && (
              <p className="mt-2 mb-0 text-caption text-muted-foreground">{t('No saved scenarios yet.')}</p>
            )}
            {scenarios.map((scenario) => (
              <div key={scenario.name} className="mt-1 flex items-center gap-1">
                <span className="mr-auto truncate">{scenario.name}</span>
                <Button
                  variant="ghost"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  onClick={() =>
                    capture(() => {
                      state.current = scenario.state
                      cache.saveState(reference.id, reference.version, scenario.state)
                      restart()
                    })
                  }
                >
                  {t('Restore')}
                </Button>
                <Button
                  variant="ghost"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  aria-label={t('Delete scenario {name}', { name: scenario.name })}
                  onClick={() => {
                    if (cache.removeScenario(reference.id, reference.version, scenario.name))
                      setScenarioRevision((n) => n + 1)
                    else setError(t('Could not save local changes. Storage may be full.'))
                  }}
                >
                  {t('Delete')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {view === 'code' && files.length > 0 ? (
          <div className="flex max-h-[640px] min-h-60">
            <nav aria-label={t('Files')} className="w-44 flex-none overflow-auto border-r border-border p-1">
              {files.map((entry, index) => (
                <Button
                  key={entry.path}
                  variant="ghost"
                  aria-current={file === index ? 'true' : undefined}
                  className={`${GHOST_TEXT_BUTTON_CLASS} w-full justify-start truncate px-2 aria-[current=true]:bg-hover aria-[current=true]:text-foreground`}
                  title={entry.path}
                  onClick={() => setFile(index)}
                >
                  {entry.path}
                </Button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-auto px-3 pt-2">
              {files[file]?.encoding === 'base64' ? (
                <p className="text-muted-foreground">{t('Binary asset · bundled into the document')}</p>
              ) : (
                <ChatCodeBlock source={files[file]?.content ?? ''} hint={files[file]?.path.split('.').pop()} />
              )}
            </div>
          </div>
        ) : (
          <div
            className={`${expanded ? 'min-h-0 flex-1 overflow-auto' : ''} ${width ? 'flex justify-center bg-fill px-3 py-4' : ''}`}
          >
            <div
              className={`relative ${width ? 'max-w-full overflow-hidden rounded-lg bg-(--canvas)' : ''}`}
              style={{ height: live && url ? height : undefined, width }}
            >
              {live && url && (
                <ContentFrame
                  ref={frame}
                  key={url}
                  title={reference.title}
                  onLoad={() => {
                    if (loaded.current === url) {
                      setError(t('Document navigation is unavailable. Reset to reload the saved version.'))
                      setFailed(true)
                    }
                    loaded.current = url
                  }}
                  url={url}
                  ready={ready}
                />
              )}
              {!(live && url && ready) && (
                <InteractivePoster
                  document={document}
                  title={reference.title}
                  height={height}
                  overlay={live && !!url}
                  paused={!!document && (evicted || failed)}
                  onResume={restart}
                />
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="status" className="m-0 border-t border-border px-3 py-2 text-caption text-muted-foreground">
            {error}
            {document ? t(' Saved content is available on this device.') : ''}
          </p>
        )}
      </section>
      {expanded && <div aria-hidden className="fixed inset-0 z-40 bg-black/50" onClick={() => setExpanded(false)} />}
    </>
  )
}

/** Shown while the live document loads, after it stops, or before the bytes arrive. */
function InteractivePoster({
  document,
  title,
  height,
  overlay,
  paused,
  onResume,
}: {
  document: InteractiveDocument | null
  title: string
  height: number
  overlay: boolean
  paused: boolean
  onResume(): void
}) {
  useLanguage()
  return (
    <div
      className={`${overlay ? 'absolute inset-0' : 'relative'} flex items-center justify-center overflow-hidden bg-(--canvas)`}
      style={{ height }}
      aria-busy={!paused}
    >
      {document?.preview ? (
        <img
          src={document.preview}
          alt={t('Preview of {title}', { title })}
          className={`max-h-full max-w-full object-contain ${paused ? 'opacity-60' : 'animate-pulse motion-reduce:animate-none'}`}
        />
      ) : (
        <span className="text-caption text-muted-foreground">{t('Loading…')}</span>
      )}
      {paused && (
        <Button className="absolute" onClick={onResume}>
          {t('Run again')}
        </Button>
      )}
    </div>
  )
}

/** Another version opens in a separate viewer; the historical card is never rewritten. */
function InteractiveContentBrowser({
  reference,
  previous,
  update,
  page,
}: {
  reference: InteractiveReference
  previous?: InteractiveReference
  update?: InteractiveUpdate
  page?: { info: ArtifactInfo | null; elsewhere: boolean }
}) {
  useLanguage()
  const { id: hostId, invoke } = useHost()
  const [versions, setVersions] = useState<InteractiveReference[] | null>(null)
  const [cached, setCached] = useState(false)
  const [selected, setSelected] = useState<InteractiveReference | null>(null)
  const load = () => {
    void invoke('interactive.list', reference.sessionId)
      .then((list) => {
        setVersions(interactiveVersions(reference, list))
        setCached(false)
      })
      .catch(() => {
        setVersions(interactiveVersions(reference, interactiveStorage(hostStorageFor(hostId), 'content').references()))
        setCached(true)
      })
  }
  const items: MenuEntry[] = versions
    ? [
        ...(cached ? [{ key: 'cached', heading: t('Host unavailable. Showing cached versions.') }] : []),
        ...versions.map((version) => ({
          key: String(version.version),
          label: `v${version.version}${version.version === reference.version ? ` · ${t('This turn')}` : ''}`,
          selected: (selected?.version ?? reference.version) === version.version,
          onSelect: () => setSelected(version.version === reference.version ? null : version),
        })),
      ]
    : [{ key: 'loading', label: t('Loading…'), disabled: true }]
  return (
    <div>
      <InteractiveDocumentCard
        key={`${reference.id}:${reference.version}`}
        reference={reference}
        versions={{ load, items }}
        previous={previous}
        update={update}
        page={page}
      />
      {selected && selected.version !== reference.version && (
        <InteractiveDocumentCard
          key={`${selected.id}:${selected.version}`}
          reference={selected}
          copyFrom={reference}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

/** One live card per document: the newest version in full, every older one collapsed to a row in its place. */
export function InteractiveContent({
  reference,
  revision,
  update,
}: {
  reference: InteractiveReference
  revision?: InteractiveRevision
  update?: InteractiveUpdate
}) {
  const { id, invoke } = useHost()
  const index = usePageIndex()
  const info = index.pages.get(reference.id) ?? null
  const replaced = !!revision && revision.latest.version > reference.version
  // A kept page's live card follows the page, so a version another thread published shows here too.
  const [current, setCurrent] = useState<InteractiveReference | null>(null)
  const newer = !replaced && info && info.version > reference.version ? info.version : null
  useEffect(() => {
    if (!newer) return setCurrent(null)
    let cancelled = false
    void invoke('artifacts.document', reference.id, newer)
      .then((document) => !cancelled && setCurrent(document.reference))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [invoke, reference.id, newer])
  if (replaced) return <InteractiveVersionRow reference={reference} revision={revision} />
  const shown = current ?? reference
  const previous = current ? reference : revision?.versions.find((entry) => entry.version < reference.version)
  return (
    <InteractiveContentBrowser
      key={`${id}:${shown.sessionId}:${shown.id}:${shown.version}`}
      reference={shown}
      previous={previous}
      update={update}
      page={index.loaded || info ? { info, elsewhere: !!current } : undefined}
    />
  )
}
