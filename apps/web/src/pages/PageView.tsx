import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
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
  designTokensOf,
  editableSource,
  type ArtifactInfo,
  type ArtifactRun,
  type ArtifactVersion,
} from '@ramu/shared/artifacts'
import { interactiveExport, slideCount } from '@ramu/shared/interactiveExport'
import { dashboardTimeColumn, type Slide } from '@ramu/shared/artifactSource'
import { Button } from '../components/desktop-button'
import { Input } from '../components/desktop-input'
import { Textarea } from '@/components/ui/textarea'
import { GHOST_ICON_BUTTON_CLASS, GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { Dialog, Dropdown, Menu, type MenuEntry } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { notifyError } from '../chat/Notifications'
import { StepSlider } from '@/components/step-slider'
import { openPluginSettings } from '../settings/openPluginSettings'
import { joinedText, LiveTextEditor, syncLiveText } from '@ramu/shared/liveText'
import { deckText, slideWords } from '@ramu/shared/deckText'
import { changedAt, headingAt } from '@ramu/shared/editingPart'
import { useViewOnly } from '../composer/useViewOnly'
import { ContentFrame } from '../interactive/ContentFrame'
import { useContentDocument } from '../interactive/useContentDocument'
import { appThemeVariables } from '../interactive/appTheme'
import { usePageBridge, type PickedElement } from './usePageBridge'
import { GrantSheet, PageSettings, runStatusLabel } from './PageSettings'
import { openPage } from './openPage'
import { PublishDialog } from './PublishDialog'
import { MakeProjectDialog } from './MakeProjectDialog'
import { ArtifactKindMark, hostExportEntries, kindExportEntries } from './ArtifactKindMark'
import { SlideToolbar, useSlideControls } from './SlideControls'
import { MotionToolbar } from './MotionControls'
import { DocOutline, docOutline } from './DocOutline'
import { DocRichEditor, richTextFits } from './DocRichEditor'
import { designTexts } from '@ramu/shared/designText'
import { mermaidLabels, withMermaidLabels } from '@ramu/shared/mermaidLabels'

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
const RANGE_CHOICES = [null, 7, 30, 90, 365] as const
const rangeLabel = (days: (typeof RANGE_CHOICES)[number]) =>
  days === null ? t('All time') : days === 365 ? t('Last year') : t('Last {count} days', { count: days })
const REFRESH_CHOICES = [5, 15, 60, 360, 1440]
const refreshLabel = (minutes: number) =>
  ({
    5: t('Every 5 minutes'),
    15: t('Every 15 minutes'),
    60: t('Every hour'),
    360: t('Every 6 hours'),
    1440: t('Once a day'),
  })[minutes] ?? t('Every {count} minutes', { count: minutes })

/** Moves an open edit's base forward to the version the live copy was saved as; never back. */
function setBase<T extends { base: number }>(edit: (change: (current: T | null) => T | null) => void, version: number) {
  edit((current) => (current && current.base < version ? { ...current, base: version } : current))
}

export function PageView({ artifactId, onBack }: { artifactId: string; onBack(): void }) {
  useLanguage()
  const { invoke, id: host } = useHost()
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
  const [editing, setEditing] = useState<{ base: number; text: string; rich?: boolean } | null>(null)
  const editForm = useRef<HTMLFormElement>(null)
  // A flowchart's labels while the person changes its words without its Mermaid syntax.
  const [editingLabels, setEditingLabels] = useState<{ base: number; source: string; labels: string[] } | null>(null)
  const labelEditing = useRef(editingLabels)
  const labelInputs = useRef<(HTMLInputElement | null)[]>([])
  // A deck's slide text while the person edits it, slide by slide, and the version it started from.
  const [editingDesign, setEditingDesign] = useState<{
    base: number
    frames: { name: string; texts: string[] }[]
  } | null>(null)
  const [editingSlides, setEditingSlides] = useState<{ base: number; slides: (Slide & { from: number })[] } | null>(
    null,
  )
  // A text editor takes the page's place, so the deck cannot be presented or turned until it closes.
  const stageHidden = !!editing || !!editingSlides || !!editingDesign
  const [savingEdit, setSavingEdit] = useState(false)
  // A motion's music and scene sound levels while the person changes them; null marks one removed.
  const [sounding, setSounding] = useState<{ base: number; music: number | null; sounds: (number | null)[] } | null>(
    null,
  )
  // A motion's narration lines while the person edits them, one per scene.
  const [narrating, setNarrating] = useState<{ base: number; lines: string[] } | null>(null)
  /**
   * One exchange with the host's live copy. The copy names the version it was last saved as (after a quiet minute, or
   * a merge with an agent's version), and the edit's Save builds on that one so the person's own typing is not a
   * conflict.
   */
  const liveSync = useCallback(
    async (update: string | null, stateVector: string, onVersion: (version: number) => void) => {
      const reply = await Promise.resolve(invoke('artifacts.liveSync', artifactId, update, stateVector))
      if (reply.version !== undefined) onVersion(reply.version)
      return reply
    },
    [invoke, artifactId],
  )
  /** Cancel: typing the host's live copy holds and no Save kept is not saved a minute later. */
  const discardLive = () => void Promise.resolve(invoke('artifacts.liveDiscard', artifactId)).catch(() => {})
  // Live typing on a deck's words, while its slides keep their order; moving a slide pauses it until Save.
  const slidesNow = useRef(editingSlides)
  slidesNow.current = editingSlides
  const editingDeck = !!editingSlides
  useEffect(() => {
    if (!editingDeck) return
    let stopped = false
    let editor: LiveTextEditor | null = null
    let busy = false
    const withWords = (text: string) =>
      setEditingSlides((current) => {
        if (!current) return current
        const words = slideWords(text, current.slides.length)
        return words
          ? { ...current, slides: current.slides.map((slide, index) => ({ ...slide, ...words[index] })) }
          : current
      })
    const inOrder = (current: NonNullable<typeof editingSlides>) =>
      current.slides.every((slide, index) => slide.from === index)
    const opened = slidesNow.current ? deckText(slidesNow.current.slides) : ''
    void invoke('artifacts.liveJoin', artifactId).then(
      (joined) => {
        if (stopped) return
        editor = new LiveTextEditor(joined.state)
        const current = slidesNow.current
        withWords(joinedText(opened, editor.text, current && inOrder(current) ? deckText(current.slides) : opened))
        setBase(setEditingSlides, joined.version)
      },
      () => {},
    )
    const timer = window.setInterval(() => {
      if (!editor || busy) return
      busy = true
      void syncLiveText(
        editor,
        () => {
          const current = slidesNow.current
          return current && inOrder(current) ? deckText(current.slides) : null
        },
        (update, stateVector) => liveSync(update, stateVector, (version) => setBase(setEditingSlides, version)),
      )
        .then((merged) => {
          if (merged !== null && !stopped) withWords(merged)
        })
        .catch(() => {})
        .finally(() => {
          busy = false
        })
    }, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [editingDeck, invoke, artifactId, liveSync])
  // Plugin data sources this dashboard reads, the ones the person allowed it to, and those installed plugins provide.
  const [services, setServices] = useState<{ needed: string[]; allowed: string[] } | null>(null)
  const [dataSources, setDataSources] = useState<{ id: string; label: string }[] | null>(null)
  const dashboardVersion = page?.kind === 'dashboard' ? page.version : null
  useEffect(() => {
    if (dashboardVersion === null) return
    let live = true
    void invoke('artifacts.services', artifactId).then(
      (next) => live && setServices(next),
      () => {},
    )
    void invoke('plugins.dataSources').then(
      (next) => live && setDataSources(next),
      () => live && setDataSources([]),
    )
    return () => {
      live = false
    }
  }, [dashboardVersion, invoke, artifactId])
  const sourceName = (id: string) => dataSources?.find((source) => source.id === id)?.label ?? id
  // Until the installed data sources are known, nothing is reported missing.
  const uninstalled =
    services && dataSources
      ? services.needed.filter((service) => !dataSources.some((source) => source.id === service))
      : []
  const unallowed = services
    ? services.needed.filter((service) => !services.allowed.includes(service) && !uninstalled.includes(service))
    : []
  // The person's other devices editing this text too; saving merges edits that changed different lines.
  const [alsoEditing, setAlsoEditing] = useState<string[]>([])
  const editingText = !!editing
  // Where this device last typed (a heading, or a slide), sent with its presence so others see the part it is on.
  const partNow = useRef<string | null>(null)
  const editingAny = editingText || editingDeck
  useEffect(() => {
    if (!editingAny) return
    let live = true
    partNow.current = null
    const mark = () =>
      void invoke('artifacts.editing', artifactId, true, partNow.current).then(
        (others) => live && setAlsoEditing(others),
        () => {},
      )
    mark()
    const timer = window.setInterval(mark, 5000)
    return () => {
      live = false
      window.clearInterval(timer)
      setAlsoEditing([])
      void Promise.resolve(invoke('artifacts.editing', artifactId, false)).catch(() => {})
    }
  }, [editingAny, invoke, artifactId])
  // Live typing: the text box is synced with the host's shared copy about once a second, so others' words appear
  // as they type them; a version is saved by the host once nobody types for a minute, or by Save.
  const motionHasSound = useMemo(() => {
    const stored = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.motion)?.content
    if (!stored) return false
    const motion = JSON.parse(stored) as { scenes: { sound?: unknown }[]; music?: unknown }
    return !!motion.music || motion.scenes.some((scene) => scene.sound)
  }, [document])
  const editingNow = useRef(editing)
  editingNow.current = editing
  /** Text the person typed (not merged in from others), noting the heading above the change. */
  const typed = (text: string) => {
    const previous = editingNow.current?.text
    if (previous !== undefined && previous !== text) partNow.current = headingAt(text, changedAt(previous, text) ?? 0)
    setEditing((current) => (current ? { ...current, text } : current))
  }
  useEffect(() => {
    if (!editingText) return
    let stopped = false
    let editor: LiveTextEditor | null = null
    let busy = false
    const opened = editingNow.current?.text ?? ''
    void invoke('artifacts.liveJoin', artifactId).then(
      (joined) => {
        if (stopped) return
        editor = new LiveTextEditor(joined.state)
        // The shared copy may hold others' typing not saved yet; it joins what was typed while the join was on its way.
        const fromHost = editor.text
        setEditing((current) =>
          current ? { ...current, text: joinedText(opened, fromHost, current.text), base: joined.version } : current,
        )
      },
      () => {},
    )
    const timer = window.setInterval(() => {
      if (!editor || busy) return
      busy = true
      void syncLiveText(
        editor,
        () => editingNow.current?.text ?? null,
        (update, stateVector) => liveSync(update, stateVector, (version) => setBase(setEditing, version)),
      )
        .then((merged) => {
          if (merged !== null && !stopped) setEditing((current) => (current ? { ...current, text: merged } : current))
        })
        .catch(() => {})
        .finally(() => {
          busy = false
        })
    }, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [editingText, invoke, artifactId, liveSync])
  // Which design this host draws new visual artifacts with, for a design's menu.
  const [designSystem, setDesignSystem] = useState<string | null>(null)
  const projectId = page?.projectId ?? null
  useEffect(() => {
    void invoke('artifacts.designSystem', projectId).then(setDesignSystem, () => {})
  }, [invoke, projectId])
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
  // A doc with more than one heading offers its outline to jump through.
  const outline = page?.kind === 'doc' && document ? docOutline(document.html) : []
  // A dashboard with live tables offers its refresh rule; the default read interval is five minutes.
  const dashboardSource = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.dashboard)?.content
  const dashboardBoard = dashboardSource
    ? (JSON.parse(dashboardSource) as {
        datasets: (Parameters<typeof dashboardTimeColumn>[0] & { file?: string; records?: object; mcp?: object })[]
        refreshMinutes?: number
        rangeDays?: number
      })
    : null
  // A dashboard with dated rows, or a file whose rows are read later, can be cut to a recent range.
  const ranged = !!dashboardBoard?.datasets.some(
    (table) => table.file || table.records || table.mcp || dashboardTimeColumn(table) >= 0,
  )
  const liveRefresh = dashboardBoard?.datasets.some((table) => table.source || table.file || table.records || table.mcp)
    ? (dashboardBoard.refreshMinutes ?? 5)
    : null
  // A motion's length, from the scenes its version keeps, for the toolbar's scrub bar.
  const motionSource = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.motion)?.content
  const motionSeconds = motionSource
    ? (JSON.parse(motionSource) as { scenes: { seconds: number }[] }).scenes.reduce(
        (total, scene) => total + scene.seconds,
        0,
      )
    : 0
  const instance = `page:${artifactId}:${document?.reference.version ?? 0}:${generation}`
  const { url } = useContentDocument(document?.html, instance, !!document, state, document?.reference.network)
  const slides = document ? slideCount(document) : 0
  // Each slide's title and notes for the presenter window, from the deck's source.
  const deckSource = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.slides)?.content
  const slideAt = useMemo(() => {
    if (!deckSource) return undefined
    const deck = (JSON.parse(deckSource) as { slides: Slide[] }).slides
    const titled = (slide: Slide | undefined) => slide?.title || slide?.body?.split('\n')[0] || ''
    return (index: number) => ({
      title: titled(deck[index]),
      notes: deck[index]?.notes ?? '',
      next: deck[index + 1] ? titled(deck[index + 1]) : null,
    })
  }, [deckSource])
  const slideControls = useSlideControls(frame, stage, instance, slides, slideAt)
  // While this deck is presented here, a phone turning its slides turns them here too.
  const { presenting, show: showSlide } = slideControls
  useEffect(
    () =>
      on('artifacts:slide', (payload) => {
        if (presenting && payload.artifactId === artifactId) showSlide(payload.index, true)
      }),
    [on, presenting, artifactId, showSlide],
  )
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
      // While labels are edited, a word clicked on the drawing focuses its field, and the next click works too.
      if (labelEditing.current) {
        const clicked = element.text.replace(/\s+/g, ' ').trim()
        const at = labelEditing.current.labels.findIndex((label) => label.replace(/\s+/g, ' ').trim() === clicked)
        if (at >= 0) labelInputs.current[at]?.focus()
        bridge.pick(true)
        return
      }
      setPicking(false)
      setPicked(element)
    },
    onError: setFrameError,
    onStartThread: (prompt) => askThread(prompt, t('The artifact asks to start a thread')),
  })
  bridgeRestore.current = bridge.restore
  // Editing labels keeps the drawing in view in pick mode, so a word on it can be clicked to edit.
  useEffect(() => {
    labelEditing.current = editingLabels
  }, [editingLabels])
  const labelsOpen = !!editingLabels
  const pickLatest = useRef(bridge.pick)
  useEffect(() => {
    pickLatest.current = bridge.pick
  })
  useEffect(() => {
    if (!labelsOpen || !ready) return
    pickLatest.current(true)
    return () => pickLatest.current(false)
  }, [labelsOpen, ready])
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
    { key: 'settings', label: t('Artifact settings…'), onSelect: () => setDialog({ kind: 'settings' }) },
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
          .then((copy) => openPage(copy.id, host))
          .catch((e) => notifyError(message(e))),
    },
    ...(page.kind === 'design' && document && designTokensOf(document)
      ? [
          {
            key: 'design-system',
            label: designSystem === artifactId ? t('Stop using as design system') : t('Use as design system'),
            disabled: viewOnly,
            onSelect: () => {
              const next = designSystem === artifactId ? null : artifactId
              // A design kept in a project becomes that project's design system; otherwise the host's.
              void invoke('artifacts.setDesignSystem', next, page.projectId)
                .then(() => setDesignSystem(next))
                .catch((e) => notifyError(message(e)))
            },
          },
        ]
      : []),
    ...((page.kind === 'slides' || page.kind === 'dashboard' || page.kind === 'design') &&
    designSystem &&
    designSystem !== artifactId
      ? [
          {
            key: 'restyle',
            label: t('Restyle with the design system'),
            disabled: viewOnly || !document,
            onSelect: () => {
              if (!document) return
              void invoke('artifacts.restyle', artifactId, document.reference.version)
                .then(() => load())
                .catch((e) => notifyError(message(e)))
            },
          },
        ]
      : []),
    ...(services?.allowed ?? []).map((service) => ({
      key: `service:${service}`,
      label: t('Stop reading {0}', { 0: sourceName(service) }),
      disabled: viewOnly,
      onSelect: () =>
        void invoke('artifacts.allowService', artifactId, service, false)
          .then((next) => {
            setServices(next)
            void load()
          })
          .catch((e) => notifyError(message(e))),
    })),
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
          {slides > 0 && <SlideToolbar controls={slideControls} count={slides} disabled={!ready || stageHidden} />}
          {outline.length > 1 && <DocOutline frame={frame} instance={instance} headings={outline} disabled={!ready} />}
          {motionSeconds > 0 && (
            <MotionToolbar frame={frame} instance={instance} seconds={motionSeconds} disabled={!ready} />
          )}
          {page.kind === 'dashboard' && liveRefresh !== null && (
            <Dropdown
              label={t('Refresh')}
              value={String(liveRefresh)}
              disabled={viewOnly || !document}
              options={REFRESH_CHOICES.map((minutes) => ({ value: String(minutes), label: refreshLabel(minutes) }))}
              onChange={(next) => {
                if (!document) return
                void invoke('artifacts.setRefresh', artifactId, document.reference.version, Number(next))
                  .then(() => load())
                  .catch((error) => notifyError(message(error), page.title))
              }}
            />
          )}
          {page.kind === 'dashboard' && ranged && (
            <Dropdown
              label={t('Range')}
              value={String(dashboardBoard?.rangeDays ?? '')}
              disabled={viewOnly || !document}
              options={RANGE_CHOICES.map((days) => ({ value: String(days ?? ''), label: rangeLabel(days) }))}
              onChange={(next) => {
                if (!document) return
                void invoke('artifacts.setRange', artifactId, document.reference.version, next ? Number(next) : null)
                  .then(() => load())
                  .catch((error) => notifyError(message(error), page.title))
              }}
            />
          )}
          {page.kind === 'design' && !editingDesign && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={viewOnly || !document}
              title={t('Change the words yourself; the agent keeps your edit when it revises')}
              onClick={() => {
                const stored = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.design)?.content
                if (document && stored)
                  setEditingDesign({
                    base: document.reference.version,
                    frames: (JSON.parse(stored) as { frames: { name: string; html: string }[] }).frames.map(
                      (frame) => ({ name: frame.name, texts: designTexts(frame.html) }),
                    ),
                  })
              }}
            >
              <PenLine size={13} /> {t('Edit text')}
            </Button>
          )}
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
                    slides: (JSON.parse(stored) as { slides: Slide[] }).slides.map((slide, from) => ({
                      ...slide,
                      from,
                    })),
                  })
              }}
            >
              <PenLine size={13} /> {t('Edit text')}
            </Button>
          )}
          {page.kind === 'motion' && !sounding && motionHasSound && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={viewOnly || !document}
              title={t('How loud the music and scene sounds play in the exported video')}
              onClick={() => {
                const stored = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.motion)?.content
                if (!document || !stored) return
                const motion = JSON.parse(stored) as {
                  scenes: { sound?: { volume?: number } }[]
                  music?: { volume?: number }
                }
                setSounding({
                  base: document.reference.version,
                  music: motion.music ? (motion.music.volume ?? 0.25) : null,
                  sounds: motion.scenes.map((scene) => (scene.sound ? (scene.sound.volume ?? 0.8) : null)),
                })
              }}
            >
              <PenLine size={13} /> {t('Sound')}
            </Button>
          )}
          {page.kind === 'motion' && !narrating && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              disabled={viewOnly || !document}
              title={t('Words spoken over each scene in the exported video, read aloud on this computer')}
              onClick={() => {
                const stored = document?.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.motion)?.content
                if (document && stored)
                  setNarrating({
                    base: document.reference.version,
                    lines: (JSON.parse(stored) as { scenes: { narration?: string }[] }).scenes.map(
                      (scene) => scene.narration ?? '',
                    ),
                  })
              }}
            >
              <PenLine size={13} /> {t('Narration')}
            </Button>
          )}
          {page.kind === 'diagram' &&
            !editingLabels &&
            !editing &&
            document &&
            mermaidLabels(editableSource(document) ?? '').length > 0 && (
              <Button
                variant="ghost"
                className={GHOST_TEXT_BUTTON_CLASS}
                disabled={viewOnly}
                title={t('Change the words on the diagram without its Mermaid source')}
                onClick={() => {
                  const source = editableSource(document) ?? ''
                  setEditingLabels({ base: document.reference.version, source, labels: mermaidLabels(source) })
                }}
              >
                <PenLine size={13} /> {t('Edit labels')}
              </Button>
            )}
          {(page.kind === 'doc' || page.kind === 'diagram') &&
            !editing &&
            !editingLabels &&
            document &&
            editableSource(document) !== null && (
              <Button
                variant="ghost"
                className={GHOST_TEXT_BUTTON_CLASS}
                disabled={viewOnly || !document}
                title={t('Change the words yourself; the agent keeps your edit when it revises')}
                onClick={() => {
                  const text = editableSource(document)
                  if (text !== null)
                    setEditing({
                      base: document.reference.version,
                      text,
                      rich: page.kind === 'doc' && richTextFits(text),
                    })
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
            title={t('Point at something in the artifact and say what to change')}
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
            onClick={() => setDialog({ kind: 'thread', prompt: '', title: t('Ask about this artifact') })}
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
            label={t('Artifact actions')}
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
            {t('This artifact hit an error: {message}', { message: page.lastError.message })}
          </span>
          {!viewOnly && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              onClick={() => {
                const error = page.lastError!
                void startThread(
                  `Fix this error in my artifact. Reproduce it with artifact_preview, then publish the fixed version with artifact_publish {artifact: "${page.id}", changes}.\nError on ${error.device ?? 'a device'} in v${error.version}: ${error.message}${error.steps?.length ? `\nWhat the person did before it: ${error.steps.join(' → ')}` : ''}`,
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
            {t('The live site shows v{live}; this artifact is at v{version}.', {
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
      {uninstalled.length > 0 && (
        <div role="status" className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-caption">
          <span className="min-w-0 flex-1 text-muted-foreground">
            {t(
              'This dashboard reads {0}, which no installed plugin provides. Its tables stay empty until you install one.',
              {
                0: uninstalled.join(', '),
              },
            )}
          </span>
          {!viewOnly && (
            <Button size="sm" variant="secondary" onClick={() => openPluginSettings(host)}>
              {t('Open plugin settings')}
            </Button>
          )}
        </div>
      )}
      {unallowed.length > 0 && (
        <div role="status" className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-caption">
          <span className="min-w-0 flex-1 text-muted-foreground">
            {t(
              'This dashboard reads {0} with the credential saved for its plugin in Settings → Plugins. Its tables stay empty until you allow it.',
              { 0: unallowed.map(sourceName).join(', ') },
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void Promise.all(unallowed.map((service) => invoke('artifacts.allowService', artifactId, service, true)))
                .then((results) => {
                  setServices(results.at(-1) ?? null)
                  void load()
                })
                .catch((error) => notifyError(message(error), page.title))
            }
          >
            {t('Allow')}
          </Button>
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
              `${input}\nChange only this element of the artifact (the person pointed at it): ${picked.selector}\nIts text: ${JSON.stringify(picked.text)}\nIts HTML: ${picked.html}`,
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
            placeholder={t('Ask this artifact, such as “how much on food in March?”')}
            aria-label={t('Ask this artifact')}
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
          ref={editForm}
          aria-label={t('Edit text')}
          className="flex min-h-0 flex-1 flex-col gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            invoke('artifacts.editSource', artifactId, editing.base, editing.text)
              .then(() => {
                setEditing(null)
                void load()
              })
              // A newer version or a problem in the text keeps the edit open, so nothing typed is lost.
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          {alsoEditing.length > 0 && (
            <p role="status" className="m-0 text-caption text-muted-foreground">
              {t('Also being edited on {0}. Saving keeps both edits where they changed different lines.', {
                0: alsoEditing.join(', '),
              })}
            </p>
          )}
          {editing.rich ? (
            <DocRichEditor
              artifactId={artifactId}
              text={editing.text}
              files={document?.files ?? []}
              onChange={typed}
              onSave={() => editForm.current?.requestSubmit()}
            />
          ) : (
            <Textarea
              aria-label={t('Markdown')}
              className="min-h-0 flex-1 resize-none font-mono text-control"
              value={editing.text}
              onChange={(event) => typed(event.target.value)}
            />
          )}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-caption text-muted-foreground">
              {t('Saving makes v{version}, marked Edited by you.', { version: editing.base + 1 })}
            </span>
            {page.kind === 'doc' && (
              <Button
                type="button"
                variant="ghost"
                disabled={savingEdit || (!editing.rich && !richTextFits(editing.text))}
                title={
                  !editing.rich && !richTextFits(editing.text)
                    ? t('This doc has footnotes or HTML, which only Markdown keeps.')
                    : undefined
                }
                onClick={() => setEditing({ ...editing, rich: !editing.rich })}
              >
                {editing.rich ? t('Edit Markdown') : t('Edit as rich text')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={savingEdit}
              onClick={() => {
                setEditing(null)
                discardLive()
              }}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      {sounding && (
        <form
          aria-label={t('Sound')}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            invoke('artifacts.editSound', artifactId, sounding.base, { music: sounding.music, sounds: sounding.sounds })
              .then(() => {
                setSounding(null)
                void load()
              })
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          {[{ key: -1, level: sounding.music }, ...sounding.sounds.map((level, key) => ({ key, level }))]
            .filter((entry) => entry.level !== null)
            .map(({ key, level }) => (
              <label key={key} className="flex items-center gap-3 text-caption">
                <span className="w-24 flex-none text-muted-foreground">
                  {key < 0 ? t('Music') : t('Scene {number}', { number: key + 1 })}
                </span>
                <StepSlider
                  className="flex-1"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round((level ?? 0) * 100)}
                  thumbLabel={key < 0 ? t('Music') : t('Scene {number}', { number: key + 1 })}
                  valueText={`${Math.round((level ?? 0) * 100)}%`}
                  onValueChange={(next) => {
                    const value = (next as number) / 100
                    setSounding(
                      key < 0
                        ? { ...sounding, music: value }
                        : { ...sounding, sounds: sounding.sounds.map((entry, at) => (at === key ? value : entry)) },
                    )
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  onClick={() =>
                    setSounding(
                      key < 0
                        ? { ...sounding, music: null }
                        : { ...sounding, sounds: sounding.sounds.map((entry, at) => (at === key ? null : entry)) },
                    )
                  }
                >
                  {t('Remove')}
                </Button>
              </label>
            ))}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSounding(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      {narrating && (
        <form
          aria-label={t('Narration')}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            invoke('artifacts.editNarration', artifactId, narrating.base, narrating.lines)
              .then(() => {
                setNarrating(null)
                void load()
              })
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          <p className="m-0 text-caption text-muted-foreground">
            {t(
              'Each scene’s words are spoken on this computer when the video is exported, starting with the scene and cut at its end. Leave a scene empty for no narration.',
            )}
          </p>
          {narrating.lines.map((line, index) => (
            <label key={index} className="flex flex-col gap-1 text-caption">
              <span className="flex items-center gap-2">
                <strong className="flex-1 text-muted-foreground">{t('Scene {number}', { number: index + 1 })}</strong>
                <Button
                  type="button"
                  variant="ghost"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  disabled={!line.trim()}
                  onClick={() =>
                    void Promise.resolve(invoke('artifacts.narrationPreview', line))
                      .then((url) => void new Audio(url).play())
                      .catch((error) => notifyError(message(error), page.title))
                  }
                >
                  {t('Listen')}
                </Button>
              </span>
              <Textarea
                value={line}
                maxLength={600}
                rows={2}
                onChange={(event) =>
                  setNarrating({
                    ...narrating,
                    lines: narrating.lines.map((entry, at) => (at === index ? event.target.value : entry)),
                  })
                }
              />
            </label>
          ))}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNarrating({ ...narrating, lines: narrating.lines.map(() => '') })}
            >
              {t('Remove narration')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setNarrating(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={savingEdit}>
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
            const edits = editingSlides.slides.map(({ from, title, body, columns, by, notes }) => ({
              from,
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
            {alsoEditing.length > 0 && (
              <p role="status" className="m-0 text-caption text-muted-foreground">
                {t('Also being edited on {0}. Saving keeps both edits where they changed different lines.', {
                  0: alsoEditing.join(', '),
                })}
              </p>
            )}
            {editingSlides.slides.map((slide, index) => {
              const move = (by: number) => {
                const slides = [...editingSlides.slides]
                const [moved] = slides.splice(index, 1)
                slides.splice(index + by, 0, moved!)
                setEditingSlides({ ...editingSlides, slides })
              }
              const change = (patch: Partial<Slide>) => {
                partNow.current = t('Slide {number}', { number: index + 1 })
                setEditingSlides({
                  ...editingSlides,
                  slides: editingSlides.slides.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
                })
              }
              return (
                <li key={slide.from} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <strong className="flex-1 text-caption text-muted-foreground">
                      {t('Slide {number}', { number: index + 1 })}
                    </strong>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={GHOST_ICON_BUTTON_CLASS}
                      aria-label={t('Move slide {number} up', { number: index + 1 })}
                      disabled={index === 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUp size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={GHOST_ICON_BUTTON_CLASS}
                      aria-label={t('Move slide {number} down', { number: index + 1 })}
                      disabled={index === editingSlides.slides.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDown size={13} />
                    </Button>
                  </div>
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
            <Button
              type="button"
              variant="ghost"
              disabled={savingEdit}
              onClick={() => {
                setEditingSlides(null)
                discardLive()
              }}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      {editingLabels && (
        <form
          aria-label={t('Edit labels')}
          className="flex max-h-[45%] min-h-0 flex-col gap-2 border-t border-(--line) p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            Promise.resolve()
              .then(() => withMermaidLabels(editingLabels.source, editingLabels.labels))
              .then((source) => invoke('artifacts.editSource', artifactId, editingLabels.base, source))
              .then(() => {
                setEditingLabels(null)
                void load()
              })
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          <ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-auto p-0">
            {editingLabels.labels.map((label, index) => (
              <li key={index}>
                <Input
                  ref={(input) => {
                    labelInputs.current[index] = input
                  }}
                  aria-label={t('Label {number}', { number: index + 1 })}
                  value={label}
                  onChange={(event) =>
                    setEditingLabels({
                      ...editingLabels,
                      labels: editingLabels.labels.map((old, at) => (at === index ? event.target.value : old)),
                    })
                  }
                />
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-caption text-muted-foreground">
              {t('Saving makes v{version}, marked Edited by you.', { version: editingLabels.base + 1 })}
            </span>
            <Button type="button" variant="ghost" disabled={savingEdit} onClick={() => setEditingLabels(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      {editingDesign && (
        <form
          aria-label={t('Edit text')}
          className="flex min-h-0 flex-1 flex-col gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSavingEdit(true)
            invoke(
              'artifacts.editDesign',
              artifactId,
              editingDesign.base,
              editingDesign.frames.map((frame) => frame.texts),
            )
              .then(() => {
                setEditingDesign(null)
                void load()
              })
              .catch((error) => notifyError(message(error), page.title))
              .finally(() => setSavingEdit(false))
          }}
        >
          <ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-4 overflow-auto p-0">
            {editingDesign.frames.map((frame, index) => (
              <li key={index} className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-muted-foreground">{frame.name}</span>
                {frame.texts.length ? (
                  frame.texts.map((text, at) => {
                    const change = (value: string) =>
                      setEditingDesign({
                        ...editingDesign,
                        frames: editingDesign.frames.map((entry, which) =>
                          which === index
                            ? { ...entry, texts: entry.texts.map((old, spot) => (spot === at ? value : old)) }
                            : entry,
                        ),
                      })
                    const label = t('Text {number} of {frame}', { number: at + 1, frame: frame.name })
                    return text.length > 80 ? (
                      <Textarea
                        key={at}
                        aria-label={label}
                        value={text}
                        onChange={(event) => change(event.target.value)}
                      />
                    ) : (
                      <Input
                        key={at}
                        aria-label={label}
                        value={text}
                        onChange={(event) => change(event.target.value)}
                      />
                    )
                  })
                ) : (
                  <span className="text-caption text-muted-foreground">{t('No text in this frame.')}</span>
                )}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-caption text-muted-foreground">
              {t('Saving makes v{version}, marked Edited by you.', { version: editingDesign.base + 1 })}
            </span>
            <Button type="button" variant="ghost" disabled={savingEdit} onClick={() => setEditingDesign(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={savingEdit}>
              {t('Save')}
            </Button>
          </div>
        </form>
      )}
      <div
        hidden={stageHidden}
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
        <MakeProjectDialog page={page} onClose={() => setDialog(null)} onExported={setStatus} />
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
                `Add a panel to my artifact that always shows the answer to "${question}" from its records (today it is: ${value.text ?? ''}). Compute it with ramuContent.records, not a model call, and publish the new version.`,
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
      <p>{t('A new thread starts with this artifact attached. It works with its usual access and approvals.')}</p>
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
