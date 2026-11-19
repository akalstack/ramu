import { joinedText, LiveTextEditor, syncLiveText } from '@ramu/shared/liveText'
import { deckText, slideWords } from '@ramu/shared/deckText'
import { caretAfter, changedAt, headingAt } from '@ramu/shared/editingPart'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react'
import { Alert, Image, PanResponder, Pressable, Share, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react-native'
import type { Slide } from '@ramu/shared/artifactSource'
import { designTexts } from '@ramu/shared/designText'
import { mermaidLabels, withMermaidLabels } from '@ramu/shared/mermaidLabels'
import { docBlocks, withDocBlocks, type DocBlock } from '@ramu/shared/docBlocks'
import { inlineRuns } from '@ramu/shared/inlineMarks'
import {
  interactiveHtml,
  readInteractiveState,
  type InteractiveDocument,
  type InteractiveState,
} from '@ramu/shared/interactive'
import { interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import {
  ARTIFACT_SOURCE_FILES,
  artifactLink,
  editableSource,
  declaredCapabilities,
  type ArtifactInfo,
  type ArtifactRun,
  type ArtifactVersion,
} from '@ramu/shared/artifacts'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { useSay } from '../../../i18n'
import { contentStorage } from '../../../storage'
import { Header, HeaderButton, Screen } from '../../../components/Screen'
import { Button, Card, IconButton, Row, SHEET_SETTLE_MS, Sheet, SheetScrollView, T } from '../../../components/ui'
import InteractiveFrame from '../../../components/InteractiveFrame'
import { ArtifactSettings } from '../../../components/ArtifactSettings'
import { MakeProjectSheet } from '../../../components/MakeProjectSheet'
import MotionVideo from '../../../components/MotionVideo'
import { hostShareLabel, SHARE_LABELS } from '../../../components/ArtifactKindMark'
import { shareFile } from '../../../components/interactiveShare'
import { hostExportFormats, kindExports, slideCount } from '@ramu/shared/interactiveExport'
import { pageRunActivity } from '../../../runtime/pageRunActivity'
import { WIDGET_PAGE_KEY, widgetPage } from '../../../components/PageWidgetSync'
import {
  QUEUEABLE,
  pageCopy,
  queueCall,
  queuedCalls,
  savePageCopy,
  syncCalls,
  type QueuedCall,
} from '../../../runtime/artifacts'

type FrameMessage = { ramuInteractive?: number; instance?: string; type?: string; value?: unknown; requestId?: string }
/** A share link this screen opened: whether it adds records, and the person it lets edit the text, by name. */
type Shared = { token: string; canAdd: boolean; editor?: string }

const reason = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error)
/** A failure that means the host was not reached, so the call can wait; anything else is the host's answer. */
const unreachable = (error: unknown) =>
  /offline|not connected|unreachable|timed out|network|socket/i.test(reason(error))

/**
 * One page, full screen: the same frame and bridge as the desktop, loaded from the host by id so it works without its
 * thread. Records added without a connection wait on the phone and sync when the host answers.
 */
/**
 * An open edit built on the version the host's live copy was last saved as (after a quiet minute, or a merge with an
 * agent's version), so Save does not take the person's own typing for someone else's. Never moves back.
 */
function movedBase<T extends { base: number }>(current: T | null, version: number): T | null {
  return current && current.base < version ? { ...current, base: version } : current
}

type Caret = { start: number; end: number }

/**
 * One formatted block's text box. Others' typing merged into the block moves the caret only when it lands before it:
 * left alone, iOS keeps the caret's distance from the end, so it jumped whenever someone typed later in the block.
 */
function BlockInput({
  text,
  onChangeText,
  ...props
}: Omit<ComponentProps<typeof TextInput>, 'value' | 'selection' | 'onChangeText'> & {
  text: string
  onChangeText: (text: string) => void
}) {
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  // What this box last typed, so only text from elsewhere moves the caret; and where the caret is while focused.
  const sent = useRef(text)
  const caret = useRef<Caret | null>(null)
  const [shown, setShown] = useState(text)
  const [moveTo, setMoveTo] = useState<Caret | null>(null)
  if (text !== shown) {
    setShown(text)
    const at = caret.current
    if (text !== sent.current && at)
      setMoveTo({ start: caretAfter(shown, text, at.start), end: caretAfter(shown, text, at.end) })
  }
  // Placed a frame after the merged text lands: iOS applies the new text after any selection sent with it, and moving
  // the caret again for that text would undo the placement.
  useEffect(() => {
    if (!moveTo) return
    const frame = requestAnimationFrame(() => {
      input.current?.setSelection(moveTo.start, moveTo.end)
      caret.current = moveTo
      setMoveTo(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [moveTo])
  return (
    <TextInput
      {...props}
      ref={input}
      onSelectionChange={(event) => {
        caret.current = event.nativeEvent.selection
      }}
      onBlur={() => {
        caret.current = null
      }}
      onChangeText={(next) => {
        sent.current = next
        onChangeText(next)
      }}
    />
  )
}

export default function PageScreen() {
  const params = useLocalSearchParams<{ computer: string; id: string; share?: string }>()
  const computerId = String(params.computer ?? '')
  const artifactId = String(params.id ?? '')
  const shareToken = params.share ? String(params.share) : undefined
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  const { c, scheme } = useTheme()
  const { height: screenHeight } = useWindowDimensions()
  const online = store.isOnline(computerId)
  const viewer = store.computers.find((x) => x.id === computerId)?.access === 'viewer'
  const [page, setPage] = useState<ArtifactInfo | null>(null)
  const [shared, setShared] = useState<Shared | null>(null)
  // The editing share link's token: a string, so live editing restarts only when the link changes, not whenever the
  // page reloads and makes a new share object.
  const shareEditor = shared?.editor ? shared.token : null
  const [document, setDocument] = useState<InteractiveDocument | null>(() =>
    pageCopy(contentStorage, computerId, artifactId),
  )
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<{ id: number; data: object }[]>([])
  const [menu, setMenu] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [makingProject, setMakingProject] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersion[] | null>(null)
  const [running, setRunning] = useState<ArtifactRun | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null)
  const [picked, setPicked] = useState<{ selector: string; text: string; html: string } | null>(null)
  const [change, setChange] = useState('')
  const [about, setAbout] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<ArtifactRun | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  // A doc's Markdown while the person edits it on the phone, and the version that edit started from.
  // A doc's or diagram's text while the person edits it; a doc's blocks when edited as formatted text.
  const [editing, setEditing] = useState<{ base: number; text: string; blocks?: DocBlock[] } | null>(null)
  const [editingSlides, setEditingSlides] = useState<{ base: number; slides: (Slide & { from: number })[] } | null>(
    null,
  )
  // A motion played as the host's MP4 in the phone's own video player.
  const [playing, setPlaying] = useState(false)
  // A flowchart's labels while the person changes its words without its Mermaid syntax.
  const [editingLabels, setEditingLabels] = useState<{ base: number; source: string; labels: string[] } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  // The person's other devices editing this text too; saving merges edits that changed different lines.
  const [alsoEditing, setAlsoEditing] = useState<string[]>([])
  const editingText = !!editing
  // A row that opens a sheet or the share sheet waits for the menu to leave the screen: on iOS a sheet presented while
  // another is still closing never appears.
  const menuTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(menuTimer.current), [])
  const afterMenu = (run: () => void) => {
    setMenu(false)
    clearTimeout(menuTimer.current)
    menuTimer.current = setTimeout(run, SHEET_SETTLE_MS)
  }
  const editingNowRef = useRef(editing)
  editingNowRef.current = editing
  // Where this phone last typed (a heading, or a slide), sent with its presence so others see the part it is on. The
  // doc's part comes from what changed since the last look, which moves on whenever others' typing is merged in.
  const partNow = useRef<string | null>(null)
  const seenText = useRef<string | null>(null)
  const editingAny = editingText || !!editingSlides
  useEffect(() => {
    if (!editingAny) return
    let live = true
    partNow.current = null
    seenText.current = null
    const token = shareEditor
    const mark = () => {
      const current = editingNowRef.current
      if (current) {
        const text = current.blocks ? withDocBlocks(current.text, current.blocks) : current.text
        const at = seenText.current === null ? null : changedAt(seenText.current, text)
        if (at !== null) partNow.current = headingAt(text, at)
        seenText.current = text
      }
      void (
        token
          ? store.invoke(computerId, 'artifacts.shareEditing', token, true, partNow.current)
          : store.invoke(computerId, 'artifacts.editing', artifactId, true, partNow.current)
      ).then(
        (others) => live && setAlsoEditing(others),
        () => {},
      )
    }
    mark()
    const timer = setInterval(mark, 5000)
    return () => {
      live = false
      clearInterval(timer)
      setAlsoEditing([])
      void (
        token
          ? store.invoke(computerId, 'artifacts.shareEditing', token, false)
          : store.invoke(computerId, 'artifacts.editing', artifactId, false)
      ).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marks once per opened editor; the store object changes on every update
  }, [editingAny, computerId, artifactId, shareEditor])
  // Live typing: the text is synced with the host's shared copy about once a second, so others' words appear as
  // they type them; the host saves a version once nobody types for a minute, or Save does.
  const editingNow = useRef(editing)
  editingNow.current = editing
  useEffect(() => {
    if (!editingText) return
    let stopped = false
    let editor: LiveTextEditor | null = null
    let busy = false
    const token = shareEditor
    const textOf = (value: NonNullable<typeof editing>) =>
      value.blocks ? withDocBlocks(value.text, value.blocks) : value.text
    const opened = editingNow.current ? textOf(editingNow.current) : ''
    void (
      token
        ? store.invoke(computerId, 'artifacts.shareLiveJoin', token)
        : store.invoke(computerId, 'artifacts.liveJoin', artifactId)
    ).then(
      (joined) => {
        if (stopped) return
        editor = new LiveTextEditor(joined.state)
        const fromHost = editor.text
        setEditing((current) => {
          if (!current) return current
          const typed = textOf(current)
          const text = joinedText(opened, fromHost, typed)
          return {
            ...current,
            text,
            base: joined.version,
            ...(current.blocks && text !== typed ? { blocks: docBlocks(text) } : {}),
          }
        })
      },
      () => {},
    )
    const timer = setInterval(() => {
      if (!editor || busy) return
      busy = true
      void syncLiveText(
        editor,
        () => (editingNow.current ? textOf(editingNow.current) : null),
        (update, stateVector) =>
          (token
            ? store.invoke(computerId, 'artifacts.shareLiveSync', token, update, stateVector)
            : store.invoke(computerId, 'artifacts.liveSync', artifactId, update, stateVector)
          ).then((reply) => {
            if (reply.version !== undefined && !stopped) setEditing((current) => movedBase(current, reply.version!))
            return reply
          }),
      )
        .then((merged) => {
          if (merged === null || stopped) return
          seenText.current = merged
          setEditing((current) =>
            current ? { ...current, text: merged, ...(current.blocks ? { blocks: docBlocks(merged) } : {}) } : current,
          )
        })
        .catch(() => {})
        .finally(() => {
          busy = false
        })
    }, 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncs once per opened editor; the store object changes on every update
  }, [editingText, computerId, artifactId, shareEditor])
  const field = {
    color: c.text,
    fontSize: font.control,
    backgroundColor: c.fill,
    borderRadius: 10,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  } as const
  // A deck's slide text and order while the person edits it on the phone, and the version it started from.
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
    const token = shareEditor
    void (
      token
        ? store.invoke(computerId, 'artifacts.shareLiveJoin', token)
        : store.invoke(computerId, 'artifacts.liveJoin', artifactId)
    ).then(
      (joined) => {
        if (stopped) return
        editor = new LiveTextEditor(joined.state)
        const current = slidesNow.current
        withWords(joinedText(opened, editor.text, current && inOrder(current) ? deckText(current.slides) : opened))
        setEditingSlides((current) => movedBase(current, joined.version))
      },
      () => {},
    )
    const timer = setInterval(() => {
      if (!editor || busy) return
      busy = true
      void syncLiveText(
        editor,
        () => {
          const current = slidesNow.current
          return current && inOrder(current) ? deckText(current.slides) : null
        },
        (update, stateVector) =>
          (token
            ? store.invoke(computerId, 'artifacts.shareLiveSync', token, update, stateVector)
            : store.invoke(computerId, 'artifacts.liveSync', artifactId, update, stateVector)
          ).then((reply) => {
            if (reply.version !== undefined && !stopped)
              setEditingSlides((current) => movedBase(current, reply.version!))
            return reply
          }),
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
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncs once per opened editor; the store object changes on every update
  }, [editingDeck, computerId, artifactId, shareEditor])
  // A design's frame words while the person edits them, one list per frame, and the version they started from.
  const [editingDesign, setEditingDesign] = useState<{
    base: number
    frames: { name: string; texts: string[] }[]
  } | null>(null)
  const [frameError, setFrameError] = useState('')
  const [generation, setGeneration] = useState(0)
  const state = useRef<InteractiveState | null>(null)
  const revision = useRef(0)
  const functions = useRef<{ name: string; description: string; input: Record<string, string> }[]>([])
  const follow = useRef(new Map<string, { requestId: string; stepRequestId?: string; shown: number }>())
  const waiting = useRef(new Map<string, string>())
  const nextMessage = useRef(0)
  const activity = useRef(pageRunActivity('', store.language))
  useEffect(() => {
    const current = activity.current
    return () => current.stop()
  }, [])
  const post = useCallback((data: object) => {
    nextMessage.current += 1
    const id = nextMessage.current
    setMessages((all) => [...all.slice(-40), { id, data }])
  }, [])
  // A deck shows one slide at a time on the phone; a sideways swipe or the arrows move through it.
  const slides = document ? slideCount(document) : 0
  const [slide, setSlide] = useState(0)
  const slideAt = useRef(0)
  const showSlide = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(slides - 1, index))
      slideAt.current = next
      setSlide(next)
      post({ type: 'slide', value: { index: next, present: true } })
      // A desktop presenting this deck follows the phone, so the phone works as its remote.
      if (online && !shared) void store.invoke(computerId, 'artifacts.turnSlide', artifactId, next).catch(() => {})
    },
    [post, slides, online, shared, store, computerId, artifactId],
  )
  const showSlideLatest = useRef(showSlide)
  useEffect(() => {
    showSlideLatest.current = showSlide
  }, [showSlide])
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, move) =>
          Math.abs(move.dx) > 24 && Math.abs(move.dx) > Math.abs(move.dy) * 2,
        onPanResponderRelease: (_, move) => {
          if (Math.abs(move.dx) > 48) showSlideLatest.current(slideAt.current + (move.dx < 0 ? 1 : -1))
        },
      }),
    [],
  )
  const reply = useCallback(
    (requestId: string, value: unknown, failure?: string) =>
      post(failure ? { type: 'reply', requestId, error: failure } : { type: 'reply', requestId, value: value ?? null }),
    [post],
  )
  const load = useCallback(async () => {
    try {
      if (shareToken) {
        const opened = await store.invoke(computerId, 'artifacts.openShare', shareToken)
        setShared({
          token: opened.share.token,
          canAdd: opened.share.canAdd,
          ...(opened.share.editor ? { editor: opened.share.editor } : {}),
        })
        setPage({
          ...opened.artifact,
          pinned: false,
          projectId: null,
          createdAt: 0,
          changedAt: 0,
          sessionId: '',
          grants: {},
          pendingGrants: [],
        } as ArtifactInfo)
        setDocument(opened.document)
        state.current = opened.state.state
        revision.current = opened.state.revision
      } else {
        const [info, current, values] = await Promise.all([
          store.invoke(computerId, 'artifacts.get', artifactId),
          store.invoke(computerId, 'artifacts.document', artifactId),
          store.invoke(computerId, 'artifacts.state', artifactId),
        ])
        setPage(info)
        activity.current =
          activity.current.page === `${info.icon} ${info.title}`
            ? activity.current
            : pageRunActivity(`${info.icon} ${info.title}`, store.language)
        setDocument((before) => (before?.reference.version === current.reference.version && !saved ? before : current))
        savePageCopy(contentStorage, computerId, artifactId, current)
        if (values.revision !== revision.current) {
          revision.current = values.revision
          state.current = values.state
        }
      }
      setSaved(false)
      setError('')
    } catch (failure) {
      if (pageCopy(contentStorage, computerId, artifactId)) setSaved(true)
      setError(unreachable(failure) || !online ? say('Host unavailable. Reconnect to load content.') : reason(failure))
    }
  }, [store, computerId, artifactId, shareToken, say, online, saved])
  useEffect(() => {
    void load()
  }, [load])
  // Calls queued offline go to the host as soon as it answers, in order; refused ones are shown, not dropped.
  useEffect(() => {
    if (!online || shareToken || !queuedCalls(contentStorage, computerId, artifactId).length) return
    void syncCalls(
      contentStorage,
      computerId,
      artifactId,
      (call) => store.invoke(computerId, 'artifacts.call', artifactId, call.method, call.args),
      (failure) => !unreachable(failure),
    ).then(({ conflicts: refused, results }) => {
      if (refused.length) setConflicts(refused.map((entry) => entry.error))
      for (const [id, value] of results) {
        const requestId = waiting.current.get(id)
        if (requestId) reply(requestId, value)
        waiting.current.delete(id)
      }
      void load()
    })
  }, [online, shareToken, computerId, artifactId, store, reply, load])
  useEffect(() => {
    if (!online) return
    return store.subscribe(computerId, (...[channel, payload]) => {
      if (channel !== 'artifacts:changed') return
      const event = payload as { artifactId: string; run?: ArtifactRun }
      if (event.artifactId !== artifactId) return
      const run = event.run
      if (!run) return void load()
      const followed = follow.current.get(run.id)
      if (!followed) return
      setRunning(run.status === 'running' ? run : null)
      activity.current.update(run)
      for (const step of run.steps.slice(followed.shown))
        if (followed.stepRequestId) post({ type: 'run-step', value: step, requestId: followed.stepRequestId })
      followed.shown = run.steps.length
      if (run.call) post({ type: 'tool-call', value: run.call })
      setConfirm(run.confirm ?? null)
      if (run.status !== 'running') {
        follow.current.delete(run.id)
        setConfirm(null)
        reply(followed.requestId, {
          status: run.status,
          answer: run.answer ?? null,
          error: run.error ?? null,
          steps: run.steps,
          changes: run.changes,
          id: run.id,
        })
      }
    })
  }, [online, store, computerId, artifactId, load, post, reply])
  const theme = useMemo(
    () =>
      interactiveThemeVariables({
        scheme,
        background: c.window,
        foreground: c.text,
        muted: c.muted,
        primary: c.accent,
        surface: c.raised2,
        surfaceRaised: c.bubble,
        codeBackground: c.code,
        button: c.primary,
        buttonForeground: c.primaryInk,
        success: c.ok,
        warning: c.warn,
        danger: c.bad,
      }),
    [c, scheme],
  )
  const instance = `page:${artifactId}:${document?.reference.version ?? 0}:${generation}`
  const html = useMemo(
    () => (document ? interactiveHtml(document.html, instance, state.current, theme, document.reference.network) : ''),
    // The frame keeps its own state once loaded; a theme change reaches it as a message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, instance],
  )
  const startThread = async (prompt: string, selector?: string) => {
    try {
      const started = await store.invoke(computerId, 'artifacts.startThread', artifactId, prompt, selector)
      await store.refresh(computerId).catch(() => {})
      router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, started.taskId) } })
    } catch (failure) {
      Alert.alert(say('That didn’t work'), reason(failure))
    }
  }
  const call = (requestId: string, method: string, args: unknown[]) => {
    const send = () =>
      shared
        ? store.invoke(computerId, 'artifacts.shareCall', shared.token, method, args)
        : store.invoke(computerId, 'artifacts.call', artifactId, method, args)
    const queue = () => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entry: QueuedCall = { id, method, args, at: Date.now() }
      if (!queueCall(contentStorage, computerId, artifactId, entry))
        return reply(requestId, null, say('The offline queue is full. Reconnect to the host.'))
      // A record shows at once as queued; a question waits for the host while this page stays open.
      if (method === 'ai.ask') waiting.current.set(id, requestId)
      else reply(requestId, { id: `queued-${id}`, collection: args[0], data: args[args.length - 1], queued: true })
    }
    if (!shared && QUEUEABLE.has(method) && !online) return queue()
    void send().then(
      (value) => reply(requestId, value),
      (failure) => {
        if (!shared && QUEUEABLE.has(method) && unreachable(failure)) queue()
        else reply(requestId, null, reason(failure))
      },
    )
  }
  const receive = (raw: unknown) => {
    const m = raw as FrameMessage
    if (!m || m.ramuInteractive !== 1 || m.instance !== instance) return
    if (m.type === 'tools' && Array.isArray(m.value)) functions.current = m.value.slice(0, 16)
    if (m.type === 'tool-result' && m.value && typeof m.value === 'object') {
      const result = m.value as { id: string; value?: unknown; error?: string }
      void store.invoke(computerId, 'artifacts.runReply', result.id, result.value ?? null, result.error).catch(() => {})
    }
    if (m.type === 'picked' && m.value && typeof m.value === 'object') setPicked(m.value as never)
    if (m.type === 'error') {
      const value = (typeof m.value === 'string' ? { message: m.value } : (m.value ?? {})) as {
        message?: string
        steps?: string[]
      }
      setFrameError(String(value.message ?? say('An interaction failed.')))
      if (!shared && online && document)
        void store
          .invoke(computerId, 'artifacts.reportError', artifactId, {
            message: String(value.message ?? ''),
            version: document.reference.version,
            device: 'phone',
            steps: Array.isArray(value.steps) ? value.steps.map(String).slice(-20) : undefined,
          })
          .catch(() => {})
    }
    if (m.type === 'state' && !shared && online) {
      const next = readInteractiveState(m.value)
      if (next)
        void store.invoke(computerId, 'artifacts.saveState', artifactId, next, revision.current).then(
          (result) => {
            revision.current = result.revision
            if (!result.accepted) post({ type: 'restore', value: result.state })
          },
          () => {},
        )
    }
    if (m.type !== 'call' || !m.requestId || !m.value || typeof m.value !== 'object') return
    const { method, args } = m.value as { method: string; args: unknown[] }
    const requestId = m.requestId
    if (method === 'ai.run' || method === 'ai.flow') {
      if (shared || !online) return reply(requestId, null, say('Runs need the host. Reconnect and try again.'))
      const options = (args[1] ?? {}) as { shape?: unknown; maxSteps?: number; runId?: string; name?: string }
      const start =
        method === 'ai.flow'
          ? store.invoke(computerId, 'artifacts.runFlow', artifactId, String(args[0]), functions.current)
          : store.invoke(computerId, 'artifacts.runStart', artifactId, String(args[0]), {
              shape: options.shape,
              maxSteps: options.maxSteps,
              name: options.name,
              functions: functions.current,
            })
      void start.then(
        (runId) =>
          runId
            ? follow.current.set(runId, { requestId, stepRequestId: options.runId, shown: 0 })
            : reply(requestId, null, say('The run did not start.')),
        (failure) => reply(requestId, null, reason(failure)),
      )
      return
    }
    if (method === 'thread.start') {
      if (shared) return reply(requestId, null, say('Threads cannot be started through a share link.'))
      const prompt = String(args[0] ?? '')
      Alert.alert(say('The artifact asks to start a thread'), prompt, [
        { text: say('Cancel'), style: 'cancel', onPress: () => reply(requestId, null) },
        { text: say('Start thread'), onPress: () => void startThread(prompt).then(() => reply(requestId, null)) },
      ])
      return
    }
    call(requestId, method, args)
  }
  const run = (name: string) =>
    void store.invoke(computerId, 'artifacts.runFlow', artifactId, name, functions.current).then(
      (runId) => runId && follow.current.set(runId, { requestId: `toolbar-${runId}`, shown: 0 }),
      (failure) => Alert.alert(say('That didn’t work'), reason(failure)),
    )
  const ask = () =>
    void store
      .invoke(computerId, 'artifacts.ask', artifactId, question.trim())
      .then(setAnswer, (failure) => Alert.alert(say('That didn’t work'), reason(failure)))
  const pending = !shared && !viewer && page ? page.pendingGrants : []
  const runs = Object.entries(page?.capabilities.runs ?? {})
  const records = !!page?.capabilities.records && !!page.grants.records && !!page.grants.ai
  const answerValue = (answer?.answer ?? {}) as { text?: string; rows?: { label?: unknown; value?: unknown }[] }
  return (
    <Screen>
      <Header
        title={page ? `${page.icon} ${page.title}` : say('Artifacts')}
        subtitle={
          saved
            ? say('Saved copy · reconnect to see the current version')
            : document
              ? `v${document.reference.version}`
              : undefined
        }
        right={<HeaderButton icon={MoreHorizontal} label={say('Artifact actions')} onPress={() => setMenu(true)} />}
      />
      <View style={{ flex: 1 }}>
        {error && !document ? (
          <T tone="muted" style={{ padding: space.l }}>
            {error}
          </T>
        ) : null}
        {page?.lastError && !shared ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              paddingHorizontal: space.l,
              paddingVertical: space.s,
              backgroundColor: c.fill,
            }}
          >
            <T size={font.caption} style={{ flex: 1 }} numberOfLines={2}>
              {say('This artifact hit an error: {message}', { message: page.lastError.message })}
            </T>
            {!viewer ? (
              <Button
                kind="secondary"
                title={say('Fix this')}
                onPress={() => {
                  const failure = page.lastError!
                  void startThread(
                    `Fix this error in my artifact. Reproduce it with artifact_preview, then publish the fixed version with artifact_publish {artifact: "${page.id}", changes}.\nError on ${failure.device ?? 'a device'} in v${failure.version}: ${failure.message}${failure.steps?.length ? `\nWhat the person did before it: ${failure.steps.join(' → ')}` : ''}`,
                  ).then(() => store.invoke(computerId, 'artifacts.clearError', artifactId))
                }}
              />
            ) : null}
          </View>
        ) : null}
        {conflicts.length ? (
          <View style={{ paddingHorizontal: space.l, paddingVertical: space.s, backgroundColor: c.badWash }}>
            <T size={font.caption}>{say('Some changes made offline were not saved:')}</T>
            {conflicts.map((conflict, index) => (
              <T key={index} size={font.caption} tone="muted">
                {conflict}
              </T>
            ))}
            <Button kind="ghost" title={say('Dismiss')} onPress={() => setConflicts([])} />
          </View>
        ) : null}
        {running ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              paddingHorizontal: space.l,
              paddingVertical: space.s,
            }}
          >
            <T size={font.caption} tone="muted" style={{ flex: 1 }} numberOfLines={2}>
              {running.steps.at(-1)?.text ?? running.task}
            </T>
            <Button
              kind="secondary"
              title={say('Stop')}
              onPress={() => void store.invoke(computerId, 'artifacts.runStop', running.id)}
            />
          </View>
        ) : null}
        {confirm ? (
          <View style={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s, backgroundColor: c.fill }}>
            <T>{confirm.text}</T>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                kind="secondary"
                title={say('Keep them')}
                onPress={() => {
                  setConfirm(null)
                  void store.invoke(computerId, 'artifacts.runConfirm', confirm.id, false)
                }}
              />
              <Button
                kind="danger"
                title={say('Allow')}
                onPress={() => {
                  setConfirm(null)
                  void store.invoke(computerId, 'artifacts.runConfirm', confirm.id, true)
                }}
              />
            </View>
          </View>
        ) : null}
        {picked ? (
          <View style={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            <T size={font.caption} tone="muted" numberOfLines={1}>
              {picked.text || picked.selector}
            </T>
            <TextInput
              autoFocus
              accessibilityLabel={say('What should change here?')}
              placeholder={say('What should change here?')}
              placeholderTextColor={c.muted}
              value={change}
              onChangeText={setChange}
              style={{ minHeight: 44, padding: space.m, borderRadius: 10, backgroundColor: c.fill, color: c.text }}
            />
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button kind="ghost" title={say('Cancel')} onPress={() => setPicked(null)} />
              <Button
                title={say('Ask')}
                disabled={!change.trim()}
                onPress={() => {
                  void startThread(
                    `${change.trim()}\nChange only this element of the artifact (the person pointed at it): ${picked.selector}\nIts text: ${JSON.stringify(picked.text)}\nIts HTML: ${picked.html}`,
                    picked.selector,
                  )
                  setPicked(null)
                  setChange('')
                }}
              />
            </View>
          </View>
        ) : null}
        {about !== null ? (
          <View style={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            <TextInput
              autoFocus
              multiline
              accessibilityLabel={say('Ask about this artifact')}
              placeholder={say('Ask about this artifact')}
              placeholderTextColor={c.muted}
              value={about}
              onChangeText={setAbout}
              style={{ minHeight: 64, padding: space.m, borderRadius: 10, backgroundColor: c.fill, color: c.text }}
            />
            <T size={font.caption} tone="muted">
              {say('A new thread starts with this artifact attached. It works with its usual access and approvals.')}
            </T>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button kind="ghost" title={say('Cancel')} onPress={() => setAbout(null)} />
              <Button
                title={say('Start thread')}
                disabled={!about.trim()}
                onPress={() => {
                  void startThread(about.trim())
                  setAbout(null)
                }}
              />
            </View>
          </View>
        ) : null}
        {records && online ? (
          <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            <TextInput
              accessibilityLabel={say('Ask this artifact')}
              placeholder={say('Ask this artifact, such as “how much on food in March?”')}
              placeholderTextColor={c.muted}
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={ask}
              returnKeyType="send"
              style={{
                flex: 1,
                minHeight: 40,
                paddingHorizontal: space.m,
                borderRadius: 10,
                backgroundColor: c.fill,
                color: c.text,
              }}
            />
          </View>
        ) : null}
        {answer ? (
          <View style={{ gap: 4, paddingHorizontal: space.l, paddingBottom: space.s }}>
            <T>{answer.status === 'done' ? (answerValue.text ?? '') : (answer.error ?? say('No answer.'))}</T>
            {(Array.isArray(answerValue.rows) ? answerValue.rows : []).slice(0, 8).map((row, index) =>
              typeof row?.value === 'number' ? (
                <T key={index} size={font.caption} tone="muted">
                  {String(row.label ?? '')}: {row.value.toLocaleString()}
                </T>
              ) : null,
            )}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              {answer.status === 'done' ? (
                <Button
                  kind="secondary"
                  title={say('Keep as a panel')}
                  onPress={() =>
                    void startThread(
                      `Add a panel to my artifact that always shows the answer to "${question}" from its records (today it is: ${answerValue.text ?? ''}). Compute it with ramuContent.records, not a model call, and publish the new version.`,
                    )
                  }
                />
              ) : null}
              <Button kind="ghost" title={say('Close')} onPress={() => setAnswer(null)} />
            </View>
          </View>
        ) : null}
        {frameError ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l }}>
            <T size={font.caption} tone="muted" style={{ flex: 1 }}>
              {frameError}
            </T>
            <Button
              kind="ghost"
              title={say('Reload')}
              onPress={() => {
                setFrameError('')
                setGeneration((n) => n + 1)
              }}
            />
          </View>
        ) : null}
        {slides > 1 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s }}>
            <IconButton
              icon={ChevronLeft}
              label={say('Previous slide')}
              disabled={slide === 0}
              onPress={() => showSlide(slide - 1)}
            />
            <T size={font.caption} tone="muted" accessibilityLiveRegion="polite">
              {say('{current} of {count}', { current: slide + 1, count: slides })}
            </T>
            <IconButton
              icon={ChevronRight}
              label={say('Next slide')}
              disabled={slide === slides - 1}
              onPress={() => showSlide(slide + 1)}
            />
          </View>
        ) : null}
        {document ? (
          <View {...(slides > 1 ? swipe.panHandlers : {})}>
            <InteractiveFrame
              html={html}
              title={page?.title ?? document.reference.title}
              instance={instance}
              height={Math.max(320, screenHeight - 140)}
              theme={theme}
              messages={messages}
              maxMessage={3_500_000}
              onMessage={receive}
              onStop={() => setFrameError(say('Content stopped. Reload to try again.'))}
              onPainted={() => {
                if (slides > 1) post({ type: 'slide', value: { index: slideAt.current, present: true } })
              }}
            />
          </View>
        ) : null}
      </View>
      <Sheet open={menu} onClose={() => setMenu(false)} title={page?.title ?? say('Artifacts')}>
        <View style={{ padding: space.l, gap: space.m }}>
          {runs.length && !shared ? (
            <Card>
              {runs.map(([name, declared]) => (
                <Row
                  key={name}
                  disabled={!online || !!running}
                  onPress={() =>
                    afterMenu(() => {
                      run(name)
                    })
                  }
                >
                  <T>{declared.label}</T>
                </Row>
              ))}
            </Card>
          ) : null}
          <Card>
            {!shared && !viewer ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    post({ type: 'pick', value: true })
                  })
                }
              >
                <T>{say('Edit')}</T>
              </Row>
            ) : null}
            {!shared && !viewer ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    setAbout('')
                  })
                }
              >
                <T>{say('Ask about this')}</T>
              </Row>
            ) : null}
            {!shared ? (
              <Row
                onPress={() =>
                  void store
                    .invoke(computerId, 'artifacts.versions', artifactId)
                    .then(setVersions, () => setVersions([]))
                }
              >
                <T>{say('Versions')}</T>
              </Row>
            ) : null}
            {(page?.capabilities.widget || page?.kind === 'dashboard') && !shared ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    const current = widgetPage(store.drafts[WIDGET_PAGE_KEY])
                    store.setDraft(
                      WIDGET_PAGE_KEY,
                      current?.artifactId === artifactId ? '' : JSON.stringify({ computerId, artifactId }),
                    )
                  })
                }
              >
                <T>
                  {widgetPage(store.drafts[WIDGET_PAGE_KEY])?.artifactId === artifactId
                    ? say('Remove from the home screen widget')
                    : say('Show in the home screen widget')}
                </T>
              </Row>
            ) : null}
            {page && !shared && !viewer ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    setSettingsOpen(true)
                  })
                }
              >
                <T>{say('Artifact settings')}</T>
              </Row>
            ) : null}
            {page && online && !shared && !viewer ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    setMakingProject(true)
                  })
                }
              >
                <T>{say('Make it a project…')}</T>
              </Row>
            ) : null}
            <Row
              onPress={() =>
                afterMenu(() => {
                  void Share.share({
                    title: page?.title,
                    message: `${page?.title ?? ''} ${artifactLink({ computerId, artifactId, ...(shared ? { share: shared.token } : {}) })}`,
                    url: artifactLink({ computerId, artifactId, ...(shared ? { share: shared.token } : {}) }),
                  })
                })
              }
            >
              <T>{say('Add to Home Screen or share')}</T>
            </Row>
            {document && editableSource(document) !== null && online && (shared ? !!shared.editor : !viewer) ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    const text = editableSource(document)
                    if (text !== null)
                      setEditing({
                        base: document.reference.version,
                        text,
                        ...(page?.kind === 'doc' ? { blocks: docBlocks(text) } : {}),
                      })
                  })
                }
              >
                <T>{say('Edit text')}</T>
              </Row>
            ) : null}
            {page?.kind === 'slides' && document && online && (shared ? !!shared.editor : !viewer) ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.slides)?.content
                    if (stored)
                      setEditingSlides({
                        base: document.reference.version,
                        slides: (JSON.parse(stored) as { slides: Slide[] }).slides.map((slide, from) => ({
                          ...slide,
                          from,
                        })),
                      })
                  })
                }
              >
                <T>{say('Edit text')}</T>
              </Row>
            ) : null}
            {page?.kind === 'motion' && document && online && !shared ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    setPlaying(true)
                  })
                }
              >
                <T>{say('Play as video')}</T>
              </Row>
            ) : null}
            {page?.kind === 'diagram' &&
            document &&
            online &&
            !shared &&
            !viewer &&
            mermaidLabels(editableSource(document) ?? '').length > 0 ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    const source = editableSource(document) ?? ''
                    setEditingLabels({ base: document.reference.version, source, labels: mermaidLabels(source) })
                  })
                }
              >
                <T>{say('Edit labels')}</T>
              </Row>
            ) : null}
            {page?.kind === 'design' && document && online && !shared && !viewer ? (
              <Row
                onPress={() =>
                  afterMenu(() => {
                    const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.design)?.content
                    if (stored)
                      setEditingDesign({
                        base: document.reference.version,
                        frames: (JSON.parse(stored) as { frames: { name: string; html: string }[] }).frames.map(
                          (frame) => ({ name: frame.name, texts: designTexts(frame.html) }),
                        ),
                      })
                  })
                }
              >
                <T>{say('Edit text')}</T>
              </Row>
            ) : null}
            {(document ? kindExports(document, theme) : []).map(({ format, file }) => (
              <Row
                key={format}
                onPress={() =>
                  afterMenu(() => {
                    void shareFile(file).catch(() => setError(say('Could not share this content. Try again.')))
                  })
                }
              >
                <T>{say(SHARE_LABELS[format])}</T>
              </Row>
            ))}
            {page && online && !shared && !viewer
              ? hostExportFormats(page.kind).map((format) => (
                  <Row
                    key={format}
                    onPress={() =>
                      afterMenu(() => {
                        void store
                          .invoke(computerId, 'artifacts.export', artifactId, document?.reference.version, format)
                          .then(shareFile)
                          .catch(() => setError(say('Could not share this content. Try again.')))
                      })
                    }
                  >
                    <T>{say(hostShareLabel(format, page.kind))}</T>
                  </Row>
                ))
              : null}
          </Card>
          {page && !shared && declaredCapabilities(page.capabilities).length ? (
            <T size={font.caption} tone="muted">
              {say('Change what this artifact may use in Artifact settings on the desktop.')}
            </T>
          ) : null}
          {versions?.map((version) => (
            <Card key={version.reference.version} style={{ padding: space.m, gap: space.s }}>
              {version.preview ? (
                <Image source={{ uri: version.preview }} resizeMode="contain" style={{ height: 160, width: '100%' }} />
              ) : null}
              <T weight="600">v{version.reference.version}</T>
              <T tone="muted">{version.reference.changes ?? version.reference.summary}</T>
              {version.reference.version !== page?.version && !viewer ? (
                <Button
                  kind="secondary"
                  title={say('Restore v{version}', { version: version.reference.version })}
                  onPress={() => {
                    setVersions(null)
                    setMenu(false)
                    void store
                      .invoke(computerId, 'artifacts.restoreVersion', artifactId, version.reference.version)
                      .then(() => load())
                  }}
                />
              ) : null}
            </Card>
          ))}
        </View>
      </Sheet>
      <Sheet
        presentation="screen"
        scroll={false}
        open={!!editing}
        onClose={() => setEditing(null)}
        title={say('Edit text')}
      >
        {editing ? (
          <SheetScrollView contentContainerStyle={{ padding: space.l, gap: space.m }}>
            {page?.kind === 'doc' ? (
              <Button
                title={editing.blocks ? say('Edit Markdown') : say('Edit as formatted text')}
                kind="secondary"
                onPress={() =>
                  setEditing(
                    editing.blocks
                      ? { base: editing.base, text: withDocBlocks(editing.text, editing.blocks) }
                      : { ...editing, blocks: docBlocks(editing.text) },
                  )
                }
              />
            ) : null}
            {editing.blocks ? (
              editing.blocks.map((block, index) => {
                const change = (patch: Partial<DocBlock>) =>
                  setEditing({
                    ...editing,
                    blocks: editing.blocks!.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
                  })
                return (
                  <View
                    key={index}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: space.s,
                      paddingLeft: block.level * 16,
                      ...(block.kind === 'quote'
                        ? { borderLeftWidth: 3, borderLeftColor: c.line, paddingLeft: space.s }
                        : {}),
                    }}
                  >
                    {block.kind === 'item' ? <T style={{ paddingTop: 10 }}>•</T> : null}
                    {block.kind === 'task' ? (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!block.done }}
                        accessibilityLabel={block.text}
                        onPress={() => change({ done: !block.done })}
                        hitSlop={8}
                        style={{ paddingTop: 8 }}
                      >
                        <T>{block.done ? '☑' : '☐'}</T>
                      </Pressable>
                    ) : null}
                    <BlockInput
                      text={block.text}
                      accessibilityLabel={say('Block {number}', { number: index + 1 })}
                      multiline
                      onChangeText={(text) => change({ text })}
                      style={{
                        flex: 1,
                        color: c.text,
                        paddingVertical: 6,
                        fontSize: block.kind === 'heading' ? Math.max(font.body, 26 - block.level * 2) : font.body,
                        fontWeight: block.kind === 'heading' ? '700' : '400',
                        fontStyle: block.kind === 'quote' ? 'italic' : 'normal',
                        textDecorationLine: block.kind === 'task' && block.done ? 'line-through' : 'none',
                      }}
                    >
                      {inlineRuns(block.text).map((run, at) => (
                        <Text
                          key={at}
                          style={
                            run.style === 'marker'
                              ? { color: c.muted }
                              : run.style === 'bold'
                                ? { fontWeight: '700' }
                                : run.style === 'italic'
                                  ? { fontStyle: 'italic' }
                                  : run.style === 'code'
                                    ? { fontFamily: 'Menlo', backgroundColor: c.fill }
                                    : run.style === 'link'
                                      ? { color: c.accent, textDecorationLine: 'underline' }
                                      : undefined
                          }
                        >
                          {run.text}
                        </Text>
                      ))}
                    </BlockInput>
                  </View>
                )
              })
            ) : (
              <TextInput
                accessibilityLabel={say('Markdown')}
                multiline
                autoFocus
                textAlignVertical="top"
                value={editing.text}
                onChangeText={(text) => setEditing({ ...editing, text })}
                style={{
                  minHeight: 320,
                  flex: 1,
                  color: c.text,
                  fontSize: font.control,
                  fontFamily: 'Menlo',
                  backgroundColor: c.fill,
                  borderRadius: 10,
                  padding: space.m,
                }}
              />
            )}
            {alsoEditing.length ? (
              <T size={font.caption} tone="muted">
                {say('Also being edited on {0}. Saving keeps both edits where they changed different lines.', {
                  0: alsoEditing.join(', '),
                })}
              </T>
            ) : null}
            <T size={font.caption} tone="muted">
              {say('Saving makes v{version}, marked Edited by you.', { version: editing.base + 1 })}
            </T>
            <Button
              title={say('Save')}
              disabled={savingEdit}
              onPress={() => {
                setSavingEdit(true)
                Promise.resolve()
                  .then(() => (editing.blocks ? withDocBlocks(editing.text, editing.blocks) : editing.text))
                  // Through an editing share link, the save names the link's editor.
                  .then((text) =>
                    shared?.editor
                      ? store.invoke(computerId, 'artifacts.shareEditSource', shared.token, editing.base, text)
                      : store.invoke(computerId, 'artifacts.editSource', artifactId, editing.base, text),
                  )
                  .then(() => {
                    setEditing(null)
                    void load()
                  })
                  // A newer version or a problem in the text keeps the edit open, so nothing typed is lost.
                  .catch((failure) => Alert.alert(say('That didn’t work'), reason(failure)))
                  .finally(() => setSavingEdit(false))
              }}
            />
          </SheetScrollView>
        ) : null}
      </Sheet>
      <Sheet open={playing} onClose={() => setPlaying(false)} title={page?.title ?? say('Play as video')}>
        {playing && document ? (
          <View style={{ padding: space.l }}>
            <MotionVideo
              computerId={computerId}
              artifactId={artifactId}
              version={document.reference.version}
              title={page?.title ?? document.reference.title}
              onError={(message) => {
                setPlaying(false)
                Alert.alert(say('That didn’t work'), message)
              }}
            />
          </View>
        ) : null}
      </Sheet>
      <Sheet
        presentation="screen"
        open={!!editingLabels}
        onClose={() => setEditingLabels(null)}
        title={say('Edit labels')}
        scroll={false}
      >
        {editingLabels ? (
          <SheetScrollView contentContainerStyle={{ padding: space.l, gap: space.m }}>
            {editingLabels.labels.map((label, index) => (
              <TextInput
                key={index}
                accessibilityLabel={say('Label {number}', { number: index + 1 })}
                value={label}
                onChangeText={(value) =>
                  setEditingLabels({
                    ...editingLabels,
                    labels: editingLabels.labels.map((old, at) => (at === index ? value : old)),
                  })
                }
                style={field}
              />
            ))}
            <T size={font.caption} tone="muted">
              {say('Saving makes v{version}, marked Edited by you.', { version: editingLabels.base + 1 })}
            </T>
            <Button
              title={say('Save')}
              disabled={savingEdit}
              onPress={() => {
                setSavingEdit(true)
                Promise.resolve()
                  .then(() => withMermaidLabels(editingLabels.source, editingLabels.labels))
                  .then((source) =>
                    store.invoke(computerId, 'artifacts.editSource', artifactId, editingLabels.base, source),
                  )
                  .then(() => {
                    setEditingLabels(null)
                    void load()
                  })
                  .catch((failure) => Alert.alert(say('That didn’t work'), reason(failure)))
                  .finally(() => setSavingEdit(false))
              }}
            />
          </SheetScrollView>
        ) : null}
      </Sheet>
      <Sheet
        presentation="screen"
        open={!!editingDesign}
        onClose={() => setEditingDesign(null)}
        title={say('Edit text')}
        scroll={false}
      >
        {editingDesign ? (
          <SheetScrollView contentContainerStyle={{ padding: space.l, gap: space.l }}>
            {editingDesign.frames.map((frame, index) => (
              <View key={index} style={{ gap: space.s }}>
                <T size={font.caption} tone="muted">
                  {frame.name}
                </T>
                {frame.texts.length ? (
                  frame.texts.map((text, at) => (
                    <TextInput
                      key={at}
                      accessibilityLabel={say('Text {number} of {frame}', { number: at + 1, frame: frame.name })}
                      multiline={text.length > 40}
                      value={text}
                      onChangeText={(value) =>
                        setEditingDesign({
                          ...editingDesign,
                          frames: editingDesign.frames.map((entry, which) =>
                            which === index
                              ? { ...entry, texts: entry.texts.map((old, spot) => (spot === at ? value : old)) }
                              : entry,
                          ),
                        })
                      }
                      style={[field, text.length > 40 ? { minHeight: 72 } : null]}
                    />
                  ))
                ) : (
                  <T size={font.caption} tone="muted">
                    {say('No text in this frame.')}
                  </T>
                )}
              </View>
            ))}
            <T size={font.caption} tone="muted">
              {say('Saving makes v{version}, marked Edited by you.', { version: editingDesign.base + 1 })}
            </T>
            <Button
              title={say('Save')}
              disabled={savingEdit}
              onPress={() => {
                setSavingEdit(true)
                store
                  .invoke(
                    computerId,
                    'artifacts.editDesign',
                    artifactId,
                    editingDesign.base,
                    editingDesign.frames.map((frame) => frame.texts),
                  )
                  .then(() => {
                    setEditingDesign(null)
                    void load()
                  })
                  .catch((failure) => Alert.alert(say('That didn’t work'), reason(failure)))
                  .finally(() => setSavingEdit(false))
              }}
            />
          </SheetScrollView>
        ) : null}
      </Sheet>
      <Sheet
        presentation="screen"
        open={!!editingSlides}
        onClose={() => setEditingSlides(null)}
        title={say('Edit text')}
        scroll={false}
      >
        {editingSlides ? (
          <SheetScrollView contentContainerStyle={{ padding: space.l, gap: space.l }}>
            {editingSlides.slides.map((slide, index) => {
              const change = (patch: Partial<Slide>) => {
                partNow.current = say('Slide {number}', { number: index + 1 })
                setEditingSlides({
                  ...editingSlides,
                  slides: editingSlides.slides.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
                })
              }
              const move = (by: number) => {
                const slides = [...editingSlides.slides]
                const [moved] = slides.splice(index, 1)
                slides.splice(index + by, 0, moved!)
                setEditingSlides({ ...editingSlides, slides })
              }
              return (
                <View key={slide.from} style={{ gap: space.s }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <T size={font.caption} tone="muted" style={{ flex: 1 }}>
                      {say('Slide {number}', { number: index + 1 })}
                    </T>
                    <IconButton
                      icon={ArrowUp}
                      label={say('Move slide {number} up', { number: index + 1 })}
                      disabled={index === 0}
                      onPress={() => move(-1)}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label={say('Move slide {number} down', { number: index + 1 })}
                      disabled={index === editingSlides.slides.length - 1}
                      onPress={() => move(1)}
                    />
                  </View>
                  {slide.layout !== 'quote' ? (
                    <TextInput
                      accessibilityLabel={say('Title of slide {number}', { number: index + 1 })}
                      value={slide.title ?? ''}
                      onChangeText={(title) => change({ title })}
                      style={field}
                    />
                  ) : null}
                  {slide.layout === 'two-columns' && slide.columns ? (
                    slide.columns.map((column, at) => (
                      <TextInput
                        key={at}
                        accessibilityLabel={say('Column {column} of slide {number}', {
                          column: at + 1,
                          number: index + 1,
                        })}
                        multiline
                        value={column}
                        onChangeText={(text) =>
                          change({
                            columns: (at === 0 ? [text, slide.columns![1]] : [slide.columns![0], text]) as [
                              string,
                              string,
                            ],
                          })
                        }
                        style={[field, { minHeight: 72 }]}
                      />
                    ))
                  ) : (
                    <TextInput
                      accessibilityLabel={say('Text of slide {number}', { number: index + 1 })}
                      multiline
                      value={slide.body ?? ''}
                      onChangeText={(body) => change({ body })}
                      style={[field, { minHeight: 72 }]}
                    />
                  )}
                  {slide.layout === 'quote' ? (
                    <TextInput
                      accessibilityLabel={say('Who said it, slide {number}', { number: index + 1 })}
                      placeholder={say('Who said it')}
                      placeholderTextColor={c.muted}
                      value={slide.by ?? ''}
                      onChangeText={(by) => change({ by })}
                      style={field}
                    />
                  ) : null}
                  <TextInput
                    accessibilityLabel={say('Speaker notes of slide {number}', { number: index + 1 })}
                    placeholder={say('Speaker notes')}
                    placeholderTextColor={c.muted}
                    multiline
                    value={slide.notes ?? ''}
                    onChangeText={(notes) => change({ notes })}
                    style={[field, { minHeight: 56 }]}
                  />
                </View>
              )
            })}
            <T size={font.caption} tone="muted">
              {say('Saving makes v{version}, marked Edited by you.', { version: editingSlides.base + 1 })}
            </T>
            <Button
              title={say('Save')}
              disabled={savingEdit}
              onPress={() => {
                setSavingEdit(true)
                const edits = editingSlides.slides.map(({ from, title, body, columns, by, notes }) => ({
                  from,
                  title: title ?? '',
                  body: body ?? '',
                  by: by ?? '',
                  notes: notes ?? '',
                  ...(columns ? { columns } : {}),
                }))
                // Through an editing share link, the save names the link's editor.
                ;(shared?.editor
                  ? store.invoke(computerId, 'artifacts.shareEditSlides', shared.token, editingSlides.base, edits)
                  : store.invoke(computerId, 'artifacts.editSlides', artifactId, editingSlides.base, edits)
                )
                  .then(() => {
                    setEditingSlides(null)
                    void load()
                  })
                  .catch((failure) => Alert.alert(say('That didn’t work'), reason(failure)))
                  .finally(() => setSavingEdit(false))
              }}
            />
          </SheetScrollView>
        ) : null}
      </Sheet>
      {page && pending.length ? (
        <Sheet
          open
          onClose={() => void store.invoke(computerId, 'artifacts.grant', artifactId, denyAll(page)).then(() => load())}
          title={say('{title} asks to', { title: page.title })}
        >
          <View style={{ padding: space.l, gap: space.m }}>
            {pending.map((name) => (
              <T key={name}>• {grantText(say, name, page)}</T>
            ))}
            <T size={font.caption} tone="muted">
              {say('The artifact never sees your keys or other artifacts. Change this later in Artifact settings.')}
            </T>
            <Button
              title={say('Allow')}
              onPress={() =>
                void store.invoke(computerId, 'artifacts.grant', artifactId, allowAll(page)).then(() => load())
              }
            />
            <Button
              kind="ghost"
              title={say('Not now')}
              onPress={() =>
                void store.invoke(computerId, 'artifacts.grant', artifactId, denyAll(page)).then(() => load())
              }
            />
          </View>
        </Sheet>
      ) : null}
      {page && makingProject ? (
        <MakeProjectSheet
          open={makingProject}
          onClose={() => setMakingProject(false)}
          page={page}
          computerId={computerId}
        />
      ) : null}
      {page && settingsOpen ? (
        <ArtifactSettings
          computerId={computerId}
          page={page}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void load()}
          onDeleted={() => {
            setSettingsOpen(false)
            router.back()
          }}
        />
      ) : null}
    </Screen>
  )
}

function grantText(say: ReturnType<typeof useSay>, name: string, page: ArtifactInfo): string {
  const c = page.capabilities
  switch (name) {
    case 'records':
      return say('Keeps records on this host: {list}', { list: Object.keys(c.records ?? {}).join(', ') })
    case 'ai':
      return say('Uses a model on this host: {purpose}. The model sees only what the artifact sends it.', {
        purpose: c.ai?.purpose ?? '',
      })
    case 'camera':
      return say('Uses photos you choose: {purpose}', { purpose: c.camera?.purpose ?? '' })
    case 'notify':
      return say('Sends notifications: {purpose}. Their text reaches your phone through its push service.', {
        purpose: c.notify?.purpose ?? '',
      })
    case 'webhook':
      return say('Accepts records from outside services into {collection}', { collection: c.webhook?.collection ?? '' })
    case 'folder':
      return say('Reads one project folder: {path}', { path: c.folder?.path ?? '' })
    case 'ramu':
      return say('Reads what you see in Ramu, read-only: {purpose}', { purpose: c.ramu?.purpose ?? '' })
    case 'services':
      return say('Reads {services} with your plugins’ credentials in Settings, read-only: {purpose}', {
        services: (c.services?.services ?? []).join(', '),
        purpose: c.services?.purpose ?? '',
      })
    case 'schedules':
      return say('Runs on its own: {list}', { list: (c.schedules ?? []).map((s) => s.run).join(', ') })
    default:
      return say('Acts when records match: {list}', {
        list: (c.triggers ?? []).map((t) => `${t.collection}.${t.when.field} ${t.when.op} ${t.when.value}`).join(', '),
      })
  }
}

function allowAll(page: ArtifactInfo) {
  return Object.fromEntries(
    page.pendingGrants.map((name) => [
      name,
      name === 'ai'
        ? {
            model: page.capabilities.ai?.quality ?? 'fast',
            daily: page.capabilities.ai?.daily ?? 200,
            // Shared MCP servers are granted one by one in Artifact settings on the desktop.
            ...(page.capabilities.ai?.web ? { web: true } : {}),
          }
        : name === 'webhook'
          ? { token: '' }
          : name === 'ramu'
            ? (page.capabilities.ramu?.sources ?? [])
            : name === 'services'
              ? (page.capabilities.services?.services ?? [])
              : true,
    ]),
  )
}

function denyAll(page: ArtifactInfo) {
  return Object.fromEntries(page.pendingGrants.map((name) => [name, false]))
}
