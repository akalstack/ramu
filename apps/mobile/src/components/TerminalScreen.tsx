import { LiveBuffer } from '@ramu/shared/sync/streamSync'
import { translate, type TranslationValues } from '@ramu/shared/i18n'
import { useEffect, useRef, useState } from 'react'
import { Alert, Keyboard as NativeKeyboard, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FolderGit2, GitBranch, MessageCircle, RotateCcw, TerminalSquare } from 'lucide-react-native'
import { font, space, useTheme } from '../theme'
import { PermissionNeeded } from './DevicePermissions'
import { useStore } from '../runtime/store'
import { useOpenTerminalLink } from '../runtime/openFile'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import type { TerminalInfo } from '@ramu/shared/api'
import type { TerminalAttachment } from '@ramu/shared/chat/terminalContext'
import { captureScreen } from '../runtime/terminalChat'
import TerminalView from './TerminalView'
import { terminalFontSize } from '../runtime/terminalGesture'
import * as Clipboard from 'expo-clipboard'
import { DEFAULT_RAIL, parseRail, terminalKeyGroups, toggleRailKey } from '../runtime/terminalKeys'
import { STANDALONE, type Chat } from '../runtime/types'
import { TerminalDock } from './TerminalDock'
import { TerminalTabs } from './TerminalTabs'
import { Button, Sheet, T, tap } from './ui'
import { SheetGroup, SheetOption, SheetPanelGroup } from './SheetOptions'
import { useSay } from '../i18n'
import { showToast } from '../runtime/toast'

/** The terminal text size this phone remembers, whatever host or thread it shows. */
const TERMINAL_FONT_DEVICE_KEY = 'pref-device:terminalFontSize'

/** Where a shell runs: a chat's checkout, or a whole project's folders (`project:<id>` on the host). */
export interface TerminalTarget {
  computerId: string
  ctx: string
  kind: 'project' | 'worktree' | 'chat'
  title: string
  subtitle: string
  project: boolean
}

/**
 * The phone's terminal. Shells live on the computer, so leaving this screen or switching to another workspace never
 * closes them; a workspace with no shell gets one as soon as the screen opens.
 */
export function TerminalScreen({
  computerId,
  ctx: initialCtx,
  focus,
  onBack,
  onAddToChat,
}: {
  computerId: string
  ctx: string
  /** A shell to show first, such as the one a Run button typed into. */
  focus?: string
  onBack(): void
  /** Takes the rows on screen into the thread's message box; offered from a thread's own terminal. */
  onAddToChat?(attachment: TerminalAttachment): void
}) {
  const say = useSay()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const store = useStore()
  // Switching workspace happens here, in place: no new screen, and the sessions already seen show at once.
  const [ctx, setCtx] = useState(initialCtx)
  const chat = { computerId, taskId: ctx }
  const openTerminalLink = useOpenTerminalLink(computerId, ctx)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  // Which keys sit on the rail is a choice for this device, kept with the other device-local drafts.
  const rail = parseRail(store.drafts?.['terminal-rail'])
  const saveRail = (next: string[]) => store.setDraft('terminal-rail', JSON.stringify(next))
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const listRevision = useRef(0)
  const currentContext = useRef(initialCtx)
  currentContext.current = ctx
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyAction, setKeyAction] = useState<{ sequence: number; key: string }>()
  const [keyboardAction, setKeyboardAction] = useState({ sequence: 0, visible: false })
  useEffect(() => {
    const show = NativeKeyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setKeyboardVisible(true),
    )
    const hide = NativeKeyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboardVisible(false),
    )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const [latch, setLatch] = useState<'ctrl' | 'alt' | null>(null)
  // Changing the shell remounts the terminal view; if the keyboard was up it must come back up with the new one,
  // however it was raised (the dock button or a tap in the terminal).
  const keyboardBeforeSheet = useRef(false)
  const keepKeyboard = (up = keyboardVisible) => {
    if (up) setKeyboardAction((old) => ({ sequence: old.sequence + 1, visible: true }))
  }
  const [tabs, setTabs] = useState<TerminalInfo[]>([])
  const [active, setActive] = useState(0)
  const [output, setOutput] = useState('')
  // The text belongs to one shell; right after a tab change the view must not be handed the previous shell's.
  const [outputOwner, setOutputOwner] = useState<string>()
  const [error, setError] = useState('')
  const cursor = useRef(0)
  const size = useRef<{ cols: number; rows: number } | undefined>(undefined)
  const autoOpened = useRef(new Set<string>())
  const cache = useRef(new Map<string, { tabs: TerminalInfo[]; activeId: string | undefined }>())
  const activeId = useRef<string | undefined>(undefined)
  const focusId = useRef(focus)
  const keySequence = useRef(0)
  const terminal = tabs[active]
  const computer = store.computers.find((c) => c.id === chat?.computerId)
  // Without the host's Terminals permission the screen offers a request instead of a shell the host would refuse.
  const terminalAllowed = store.mayUse(computerId, 'terminal')
  const connected = computer?.status === 'online'
  const write = async (data: string) => {
    if (
      !chat ||
      !terminal ||
      terminal.exited ||
      store.computers.find((c) => c.id === chat.computerId)?.status !== 'online'
    )
      return
    try {
      await store.invoke(chat.computerId, 'term.write', terminal.id, data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const open = async () => {
    if (!chat || openingRef.current || !connected || computer?.access === 'viewer') return
    const context = ctx
    openingRef.current = true
    listRevision.current += 1
    setError('')
    keepKeyboard()
    setOpening(true)
    try {
      const term = await store.invoke(chat.computerId, 'term.open', chat.taskId, null, 80, 24)
      if (currentContext.current !== context) return
      setTabs((old) => (old.some((entry) => entry.id === term.id) ? old : [...old, term]))
      setActive(tabs.length)
      setKeyAction(undefined)
      setLatch(null)
      setSessionsOpen(false)
    } catch (e) {
      if (currentContext.current === context) setError(e instanceof Error ? e.message : String(e))
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }
  useEffect(() => {
    cache.current.set(ctx, { tabs, activeId: tabs[active]?.id })
    activeId.current = tabs[active]?.id
  }, [tabs, active, ctx])
  const switchTo = (target: TerminalTarget) => {
    tap()
    const cached = cache.current.get(target.ctx)
    activeId.current = cached?.activeId
    setCtx(target.ctx)
    setTabs(cached?.tabs ?? [])
    setActive(Math.max(0, cached?.tabs.findIndex((t) => t.id === cached.activeId) ?? 0))
    setOutput('')
    setKeyAction(undefined)
    setLatch(null)
    setError('')
  }
  // The host's list is the truth: it follows this workspace's shells opened or closed on the desktop, too.
  useEffect(() => {
    let alive = true
    const load = async (auto: boolean) => {
      const revision = listRevision.current
      // Managed commands have their own inspect/stop sheet; an ordinary shell tab must not adopt their handles.
      let list = (await store.invoke(computerId, 'term.list', ctx)).filter((terminal) => !terminal.background)
      if (!alive || revision !== listRevision.current) return
      if (
        !list.length &&
        auto &&
        !autoOpened.current.has(ctx) &&
        !openingRef.current &&
        computer?.access !== 'viewer' &&
        terminalAllowed
      ) {
        autoOpened.current.add(ctx)
        openingRef.current = true
        setOpening(true)
        try {
          list = [await store.invoke(computerId, 'term.open', ctx, null, 80, 24)]
        } finally {
          openingRef.current = false
          setOpening(false)
        }
      }
      if (!alive || (!list.length && openingRef.current)) return
      setTabs(list)
      setActive((previous) => {
        const index = list.findIndex((t) => t.id === (focusId.current ?? activeId.current))
        if (index >= 0) focusId.current = undefined
        return index >= 0 ? index : Math.min(previous, Math.max(0, list.length - 1))
      })
    }
    if (connected)
      load(true).catch((e) => {
        if (alive) setError(e.message)
      })
    const off = store.subscribe(computerId, (channel, value) => {
      if (channel === 'term:changed' && value.taskId === ctx) load(false).catch(() => {})
    })
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computerId, ctx, connected] by design; the values it reads beyond these are current as of that run
  }, [computerId, ctx, connected])
  const hostStatus = store.computers.find((c) => c.id === chat?.computerId)?.status
  useEffect(() => {
    if (!terminal) return
    let alive = true,
      hydrating = true
    // Chunks that arrive while a snapshot is loading wait here, bounded; past the bounds the snapshot is fetched again.
    const buffer = new LiveBuffer<{ data: string; cursor?: number }>(2000, 2_000_000)
    const append = (value: { data: string; cursor?: number }) => {
      if (value.cursor != null && value.cursor <= cursor.current) return
      const data =
        value.cursor != null
          ? value.data.slice(Math.max(0, cursor.current - (value.cursor - value.data.length)))
          : value.data
      cursor.current = value.cursor ?? cursor.current + data.length
      setOutput((old) => (old + data).slice(-256_000))
    }
    // `since` fetches only what this view has not shown; without it the view starts again from the held output.
    const hydrate = (since?: number) => {
      hydrating = true
      // An absent `since` must not be sent as an empty slot: it crosses the link as null, which no snapshot form accepts.
      const request =
        since === undefined
          ? store.invoke(chat.computerId, 'term.snapshot', terminal.id)
          : store.invoke(chat.computerId, 'term.snapshot', terminal.id, since)
      request
        .then((snapshot) => {
          if (!alive) return
          const queued = buffer.drain()
          if (since === undefined || snapshot.resume === 'snapshot') {
            cursor.current = snapshot.cursor
            setOutput(snapshot.output)
          } else append({ data: snapshot.output, cursor: snapshot.cursor })
          hydrating = false
          if (queued) queued.forEach(append)
          else hydrate(cursor.current)
          setError('')
        })
        .catch((e) => {
          if (alive) setError(e.message)
        })
    }
    const off = store.subscribe(chat.computerId, (channel, value) => {
      if (channel !== 'term:data' && channel !== 'term:behind' && channel !== 'term:exit') return
      if (value.id !== terminal.id) return
      if (channel === 'term:data') {
        if (hydrating) buffer.push({ seq: 0, size: value.data.length, value })
        else append(value)
      }
      // The host held output back from a slow connection: fetch the gap from where this view stopped.
      if (channel === 'term:behind' && !hydrating) hydrate(cursor.current)
      if (channel === 'term:exit') setTabs((old) => old.map((t) => (t.id === value.id ? { ...t, exited: true } : t)))
    })
    // Terminal output reaches the phone only while a terminal is on screen.
    const unwatch = store.watch(chat.computerId, ['term:data', 'term:behind'], {
      'term:data': [terminal.id],
      'term:behind': [terminal.id],
    })
    setOutput('')
    setOutputOwner(terminal.id)
    cursor.current = 0
    hydrate()
    return () => {
      alive = false
      off()
      unwatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [chat?.computerId, terminal?.id, hostStatus] by design; the values it reads beyond these are current as of that run
  }, [chat?.computerId, terminal?.id, hostStatus])
  // The view stays mounted across tabs, so it will not report its size again; hand the new shell the one on screen.
  useEffect(() => {
    if (terminal && !terminal.exited && connected && size.current)
      void store.invoke(computerId, 'term.resize', terminal.id, size.current.cols, size.current.rows).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [terminal?.id, connected] by design; the values it reads beyond these are current as of that run
  }, [terminal?.id, connected])
  const press = async (label: string) => {
    tap()
    if (label === 'ctrl' || label === 'alt') return setLatch((old) => (old === label ? null : label))
    if (label !== 'paste') {
      setKeyAction({ sequence: ++keySequence.current, key: label })
      return
    }
    // iOS answers '' (or rejects) when the person denied Paste from Other Apps, so an empty read needs a word.
    let text = await Clipboard.getStringAsync().catch(() => '')
    if (!text) {
      setLatch(null)
      showToast(
        Platform.OS === 'ios'
          ? say(
              'Nothing to paste. If the clipboard has text, allow Ramu to paste in Settings → Ramu → Paste from Other Apps.',
            )
          : say('Nothing to paste.'),
      )
      return
    }
    if (latch === 'ctrl' && text.length === 1) text = String.fromCharCode(text.toUpperCase().charCodeAt(0) & 31)
    else if (latch === 'alt') text = '\x1b' + text
    setLatch(null)
    if (label === 'paste' && /[\r\n]/.test(text))
      Alert.alert(say('Paste into host terminal?'), text.slice(0, 1000), [
        { text: say('Cancel'), style: 'cancel' },
        { text: say('Paste'), onPress: () => void write('\x1b[200~' + text + '\x1b[201~') },
      ])
    else void write(text)
  }

  const close = async (value: TerminalInfo) => {
    const wasUp = keyboardVisible // a confirmation dialog hides the keyboard before the answer
    const remove = () => {
      keepKeyboard(wasUp)
      void store
        .invoke(chat.computerId, 'term.close', value.id)
        .then(() => {
          setTabs((old) => old.filter((t) => t.id !== value.id))
          setActive(0)
          setKeyAction(undefined)
          setLatch(null)
        })
        .catch((e) => setError(e.message))
    }
    // An idle prompt or an ended session closes at once; only a running command asks first.
    const running =
      !value.exited &&
      (await store.invoke(chat.computerId, 'term.busy', [value.id]).then(
        (count) => count > 0,
        () => true,
      ))
    if (!running) return remove()
    Alert.alert(
      say('Stop the running command?'),
      `${value.cwd}\n\n${say('Closing this terminal ends what is running in it.')}`,
      [
        { text: say('Cancel'), style: 'cancel' },
        { text: say('Close terminal'), style: 'destructive', onPress: remove },
      ],
    )
  }
  const toggleKeyboard = () => {
    const visible = !keyboardVisible
    setKeyboardVisible(visible)
    setKeyboardAction((old) => ({ sequence: old.sequence + 1, visible }))
    if (!visible) NativeKeyboard.dismiss()
  }
  const targets = terminalTargets(store, computerId)
  const directory = terminal?.cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || (terminal ? '/' : undefined)
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.terminal,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {error ? (
          <T tone="bad" style={{ padding: space.m }}>
            {error}
          </T>
        ) : null}
        <View style={{ flex: 1, paddingHorizontal: 6, paddingTop: 4 }}>
          {!terminal ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
              <TerminalSquare size={32} color="#a1a1a8" strokeWidth={1.5} />
              <T size={font.heading} weight="600" style={{ color: '#f5f5f7' }}>
                {say('Your host’s shell')}
              </T>
              <T size={font.control} style={{ color: '#a1a1a8', textAlign: 'center', lineHeight: 20 }}>
                {computer?.access === 'viewer'
                  ? say('This phone has view-only access to this host.')
                  : connected
                    ? say('Open a session to run commands in this workspace.')
                    : say('Reconnect to this host to open a terminal.')}
              </T>
              {computer?.access !== 'viewer' && !terminalAllowed ? (
                <PermissionNeeded computerId={computerId} permission="terminal" />
              ) : (
                <Button
                  title={opening ? say('Opening terminal…') : say('New terminal')}
                  disabled={opening || !connected || computer?.access === 'viewer'}
                  onPress={() => void open()}
                />
              )}
            </View>
          ) : (
            <TerminalView
              enabled={!terminal.exited && connected}
              keyboardAction={keyboardAction}
              keyAction={keyAction}
              session={terminal.id}
              output={outputOwner === terminal.id ? output : ''}
              fontSize={terminalFontSize(store.drafts?.[TERMINAL_FONT_DEVICE_KEY])}
              onLink={(kind, text) => void openTerminalLink(kind, text, terminal.cwd)}
              onFontSize={(next) => store.setDraft(TERMINAL_FONT_DEVICE_KEY, String(terminalFontSize(next)))}
              onInput={(data) => {
                if (latch === 'ctrl' && data.length === 1)
                  data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31)
                else if (latch === 'alt') data = '\x1b' + data
                setLatch(null)
                void write(data)
              }}
              onResize={(cols, rows) => {
                if (cols >= 2 && rows >= 2) size.current = { cols, rows }
                if (chat && connected && cols >= 2 && rows >= 2)
                  void store
                    .invoke(chat.computerId, 'term.resize', terminal.id, cols, rows)
                    .catch((e) => setError(e.message))
              }}
            />
          )}
        </View>
        <TerminalTabs
          tabs={tabs}
          active={active}
          busy={opening || !connected || computer?.access === 'viewer' || !terminalAllowed}
          onNew={() => void open()}
          onSelect={(index) => {
            tap()
            keepKeyboard()
            setActive(index)
            setKeyAction(undefined)
            setLatch(null)
          }}
          onClose={(value) => void close(value)}
        />
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 8,
            paddingBottom: keyboardVisible ? 6 : Math.max(insets.bottom, 10),
          }}
        >
          <TerminalDock
            workspace={targets.find((target) => target.ctx === ctx)?.title ?? say('Terminal')}
            kind={targets.find((target) => target.ctx === ctx)?.kind}
            detail={
              targets.find((target) => target.ctx === ctx)?.kind === 'worktree'
                ? targets.find((target) => target.ctx === ctx)?.subtitle
                : undefined
            }
            computer={computer?.name ?? say('Terminal')}
            directory={directory}
            hasShell={tabs.length > 0}
            exited={terminal?.exited}
            connected={connected}
            keyboardVisible={keyboardVisible}
            latch={latch}
            rail={rail}
            onBack={onBack}
            {...(onAddToChat
              ? {
                  onAddToChat: () => {
                    const shown = terminal && outputOwner === terminal.id ? output : ''
                    const attachment = captureScreen(
                      shown,
                      size.current?.rows ?? 40,
                      say('Shell {0}', { 0: active + 1 }),
                      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    )
                    if (!attachment) return setError(say('Nothing on screen to add yet.'))
                    onAddToChat(attachment)
                  },
                }
              : {})}
            onWorkspace={() => {
              keyboardBeforeSheet.current = keyboardVisible
              setKeyboardVisible(false)
              NativeKeyboard.dismiss()
              setKeyboardAction((old) => ({ sequence: old.sequence + 1, visible: false }))
              setSessionsOpen(true)
            }}
            onMoreKeys={() => {
              NativeKeyboard.dismiss()
              setKeyboardVisible(false)
              setKeyboardAction((old) => ({ sequence: old.sequence + 1, visible: false }))
              setKeysOpen(true)
            }}
            onKeyboard={toggleKeyboard}
            onKey={(label) => {
              void press(label)
              setKeyboardAction((old) => ({ sequence: old.sequence + 1, visible: true }))
            }}
          />
        </View>
      </KeyboardAvoidingView>
      <Sheet
        open={sessionsOpen}
        title={say('Workspace')}
        onClose={() => {
          setSessionsOpen(false)
          keepKeyboard(keyboardBeforeSheet.current)
        }}
      >
        {(['project', 'worktree', 'chat'] as const).map((kind) => {
          const group = targets.filter((target) => target.kind === kind)
          if (!group.length) return null
          return (
            <SheetGroup
              key={kind}
              title={say(kind === 'project' ? 'Projects' : kind === 'worktree' ? 'Worktrees' : 'Threads')}
            >
              {group.map((target) => (
                <SheetOption
                  key={target.ctx}
                  icon={kind === 'worktree' ? GitBranch : kind === 'chat' ? MessageCircle : FolderGit2}
                  title={target.title}
                  help={target.subtitle}
                  selected={target.ctx === ctx}
                  onPress={() => {
                    setSessionsOpen(false)
                    if (target.ctx !== ctx) switchTo(target)
                    keepKeyboard(keyboardBeforeSheet.current)
                  }}
                />
              ))}
            </SheetGroup>
          )
        })}
        <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s }}>
          {say('Shells keep running in their own workspace while you look at another.')}
        </T>
      </Sheet>
      <Sheet open={keysOpen} title={say('Terminal keys')} onClose={() => setKeysOpen(false)}>
        {rail.join() !== DEFAULT_RAIL.join() ? (
          <SheetGroup>
            <SheetOption
              icon={RotateCcw}
              title={say('Reset key rail')}
              help={say('Go back to the default keys on the rail.')}
              onPress={() => store.setDraft('terminal-rail', '')}
            />
          </SheetGroup>
        ) : null}
        {terminalKeyGroups.map((group) => (
          <SheetPanelGroup key={group.title} title={say(group.title)}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {group.keys.map((label) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={
                    rail.includes(label)
                      ? say('On the key rail. Long press to remove it.')
                      : say('Long press to add it to the key rail.')
                  }
                  accessibilityState={{ selected: rail.includes(label) }}
                  onPress={() => void press(label)}
                  onLongPress={() => saveRail(toggleRailKey(rail, label))}
                  style={({ pressed }) => ({
                    minWidth: 52,
                    height: 44,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? c.pressed : rail.includes(label) ? c.accentWash : c.fill,
                  })}
                >
                  <T mono size={font.control}>
                    {label}
                  </T>
                </Pressable>
              ))}
            </View>
          </SheetPanelGroup>
        ))}
        <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s }}>
          {say(
            'Press a key to send it. Long press to add or remove it on the key rail; highlighted keys are on the rail.',
          )}
        </T>
      </Sheet>
    </View>
  )
}

/**
 * The context a chat's shells belong to, as on the desktop: the project's folders, an isolated worktree, or the
 * chat itself when it has no project. Chats sharing a checkout share its terminal sessions.
 */
export function terminalCtx(chat: Pick<Chat, 'taskId' | 'projectId' | 'workspaceId'>): string {
  if (chat.projectId === STANDALONE) return chat.taskId
  if (chat.workspaceId) return `worktree:${chat.workspaceId}`
  return `project:${chat.projectId.slice(chat.projectId.indexOf(':') + 1)}`
}

/** Every place a shell can run on this computer: each project's folders, each isolated worktree, each project-less chat. */
export function terminalTargets(store: ReturnType<typeof useStore>, computerId: string): TerminalTarget[] {
  const say = (text: string, values?: TranslationValues) => translate(store.language, text, values)
  const targets = store.projects
    .filter((p) => p.computerId === computerId)
    .map<TerminalTarget>((p) => ({
      computerId,
      ctx: `project:${p.id.slice(p.id.indexOf(':') + 1)}`,
      kind: 'project',
      title: p.name,
      subtitle: p.kind === 'workspace' ? say('Workspace · {0} repos', { 0: p.repos.length }) : say('Project folder'),
      project: true,
    }))
  const seen = new Set(targets.map((t) => t.ctx))
  for (const chat of store.chats) {
    if (chat.computerId !== computerId || !chat.taskId || chat.pending || chat.status === 'archived') continue
    const ctx = terminalCtx(chat)
    if (seen.has(ctx)) continue
    seen.add(ctx)
    const project = store.projects.find((p) => p.id === chat.projectId)?.name
    // A worktree is named by its project and told apart by its branch, which is what says which checkout you are in.
    targets.push(
      chat.projectId === STANDALONE
        ? {
            computerId,
            ctx,
            kind: 'chat',
            title: chat.title,
            subtitle: say('Thread without a project'),
            project: false,
          }
        : {
            computerId,
            ctx,
            kind: 'worktree',
            title: project ?? say('Workspace'),
            subtitle: chat.branch || chat.title,
            project: true,
          },
    )
  }
  return targets
}
