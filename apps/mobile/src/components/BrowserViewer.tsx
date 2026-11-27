import { BrowserInputQueue, watchBrowserFrames } from '@ramu/shared/browserLiveViewer'
import { PermissionNeeded, RequestPermission } from './DevicePermissions'
import { VIEW_ONLY_BROWSER_NOTICE } from '../runtime/viewerAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Image, PanResponder, Platform, Pressable, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Command,
  Download,
  Ellipsis,
  FileText,
  Keyboard as KeyboardIcon,
  Plus,
  RotateCw,
  Upload,
  X,
  Globe,
  Minus,
  RefreshCcwDot,
  SunMoon,
  Smartphone,
  Search,
  Trash2,
} from 'lucide-react-native'
import type {
  BrowserDialog,
  BrowserHumanInput,
  BrowserTabAdjust,
  BrowserDownloadInfo,
  BrowserPageSnapshot,
} from '@ramu/shared/browserBridge'
import { browserShortcuts } from '@ramu/shared/browserBridge'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { translate } from '@ramu/shared/i18n'
import {
  CUSTOM_SEARCH,
  SEARCH_ENGINES,
  addressFrom,
  isHostLoopbackPage,
  phoneBrowserUrl,
  phoneForwardUrl,
  searchTemplateFrom,
  validSearchTemplate,
} from '@ramu/shared/browserLinks'
import type { Chat } from '../runtime/types'
import type { RemoteKey } from '../runtime/remoteKeyboard'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, Card, Segmented, Sheet, T } from './ui'
import { SheetGroup, SheetOption, SheetPanelGroup, useSheetInputStyle } from './SheetOptions'
import {
  ControlPill,
  ControlStrip,
  RemoteKeyboard,
  type RemoteKeyboardHandle,
  ViewerBanner,
  ViewerHeader,
  ViewerMenu,
  useViewerMenu,
  type ViewerMenuItem,
} from './ViewerChrome'
import PhoneBrowser from './PhoneBrowser'
import {
  CONTROL_TEXT,
  browserMenu,
  controlAction,
  controlState,
  fitSize,
  zoomStep,
  frameGesture,
  frameScroll,
  profileLabel,
  tabTitle,
  viewerMessage,
} from '../runtime/browserViewerState'

/** This device's choice of page layout. Phone layout is the default; Desktop layout is remembered once chosen. */
const SHORTCUTS = browserShortcuts()
const LAYOUT_KEY = 'pref-device:browserLayout'
/** This device's search for typed words, as the desktop's Settings → Browser → Search engine. */
const SEARCH_KEY = 'pref-device:searchEngine'
const SEARCH_CUSTOM_KEY = 'pref-device:searchCustom'

/**
 * The phone views the owning host's browser; it never substitutes a phone WebView or copies credentials. Laid out as a
 * mobile browser: close, page title and tabs; back, forward, address, reload and more; who is in control; the page.
 */
export function BrowserViewer({
  chat,
  onClose,
  hostManaged,
  openUrl,
  onOpened,
}: {
  chat: Chat
  onClose(): void
  /** A page to open as a new tab once the viewer is up, such as a server the thread started. */
  openUrl?: string | null
  onOpened?(): void
  /**
   * The host-managed browser, rather than the attached desktop's: only it handles file transfers and phone layout,
   * because a desktop page is also on the person's screen at the computer.
   */
  hostManaged: boolean
}) {
  const store = useStore()
  const viewOnly = store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const target = `${chat.computerId}:${chat.taskId}`
  const currentTarget = useRef(target)
  currentTarget.current = target
  const { c: theme } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [selected, setSelected] = useState('')
  const [owned, setOwned] = useState<number | null>(null)
  const [frame, setFrame] = useState('')
  const [frameSize, setFrameSize] = useState({ width: 4, height: 3 })
  // The address field shows the tab's URL until the person types; an unsent address is kept as a draft.
  const [draft, setDraft] = useState<string | null>(null)
  const draftValue = useRef(draft)
  draftValue.current = draft
  const keyboard = useRef<RemoteKeyboardHandle>(null)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  // Why the page cannot be shown, which the next read clears. An action's error (Take control, a page change) stays
  // until it is closed or the next action: the page read every 750 ms cleared it before it could be read.
  const [screenError, setScreenError] = useState('')
  const [frameError, setFrameError] = useState('')
  const [frameReady, setFrameReady] = useState(false)
  const inputQueue = useRef<BrowserInputQueue | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTab, setNewTab] = useState(false)
  const [dialog, setDialog] = useState<BrowserDialog | null>(null)
  const [dialogText, setDialogText] = useState('')
  const [pageText, setPageText] = useState('')
  const [observation, setObservation] = useState<BrowserPageSnapshot | null>(null)
  const [uploadPath, setUploadPath] = useState('')
  // A page on the host's loopback opens through a forward the host makes for this phone, closed with the page.
  const [phonePage, setPhonePage] = useState<{
    url: string
    forward?: { id: string; targetPort: number; expiresAt: number }
    fromTab?: BrowserTabInfo
  } | null>(null)
  const forwardId = phonePage?.forward?.id
  useEffect(() => {
    if (!forwardId) return
    return () => void io.current.invoke(chat.computerId, 'hostBrowser.phoneForwardClose', forwardId).catch(() => {})
  }, [forwardId, chat.computerId])
  const [panel, setPanel] = useState<'tabs' | 'text' | 'upload' | 'downloads' | 'display' | 'search' | 'keys' | null>(
    null,
  )
  const downloadsOpen = panel === 'downloads'
  const menu = useViewerMenu()
  const addressField = useRef<import('react-native').TextInputInstance>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const phoneLayout = store.drafts?.[LAYOUT_KEY] !== 'desktop'
  const fitted = useRef<{ key: string; size: { width: number; height: number } } | null>(null)
  const [downloads, setDownloads] = useState<BrowserDownloadInfo[]>([])
  const [paths, setPaths] = useState<Record<string, string>>({})
  const downloadsVisible = useRef(downloadsOpen)
  downloadsVisible.current = downloadsOpen
  const [active, setActive] = useState(AppState.currentState === 'active')
  const current = useRef<BrowserTabInfo | undefined>(undefined)
  const io = useRef(store)
  io.current = store
  const allowed = useCallback(
    () =>
      currentTarget.current === target &&
      io.current.computers?.find((host) => host.id === chat.computerId)?.access !== 'viewer' &&
      io.current.isOnline(chat.computerId),
    [target, chat.computerId],
  )
  const tab = tabs.find((tab) => tab.id === selected) ?? tabs[0]
  const tabId = tab?.id
  const generation = tab?.generation
  const online = store.isOnline(chat.computerId)
  current.current = tab
  const controlled =
    !viewOnly &&
    !!tab &&
    tab.controller === 'human' &&
    (tab.controlledHere ?? tab.generation === owned) &&
    !tab.paused &&
    active &&
    store.isOnline(chat.computerId)
  const readyGeneration = useRef('')
  const controlKey = tab ? `${tab.id}:${tab.generation}` : ''
  if (tab?.inputReady) readyGeneration.current = controlKey
  const own = controlled && readyGeneration.current === controlKey && frameReady
  const state = tab
    ? controlState(tab, { online: store.isOnline(chat.computerId), active, ownedGeneration: owned })
    : null
  const invoke = store.invoke.bind(store)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  // Closing the viewer or leaving the app while in control hands the tab back to the thread's agent (or to its next
  // run), so nobody has to resume it later. What was held is read while the app was still active; declared before the
  // polling effect so this runs before its disconnect.
  const handBack = useRef<{ tabId?: string; controlled: boolean }>({ controlled: false })
  if (active) handBack.current = { tabId, controlled }
  useEffect(() => {
    if (!active) return
    return () => {
      const held = handBack.current
      if (held.controlled && held.tabId && chat.taskId && allowed())
        void io.current.invoke(chat.computerId, 'hostBrowser.release', chat.taskId, held.tabId).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the viewer stops being in front; the rest is read at that moment
  }, [active])
  useEffect(() => {
    if (viewOnly || !active || !chat.taskId || !online) return
    let mounted = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!allowed()) return
      try {
        const listed = await io.current.invoke(chat.computerId, 'hostBrowser.list', chat.taskId!)
        if (!mounted || !allowed()) return
        setTabs(listed)
        if (downloadsVisible.current) {
          const entries = await io.current.invoke(chat.computerId, 'hostBrowser.downloads', chat.taskId!)
          if (!mounted || !allowed()) return
          setDownloads(entries)
        }
        const tab = listed.find((tab) => tab.id === current.current?.id) ?? listed[0]
        if (tab) {
          const websiteDialog = await io.current.invoke(chat.computerId, 'hostBrowser.dialog', chat.taskId!, tab.id)
          if (!mounted || !allowed()) return
          setDialog(websiteDialog)
        } else {
          setFrame('')
          setDialog(null)
        }
        setScreenError('')
      } catch (error) {
        if (mounted) setScreenError(error instanceof Error ? error.message : String(error))
      } finally {
        if (mounted && allowed()) timer = setTimeout(() => void poll(), 750)
      }
    }
    void poll()
    return () => {
      mounted = false
      clearTimeout(timer)
      if (allowed()) void io.current.invoke(chat.computerId, 'hostBrowser.disconnect').catch(() => {})
    }
  }, [chat.computerId, chat.taskId, active, viewOnly, online, allowed])
  const act = async (work: () => Promise<unknown>) => {
    if (!allowed() || busy) return
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setFrameReady(false)
    setFrame('')
    setFrameError('')
    // The host stops capturing while the page is open in this phone's own browser.
    if (viewOnly || !active || phonePage || !online || !chat.taskId || !tabId || !allowed()) return
    return watchBrowserFrames({
      next: (after) => io.current.invoke(chat.computerId, 'hostBrowser.nextFrame', chat.taskId!, tabId, after),
      fallback: () => io.current.invoke(chat.computerId, 'hostBrowser.frame', chat.taskId!, tabId),
      show: (image) => {
        if (!allowed()) return
        setFrame(`data:${image.mimeType};base64,${image.data}`)
        setFrameSize({ width: image.width, height: image.height })
      },
      ready: (value) => {
        if (allowed()) setFrameReady(value)
      },
      error: (message) => {
        if (allowed()) setFrameError(message)
      },
    })
  }, [chat.computerId, chat.taskId, tabId, active, phonePage, online, viewOnly, allowed])
  useEffect(() => {
    if (!controlled || !frameReady || !tabId || generation === undefined || !chat.taskId) return
    const queue = new BrowserInputQueue(async (input) => {
      if (!allowed()) throw new Error(translate(io.current.language, 'Browser control changed.'))
      await io.current.invoke(chat.computerId, 'hostBrowser.input', chat.taskId!, tabId, generation, input)
    })
    inputQueue.current = queue
    return () => {
      queue.close()
      if (inputQueue.current === queue) inputQueue.current = null
    }
  }, [chat.computerId, chat.taskId, tabId, generation, controlled, frameReady, allowed])
  // While the phone controls a host-managed page, the host lays it out at the phone's size, as a phone browser would.
  // The host restores the default layout itself as soon as control changes, so the agent never inherits it.
  useEffect(() => {
    if (!hostManaged || !own || !tabId || !chat.taskId) {
      if (!own) fitted.current = null
      return
    }
    const key = `${tabId}:${generation}`
    const previous = fitted.current?.key === key ? fitted.current.size : null
    if (!phoneLayout) {
      if (!previous) return
      fitted.current = null
      void io.current.invoke(chat.computerId, 'hostBrowser.fit', chat.taskId, tabId, null).catch(() => {})
      return
    }
    const size = fitSize(area, previous)
    if (!size) return
    const timer = setTimeout(() => {
      if (!allowed()) return
      fitted.current = { key, size }
      void io.current
        .invoke(chat.computerId, 'hostBrowser.fit', chat.taskId!, tabId, size)
        // The keyboard shrank the page: the host scrolls the focused field back into view when asked about it.
        .then(() => {
          if (keyboard.current?.isOpen())
            return io.current.invoke(chat.computerId, 'hostBrowser.focus', chat.taskId!, tabId)
        })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [hostManaged, own, tabId, generation, chat.computerId, chat.taskId, phoneLayout, area, allowed])
  // After a tap lands, ask which kind of field has focus: a text field raises the matching phone keyboard.
  const followFocus = async () => {
    if (!allowed() || !chat.taskId || !tabId) return
    try {
      const focus = await io.current.invoke(chat.computerId, 'hostBrowser.focus', chat.taskId, tabId)
      if (!allowed()) return
      if (focus.editable) keyboard.current?.open(focus.kind)
      else keyboard.current?.close()
    } catch {
      // Without an answer the keyboard stays as it is; Paste in the menu still types into the page.
    }
  }
  const input = (input: BrowserHumanInput) => {
    if (!allowed() || !own || busy || (input.kind === 'scroll' && !input.x && !input.y)) return
    void inputQueue.current
      ?.push(input)
      .then(() => {
        if (input.kind === 'click' && input.button === 'left') void followFocus()
      })
      .catch((error) => {
        if (allowed()) setError(String(error.message ?? error))
      })
  }
  const typeKeys = (keys: RemoteKey[]) => {
    const queue = inputQueue.current
    if (!allowed() || !queue) return
    for (const key of keys)
      void queue
        .push(key.kind === 'text' ? { kind: 'text', text: key.text.slice(0, 2000) } : { kind: 'key', key: key.key })
        .catch((error) => {
          if (allowed()) setError(String(error.message ?? error))
        })
  }
  const aspect = frameSize.width / frameSize.height
  const width = area.width && area.height ? Math.min(area.width, area.height * aspect) : area.width
  const touch = useRef({ at: 0, lastTap: 0, lastX: 0, lastY: 0, x: 0, y: 0, dx: 0, dy: 0, scrolling: false })
  const gestureState = useRef({ input, width, aspect, pageWidth: frameSize.width, enabled: false })
  gestureState.current = { input, width, aspect, pageWidth: frameSize.width, enabled: own && !busy && width > 0 }
  const gestureFrame = useRef({ width: 0, aspect: 0, pageWidth: 0 })
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => gestureState.current.enabled,
      onPanResponderGrant: (event) => {
        gestureFrame.current = { ...gestureState.current }
        touch.current.x = event.nativeEvent.locationX
        touch.current.y = event.nativeEvent.locationY
        touch.current.at = Date.now()
        touch.current.dx = 0
        touch.current.dy = 0
        touch.current.scrolling = false
      },
      onPanResponderMove: (_event, gesture) => {
        const current = gestureState.current
        if (
          !current.enabled ||
          current.width !== gestureFrame.current.width ||
          current.aspect !== gestureFrame.current.aspect ||
          (!touch.current.scrolling && Math.hypot(gesture.dx, gesture.dy) <= 8)
        )
          return
        touch.current.scrolling = true
        current.input(frameScroll(gesture.dx - touch.current.dx, gesture.dy - touch.current.dy, current))
        touch.current.dx = gesture.dx
        touch.current.dy = gesture.dy
      },
      onPanResponderTerminate: () => {
        touch.current.lastTap = 0
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_event, gesture) => {
        const now = Date.now()
        const current = gestureState.current
        if (
          !current.enabled ||
          current.width !== gestureFrame.current.width ||
          current.aspect !== gestureFrame.current.aspect
        )
          return
        if (touch.current.scrolling) {
          current.input(frameScroll(gesture.dx - touch.current.dx, gesture.dy - touch.current.dy, current))
          touch.current.lastTap = 0
          return
        }
        const result = frameGesture(
          {
            x: touch.current.x + gesture.dx,
            y: touch.current.y + gesture.dy,
            dx: gesture.dx,
            dy: gesture.dy,
            ms: now - touch.current.at,
            afterTapMs:
              touch.current.lastTap &&
              Math.hypot(
                touch.current.x + gesture.dx - touch.current.lastX,
                touch.current.y + gesture.dy - touch.current.lastY,
              ) <= 20
                ? now - touch.current.lastTap
                : null,
          },
          { width: current.width, aspect: current.aspect, pageWidth: current.pageWidth },
        )
        touch.current.lastTap = result.kind === 'click' && result.button === 'left' ? now : 0
        touch.current.lastX = touch.current.x + gesture.dx
        touch.current.lastY = touch.current.y + gesture.dy
        current.input(result)
      },
    }),
  ).current
  const computer = store.computers.find((entry) => entry.id === chat.computerId)
  const host = computer?.name
  const selectTab = (id: string) => {
    setSelected(id)
    setDraft(null)
    setNewTab(false)
    setOwned(null)
    setFrame('')
    setPageText('')
    setObservation(null)
    setPanel(null)
  }
  const startNewTab = () => {
    setPanel(null)
    setNewTab(true)
    setDraft('')
    setTimeout(() => addressField.current?.focus(), 250)
  }
  const searchEngine = store.drafts?.[SEARCH_KEY] || SEARCH_ENGINES[0].id
  const searchCustom = store.drafts?.[SEARCH_CUSTOM_KEY] ?? ''
  const searchTemplate = searchTemplateFrom(searchEngine, searchCustom)
  /** A tab the person opens is theirs: it starts under their control, listed at once rather than after the next poll. */
  const openHostTab = (url: string) =>
    void act(async () => {
      const result = await invoke(chat.computerId, 'hostBrowser.open', chat.taskId!, url)
      setTabs((list) => [...list.filter((entry) => entry.id !== result.tab.id), result.tab])
      setSelected(result.tab.id)
      setOwned(result.tab.generation)
      setNewTab(false)
      setDraft(null)
    })
  const opening = useRef<string | null>(null)
  useEffect(() => {
    if (!openUrl || opening.current === openUrl || !allowed()) return
    opening.current = openUrl
    openHostTab(openUrl)
    onOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the URL asked for; `openHostTab` reads current state
  }, [openUrl])
  const submitAddress = () => {
    // A submit retained from before an access change does nothing, here as for host actions.
    if (!allowed()) return
    const url = addressFrom(draft ?? '', searchTemplate)
    if (!url || !chat.taskId) {
      setDraft(null)
      setNewTab(false)
      return
    }
    // A new page the phone can reach itself, such as a website or a search, opens in this phone's own browser. A page
    // on the host's localhost stays on the host, where it runs.
    const reachable = computer ? phoneBrowserUrl(url, computer.address) : null
    if ((newTab || !tab) && reachable && new URL(reachable).host === new URL(url).host) {
      setPhonePage({ url: reachable })
      setNewTab(false)
      setDraft(null)
      return
    }
    if (tab && !newTab)
      void act(async () => {
        await invoke(chat.computerId, 'hostBrowser.navigate', chat.taskId!, tab.id, url)
        setDraft(null)
      })
    else openHostTab(url)
  }
  const toggleControl = () =>
    tab &&
    void act(async () => {
      const next = await invoke(
        chat.computerId,
        controlled ? 'hostBrowser.release' : 'hostBrowser.take',
        chat.taskId!,
        tab.id,
      )
      setOwned(controlled ? null : next.generation)
    })
  // Zoom and appearance stay with the tab for everyone who views it; the host answers with the updated tab.
  const adjust = (change: BrowserTabAdjust) =>
    tab &&
    void act(async () => {
      const next = await invoke(chat.computerId, 'hostBrowser.adjust', chat.taskId!, tab.id, change)
      setTabs((list) => list.map((entry) => (entry.id === next.id ? next : entry)))
    })
  const readText = () =>
    tab &&
    void act(async () => {
      const snapshot = await invoke(chat.computerId, 'hostBrowser.read', chat.taskId!, tab.id)
      setPageText(snapshot.text)
      setObservation(snapshot)
    })
  const phoneUrl = tab && computer ? phoneBrowserUrl(tab.url, computer.address) : null
  const fileInputs = observation?.elements.filter((element) => element.type === 'file') ?? []
  const MENU_ITEMS: Record<ReturnType<typeof browserMenu>[number], Omit<ViewerMenuItem, 'key'>> = {
    keys: { title: t('Keys and shortcuts'), icon: Command, onPress: () => setPanel('keys') },
    paste: {
      title: t('Paste'),
      icon: ClipboardPaste,
      onPress: () =>
        void act(async () => {
          const value = (await Clipboard.getStringAsync()).slice(0, 2000)
          if (!value) throw new Error(t('The clipboard is empty.'))
          if (!inputQueue.current) throw new Error(t('Take control again to continue.'))
          await inputQueue.current.push({ kind: 'text', text: value })
        }),
    },
    hardReload: {
      title: t('Hard reload'),
      icon: RefreshCcwDot,
      onPress: () => adjust({ hardReload: true }),
    },
    display: {
      title: tab?.zoom ? `${t('Display')} (${Math.round(tab.zoom * 100)}%)` : t('Display'),
      icon: SunMoon,
      onPress: () => setPanel('display'),
    },
    newTab: { title: t('New tab'), icon: Plus, onPress: startNewTab },
    searchEngine: { title: t('Search engine'), icon: Search, onPress: () => setPanel('search') },
    openOnPhone: {
      title: t('Open on this phone'),
      icon: Smartphone,
      onPress: () => {
        if (!tab || !phoneUrl) return
        if (!isHostLoopbackPage(tab.url)) return setPhonePage({ url: phoneUrl, fromTab: tab })
        void act(async () => {
          const forward = await invoke(chat.computerId, 'hostBrowser.phoneForward', tab.url)
          const url = computer ? phoneForwardUrl(computer.address, forward.port, forward.openPath) : null
          if (!url) {
            void invoke(chat.computerId, 'hostBrowser.phoneForwardClose', forward.id).catch(() => {})
            throw new Error(t('This phone reaches the host through a tunnel, so the page cannot open here.'))
          }
          setPhonePage({ url, forward, fromTab: tab })
        })
      },
    },
    readText: {
      title: t('Read page text'),
      icon: FileText,
      onPress: () => {
        setPanel('text')
        readText()
      },
    },
    upload: {
      title: t('Upload a file'),
      icon: Upload,
      onPress: () => setPanel('upload'),
    },
    downloads: { title: t('Downloads'), icon: Download, onPress: () => setPanel('downloads') },
    closeTab: {
      title: t('Close tab'),
      icon: X,
      destructive: true,
      disabled: busy || !chat.taskId,
      onPress: () =>
        tab &&
        void act(async () => {
          await invoke(chat.computerId, 'hostBrowser.close', chat.taskId!, tab.id)
          selectTab('')
        }),
    },
  }
  const menuItems = browserMenu({
    hasTab: !!tab,
    own,
    hostManaged,
    fileInput: fileInputs.length > 0,
    phonePage: !!phoneUrl,
  }).map((key) => ({
    key,
    ...MENU_ITEMS[key],
  }))
  const inputStyle = useSheetInputStyle()
  // The touch surface is exactly the drawn frame: gestures map touches through its width and aspect ratio.
  const fitWidth = width
  if (viewOnly)
    return (
      <View style={{ flex: 1 }}>
        <ViewerHeader title={t('Browser')} subtitle={host} closeLabel={t('Close browser')} onClose={onClose} />
        <View style={{ padding: space.l }}>
          <T tone="muted">{VIEW_ONLY_BROWSER_NOTICE[store.language]}</T>
        </View>
      </View>
    )
  if (phonePage)
    return (
      <PhoneBrowser
        url={phonePage.url}
        forward={phonePage.forward}
        searchTemplate={searchTemplate}
        onClose={() => setPhonePage(null)}
        onOpenOnHost={
          chat.taskId
            ? (url) => {
                const from = phonePage.fromTab
                setPhonePage(null)
                if (!from || !tabs.some((entry) => entry.id === from.id)) return openHostTab(url)
                // Back to the tab it came from, as the person's tab: no new tab, and a page that moved on the phone
                // moves there too (the host's own localhost address again, if the phone went through a forward).
                const address = new URL(url)
                if (phonePage.forward && address.host === new URL(phonePage.url).host)
                  address.host = new URL(from.url).host
                selectTab(from.id)
                void act(async () => {
                  const taken = await invoke(chat.computerId, 'hostBrowser.take', chat.taskId!, from.id)
                  setOwned(taken.generation)
                  if (url !== phonePage.url)
                    await invoke(chat.computerId, 'hostBrowser.navigate', chat.taskId!, from.id, address.href)
                })
              }
            : undefined
        }
      />
    )
  const editable = own || !tab || newTab
  const nextControl = state ? controlAction(state) : null
  // A phone without the host's Browser permission is offered a request instead of a control the host would refuse.
  const browserAllowed = store.mayUse(chat.computerId, 'browser')
  const message = error || screenError || frameError
  return (
    <View style={{ flex: 1 }}>
      <ViewerHeader
        title={newTab ? t('New tab') : tabTitle(tab, t)}
        subtitle={tab ? `${host ?? ''}${host ? ' · ' : ''}${t(profileLabel(tab.profileId))}` : host}
        closeLabel={t('Close browser')}
        onClose={onClose}
        right={
          <ControlPill
            icon={Globe}
            badge={String(Math.max(tabs.length, 1))}
            label={t('Tabs')}
            size={44}
            onPress={() => setPanel('tabs')}
          />
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, paddingHorizontal: space.s }}>
        <ControlPill
          icon={ChevronLeft}
          label={t('Back')}
          disabled={!own || busy}
          onPress={() =>
            tab && void act(() => invoke(chat.computerId, 'hostBrowser.history', chat.taskId!, tab.id, 'back'))
          }
        />
        <ControlPill
          icon={ChevronRight}
          label={t('Forward')}
          disabled={!own || busy}
          onPress={() =>
            tab && void act(() => invoke(chat.computerId, 'hostBrowser.history', chat.taskId!, tab.id, 'forward'))
          }
        />
        <TextInput
          ref={addressField}
          accessibilityLabel={t('Address')}
          value={draft ?? (newTab ? '' : (tab?.url ?? ''))}
          onChangeText={setDraft}
          onBlur={() => {
            // A typed address is a draft and stays until it is opened or the tab changes; an empty one cancels.
            if (draftValue.current?.trim()) return
            setDraft(null)
            setNewTab(false)
          }}
          onSubmitEditing={submitAddress}
          editable={editable}
          placeholder={t('Search or enter a web address')}
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={Platform.OS === 'ios' ? 'web-search' : 'url'}
          returnKeyType="go"
          selectTextOnFocus
          numberOfLines={1}
          style={{
            flex: 1,
            minWidth: 0,
            height: 40,
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: theme.lineStrong,
            backgroundColor: theme.fill,
            paddingHorizontal: space.l,
            color: editable ? theme.text : theme.soft,
            fontSize: font.control + 1,
          }}
        />
        <ControlPill
          icon={RotateCw}
          label={t('Reload')}
          disabled={!own || busy}
          onPress={() =>
            tab && void act(() => invoke(chat.computerId, 'hostBrowser.history', chat.taskId!, tab.id, 'reload'))
          }
        />
        <ControlPill pillRef={menu.anchor} icon={Ellipsis} label={t('Browser options')} onPress={menu.open} />
      </View>
      {tab && state ? (
        <ControlStrip
          text={t(CONTROL_TEXT[state])}
          tone={state === 'disconnected' ? 'warn' : state === 'yours' ? 'accent' : 'muted'}
          action={
            nextControl && (nextControl === 'release' || browserAllowed)
              ? {
                  title: nextControl === 'release' ? t('Give back to agent') : t('Take control'),
                  disabled: busy || !active,
                  onPress: toggleControl,
                }
              : undefined
          }
        />
      ) : (
        <View style={{ height: space.s }} />
      )}
      {!browserAllowed && tab ? (
        <ViewerBanner>
          <PermissionNeeded computerId={chat.computerId} permission="browser" />
        </ViewerBanner>
      ) : null}
      {message ? (
        <ViewerBanner tone="bad" onDismiss={error ? () => setError('') : undefined} dismissLabel={t('Dismiss')}>
          <T size={font.control}>{t(viewerMessage(message))}</T>
          <RequestPermission computerId={chat.computerId} message={message} />
        </ViewerBanner>
      ) : null}
      {dialog && tab ? (
        <ViewerBanner tone="warn">
          <T>{dialog.message}</T>
          {dialog.type === 'prompt' && controlled ? (
            <TextInput
              accessibilityLabel={t('Website dialog answer')}
              value={dialogText}
              onChangeText={setDialogText}
              style={inputStyle}
            />
          ) : null}
          {controlled ? (
            <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
              {[false, true].map((accept) => (
                <Button
                  key={String(accept)}
                  kind={accept ? 'primary' : 'ghost'}
                  title={accept ? t('OK') : t('Cancel')}
                  disabled={busy}
                  onPress={() =>
                    void act(() =>
                      invoke(
                        chat.computerId,
                        'hostBrowser.answerDialog',
                        chat.taskId!,
                        tab.id,
                        dialog.id,
                        accept,
                        dialogText,
                      ),
                    )
                  }
                />
              ))}
            </View>
          ) : (
            <T tone="muted" size={font.caption}>
              {t('Take control to respond.')}
            </T>
          )}
        </ViewerBanner>
      ) : null}
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: theme.canvas }}
        onLayout={(event) => setArea(event.nativeEvent.layout)}
      >
        {frame && fitWidth > 0 ? (
          <View
            accessibilityRole="image"
            accessibilityLabel={t('Browser page on the execution host')}
            accessibilityHint={own ? t('Tap to click, hold to right-click, drag to scroll') : undefined}
            style={{ width: fitWidth, aspectRatio: aspect }}
          >
            <Image
              pointerEvents="none"
              source={{ uri: frame }}
              resizeMode="contain"
              style={{ width: '100%', height: '100%' }}
            />
            {/* One native hit target: image descendants must never change touch coordinates. */}
            <View
              {...pan.panHandlers}
              pointerEvents="box-only"
              collapsable={false}
              style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
            />
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.m }}>
            <Globe size={32} color={theme.muted} strokeWidth={1.5} />
            <T tone="muted" style={{ textAlign: 'center' }}>
              {tab ? t('Loading the page…') : t('Enter an address above to open a page.')}
            </T>
            <T tone="muted" size={font.caption} style={{ textAlign: 'center' }}>
              {t('Browser runs on the selected execution host. Sign-ins stay there.')}
            </T>
          </View>
        )}
        {own && tab ? (
          <View style={{ position: 'absolute', right: space.m, bottom: space.m }}>
            <ControlPill
              icon={KeyboardIcon}
              label={typing ? t('Hide keyboard') : t('Show keyboard')}
              selected={typing}
              size={48}
              onPress={() => (typing ? keyboard.current?.close() : keyboard.current?.open())}
            />
          </View>
        ) : null}
      </View>
      {own ? (
        <RemoteKeyboard
          handle={keyboard}
          label={t('Typing into the website')}
          onFocusChange={setTyping}
          onKeys={typeKeys}
        />
      ) : null}
      <ViewerMenu at={menu.at} onClose={menu.close} items={menuItems} label={t('Close menu')} />
      {/* Keys a phone keyboard lacks, and everyday shortcuts; the sheet stays open for several presses in a row. */}
      <Sheet open={panel === 'keys' && own} onClose={() => setPanel(null)} title={t('Keys and shortcuts')}>
        {(
          [
            ['Keys', SHORTCUTS.keys],
            ['Shortcuts', SHORTCUTS.shortcuts],
          ] as const
        ).map(([heading, entries]) => (
          <View key={heading} style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s }}>
            <T tone="muted" size={font.caption} weight="600">
              {t(heading)}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {entries.map((entry) => (
                <Button key={entry.id} kind="secondary" title={t(entry.label)} onPress={() => input(entry.input)} />
              ))}
            </View>
          </View>
        ))}
      </Sheet>
      <Sheet open={panel === 'search'} onClose={() => setPanel(null)} title={t('Search engine')}>
        <SheetGroup>
          {SEARCH_ENGINES.map((entry) => (
            <SheetOption
              key={entry.id}
              icon={Search}
              title={entry.name}
              selected={searchEngine === entry.id}
              onPress={() => store.setDraft(SEARCH_KEY, entry.id)}
            />
          ))}
          <SheetOption
            icon={Globe}
            title={t('Custom address')}
            selected={searchEngine === CUSTOM_SEARCH}
            onPress={() => store.setDraft(SEARCH_KEY, CUSTOM_SEARCH)}
          />
        </SheetGroup>
        {searchEngine === CUSTOM_SEARCH ? (
          <View style={{ paddingHorizontal: space.l, gap: space.s }}>
            <TextInput
              accessibilityLabel={t('Custom search address')}
              value={searchCustom}
              onChangeText={(value) => store.setDraft(SEARCH_CUSTOM_KEY, value.trim())}
              placeholder="https://example.com/search?q=%s"
              placeholderTextColor={theme.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={inputStyle}
            />
            <T tone="muted" size={font.caption}>
              {validSearchTemplate(searchCustom)
                ? t('Searches use this address.')
                : t('Use a web address with %s where the search words go. DuckDuckGo is used until then.')}
            </T>
          </View>
        ) : null}
      </Sheet>
      <Sheet open={panel === 'tabs'} onClose={() => setPanel(null)} title={t('Tabs')}>
        {tabs.length ? (
          <SheetGroup>
            {tabs.map((entry) => (
              <SheetOption
                key={entry.id}
                icon={Globe}
                title={tabTitle(entry, t)}
                help={`${entry.url}${entry.controller === 'agent' ? ` · ${t('Agent')}` : ''}`}
                selected={entry.id === tab?.id}
                onPress={() => selectTab(entry.id)}
              />
            ))}
          </SheetGroup>
        ) : (
          <T tone="muted" style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
            {t('No browser tabs in this thread.')}
          </T>
        )}
        <SheetGroup>
          <SheetOption icon={Plus} title={t('New tab')} onPress={startNewTab} />
        </SheetGroup>
      </Sheet>
      <Sheet open={panel === 'display'} onClose={() => setPanel(null)} title={t('Display')}>
        {hostManaged ? (
          <SheetPanelGroup title={t('Layout')}>
            <Segmented
              value={phoneLayout ? 'phone' : 'desktop'}
              onChange={(next) => store.setDraft(LAYOUT_KEY, next === 'desktop' ? 'desktop' : '')}
              options={[
                { key: 'phone', label: t('Phone') },
                { key: 'desktop', label: t('Desktop') },
              ]}
            />
          </SheetPanelGroup>
        ) : null}
        <SheetPanelGroup title={t('Appearance')}>
          <Segmented
            value={tab?.colorScheme ?? 'system'}
            onChange={(colorScheme) => adjust({ colorScheme })}
            options={[
              { key: 'system', label: t('System') },
              { key: 'light', label: t('Light') },
              { key: 'dark', label: t('Dark') },
            ]}
          />
        </SheetPanelGroup>
        <SheetPanelGroup title={t('Zoom')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <ControlPill
              icon={Minus}
              label={t('Zoom out')}
              disabled={busy || (tab?.zoom ?? 1) <= 0.5}
              onPress={() => adjust({ zoom: zoomStep(tab?.zoom ?? 1, -1) })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Actual size')}
              onPress={() => adjust({ zoom: 1 })}
              style={{ flex: 1, alignItems: 'center', paddingVertical: space.s }}
            >
              <T weight="600">{Math.round((tab?.zoom ?? 1) * 100)}%</T>
            </Pressable>
            <ControlPill
              icon={Plus}
              label={t('Zoom in')}
              disabled={busy || (tab?.zoom ?? 1) >= 3}
              onPress={() => adjust({ zoom: zoomStep(tab?.zoom ?? 1, 1) })}
            />
          </View>
        </SheetPanelGroup>
        <SheetGroup footer={t('Clears saved page files only. Sign-ins and cookies stay.')}>
          <SheetOption
            icon={Trash2}
            title={t('Clear cache')}
            disabled={busy}
            onPress={() => adjust({ clearCache: true })}
          />
        </SheetGroup>
      </Sheet>
      <Sheet open={panel === 'text'} onClose={() => setPanel(null)} title={t('Page text')}>
        <Card style={{ marginHorizontal: space.l, padding: space.m }}>
          {pageText ? (
            <T selectable copyable={pageText}>
              {pageText}
            </T>
          ) : (
            <T tone="muted">{busy ? t('Reading the page…') : t('This page has no readable text.')}</T>
          )}
        </Card>
      </Sheet>
      <Sheet open={panel === 'upload'} onClose={() => setPanel(null)} title={t('Upload a file')}>
        <View style={{ paddingHorizontal: space.l, gap: space.s }}>
          <TextInput
            accessibilityLabel={t('Upload from workspace path')}
            value={uploadPath}
            maxLength={4000}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUploadPath}
            placeholder={t('Workspace file path (up to 8 MiB)')}
            placeholderTextColor={theme.placeholder}
            style={inputStyle}
          />
          {observation && tab
            ? fileInputs.map((element) => (
                <Button
                  key={element.ref}
                  title={`${t('Upload')} · ${element.name || t('Website file input')}`}
                  disabled={busy || !uploadPath || !own}
                  onPress={() =>
                    void act(async () => {
                      const result = await invoke(
                        chat.computerId,
                        'hostBrowser.upload',
                        chat.taskId!,
                        tab.id,
                        tab.generation,
                        observation.snapshot,
                        element.ref,
                        uploadPath,
                      )
                      if (!result.ok) throw new Error(result.reason ?? 'Read the page again before uploading.')
                      setObservation(null)
                      setUploadPath('')
                      setPanel(null)
                    })
                  }
                />
              ))
            : null}
        </View>
      </Sheet>
      <Sheet open={downloadsOpen} onClose={() => setPanel(null)} title={t('Downloads')}>
        <View style={{ paddingHorizontal: space.l, gap: space.m }}>
          <T tone="muted" size={font.caption}>
            {t(
              'Downloads stay on the execution host. Save to a new file path in the workspace. Existing files are never overwritten.',
            )}
          </T>
          <Button
            kind="secondary"
            title={t('Allow next download')}
            disabled={!own || busy || !tab}
            onPress={() =>
              tab && void act(() => invoke(chat.computerId, 'hostBrowser.allowDownload', chat.taskId!, tab.id))
            }
          />
          {downloads.map((entry) => (
            <View key={entry.id} style={{ gap: space.s }}>
              <T>
                {entry.name} · {t(entry.state)} · {Math.ceil(entry.received / 1024)} KiB
              </T>
              {entry.state === 'completed' && (
                <>
                  <TextInput
                    accessibilityLabel={t('Save to workspace path')}
                    value={paths[entry.id] ?? entry.name}
                    maxLength={4000}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={inputStyle}
                    onChangeText={(value) => setPaths((paths) => ({ ...paths, [entry.id]: value }))}
                  />
                  <Button
                    title={t('Save')}
                    disabled={busy}
                    onPress={() =>
                      void act(async () => {
                        await invoke(
                          chat.computerId,
                          'hostBrowser.saveDownload',
                          chat.taskId!,
                          entry.id,
                          paths[entry.id] ?? entry.name,
                        )
                        setError(t('Saved to the thread workspace.'))
                      })
                    }
                  />
                </>
              )}
              <Button
                kind="ghost"
                title={entry.state === 'progressing' ? t('Cancel') : t('Remove')}
                disabled={busy}
                onPress={() =>
                  void act(() => invoke(chat.computerId, 'hostBrowser.cancelDownload', chat.taskId!, entry.id))
                }
              />
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  )
}
