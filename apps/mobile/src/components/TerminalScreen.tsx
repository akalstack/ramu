import { useEffect, useRef, useState } from 'react'
import { Alert, Keyboard as NativeKeyboard, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, FolderGit2, GitBranch, MessageCircle, TerminalSquare } from 'lucide-react-native'
import { space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import type { TerminalInfo } from '@ramu/shared/api'
import TerminalView from './TerminalView'
import * as Clipboard from 'expo-clipboard'
import { terminalKeyGroups } from '../runtime/terminalKeys'
import { STANDALONE, type Chat } from '../runtime/types'
import { TerminalDock } from './TerminalDock'
import { TerminalTabs } from './TerminalTabs'
import { GlassSurfaceProvider } from './Glass'
import { Row, SectionLabel, Sheet, T, tap } from './ui'

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
  onBack,
}: {
  computerId: string
  ctx: string
  onBack(): void
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const store = useStore()
  // Switching workspace happens here, in place: no new screen, and the sessions already seen show at once.
  const [ctx, setCtx] = useState(initialCtx)
  const chat = { computerId, taskId: ctx }
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [opening, setOpening] = useState(false)
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
  const keySequence = useRef(0)
  const terminal = tabs[active]
  const computer = store.computers.find((c) => c.id === chat?.computerId)
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
    if (!chat || opening || !connected) return
    keepKeyboard()
    setOpening(true)
    try {
      const term = await store.invoke(chat.computerId, 'term.open', chat.taskId, null, 80, 24)
      setTabs((old) => [...old, term])
      setActive(tabs.length)
      setKeyAction(undefined)
      setLatch(null)
      setSessionsOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
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
      let list = await store.invoke(computerId, 'term.list', ctx)
      if (!alive) return
      if (!list.length && auto && !autoOpened.current.has(ctx)) {
        autoOpened.current.add(ctx)
        list = [await store.invoke(computerId, 'term.open', ctx, null, 80, 24)]
      }
      if (!alive) return
      setTabs(list)
      setActive((previous) => {
        const index = list.findIndex((t) => t.id === activeId.current)
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
  }, [computerId, ctx, connected])
  useEffect(() => {
    if (!terminal) return
    let alive = true,
      hydrating = true
    const buffer: { data: string; cursor?: number }[] = []
    const append = (value: { data: string; cursor?: number }) => {
      if (value.cursor != null && value.cursor <= cursor.current) return
      const data =
        value.cursor != null
          ? value.data.slice(Math.max(0, cursor.current - (value.cursor - value.data.length)))
          : value.data
      cursor.current = value.cursor ?? cursor.current + data.length
      setOutput((old) => (old + data).slice(-256_000))
    }
    const off = store.subscribe(chat.computerId, (channel, value) => {
      if (value.id !== terminal.id) return
      if (channel === 'term:data') {
        if (hydrating) buffer.push(value)
        else append(value)
      }
      if (channel === 'term:exit') setTabs((old) => old.map((t) => (t.id === value.id ? { ...t, exited: true } : t)))
    })
    setOutput('')
    setOutputOwner(terminal.id)
    cursor.current = 0
    store
      .invoke(chat.computerId, 'term.snapshot', terminal.id)
      .then((snapshot) => {
        if (!alive) return
        cursor.current = snapshot.cursor
        setOutput(snapshot.output)
        hydrating = false
        buffer.forEach(append)
        setError('')
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
      off()
    }
  }, [chat?.computerId, terminal?.id, store.computers.find((c) => c.id === chat?.computerId)?.status])
  // The view stays mounted across tabs, so it will not report its size again; hand the new shell the one on screen.
  useEffect(() => {
    if (terminal && !terminal.exited && connected && size.current)
      void store.invoke(computerId, 'term.resize', terminal.id, size.current.cols, size.current.rows).catch(() => {})
  }, [terminal?.id, connected])
  const press = async (label: string) => {
    tap()
    if (label === 'ctrl' || label === 'alt') return setLatch((old) => (old === label ? null : label))
    if (label !== 'paste') {
      setKeyAction({ sequence: ++keySequence.current, key: label })
      return
    }
    let text = await Clipboard.getStringAsync()
    if (latch === 'ctrl' && text.length === 1) text = String.fromCharCode(text.toUpperCase().charCodeAt(0) & 31)
    else if (latch === 'alt') text = '\x1b' + text
    setLatch(null)
    if (label === 'paste' && /[\r\n]/.test(text))
      Alert.alert('Paste into host terminal?', text.slice(0, 1000), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Paste', onPress: () => void write('\x1b[200~' + text + '\x1b[201~') },
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
    Alert.alert('Stop the running command?', `${value.cwd}\n\nClosing this terminal ends what is running in it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close terminal', style: 'destructive', onPress: remove },
    ])
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
    <GlassSurfaceProvider>
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
                <T size={17} weight="600" style={{ color: '#f5f5f7' }}>
                  Your computer’s shell
                </T>
                <T size={13} style={{ color: '#a1a1a8', textAlign: 'center', lineHeight: 20 }}>
                  Open a session to run commands in this workspace.
                </T>
              </View>
            ) : (
              <TerminalView
                enabled={!terminal.exited && connected}
                keyboardAction={keyboardAction}
                keyAction={keyAction}
                session={terminal.id}
                output={outputOwner === terminal.id ? output : ''}
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
          {tabs.length ? (
            <TerminalTabs
              tabs={tabs}
              active={active}
              busy={opening || !connected}
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
          ) : null}
          <View
            style={{
              paddingHorizontal: 10,
              paddingTop: 8,
              paddingBottom: keyboardVisible ? 6 : Math.max(insets.bottom, 10),
            }}
          >
            <TerminalDock
              workspace={targets.find((target) => target.ctx === ctx)?.title ?? 'Terminal'}
              kind={targets.find((target) => target.ctx === ctx)?.kind}
              detail={
                targets.find((target) => target.ctx === ctx)?.kind === 'worktree'
                  ? targets.find((target) => target.ctx === ctx)?.subtitle
                  : undefined
              }
              computer={computer?.name ?? 'Terminal'}
              directory={directory}
              hasShell={tabs.length > 0}
              exited={terminal?.exited}
              connected={connected}
              keyboardVisible={keyboardVisible}
              latch={latch}
              onBack={onBack}
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
          title="Workspace"
          onClose={() => {
            setSessionsOpen(false)
            keepKeyboard(keyboardBeforeSheet.current)
          }}
        >
          <T size={12} tone="muted" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            Shells keep running in their own workspace while you look at another.
          </T>
          {(['project', 'worktree', 'chat'] as const).map((kind) => {
            const group = targets.filter((target) => target.kind === kind)
            if (!group.length) return null
            return (
              <View key={kind}>
                <SectionLabel>
                  {kind === 'project' ? 'Projects' : kind === 'worktree' ? 'Worktrees' : 'Chats'}
                </SectionLabel>
                {group.map((target) => {
                  const current = target.ctx === ctx
                  return (
                    <Row
                      key={target.ctx}
                      onPress={() => {
                        setSessionsOpen(false)
                        if (!current) switchTo(target)
                        keepKeyboard(keyboardBeforeSheet.current)
                      }}
                      style={current ? { backgroundColor: c.accentWash } : undefined}
                    >
                      {kind === 'worktree' ? (
                        <GitBranch size={18} color={c.accent} />
                      ) : kind === 'chat' ? (
                        <MessageCircle size={18} color={c.accent} />
                      ) : (
                        <FolderGit2 size={18} color={c.accent} />
                      )}
                      <View style={{ flex: 1, gap: 3 }}>
                        <T numberOfLines={1} weight={current ? '600' : '500'}>
                          {target.title}
                        </T>
                        <T size={12} tone="muted" numberOfLines={1} mono={kind === 'worktree'}>
                          {target.subtitle}
                        </T>
                      </View>
                      {current ? <Check size={18} color={c.accent} /> : null}
                    </Row>
                  )
                })}
              </View>
            )
          })}
        </Sheet>
        <Sheet open={keysOpen} title="Terminal keys" onClose={() => setKeysOpen(false)}>
          {terminalKeyGroups.map((group) => (
            <View key={group.title}>
              <SectionLabel>{group.title}</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16 }}>
                {group.keys.map((label) => (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    onPress={() => void press(label)}
                    style={({ pressed }) => ({
                      minWidth: 52,
                      height: 44,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed ? c.pressed : c.fill,
                    })}
                  >
                    <T mono size={13}>
                      {label}
                    </T>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </Sheet>
      </View>
    </GlassSurfaceProvider>
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
  const targets = store.projects
    .filter((p) => p.computerId === computerId)
    .map<TerminalTarget>((p) => ({
      computerId,
      ctx: `project:${p.id.slice(p.id.indexOf(':') + 1)}`,
      kind: 'project',
      title: p.name,
      subtitle: p.kind === 'workspace' ? `Workspace · ${p.repos.length} repos` : 'Project folder',
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
        ? { computerId, ctx, kind: 'chat', title: chat.title, subtitle: 'Chat without a project', project: false }
        : {
            computerId,
            ctx,
            kind: 'worktree',
            title: project ?? 'Workspace',
            subtitle: chat.branch || chat.title,
            project: true,
          },
    )
  }
  return targets
}

const KIND_LABEL = { project: 'Project', worktree: 'Worktree', chat: 'Chat' } as const
export const kindLabel = (kind: TerminalTarget['kind']) => KIND_LABEL[kind]
