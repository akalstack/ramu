import { useEffect, useRef, useState } from 'react'
import { Alert, Keyboard as NativeKeyboard, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Folder, Plus, TerminalSquare, X } from 'lucide-react-native'
import { space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import type { TerminalInfo } from '@ramu/shared/api'
import TerminalView from '../../../components/TerminalView'
import * as Clipboard from 'expo-clipboard'
import { terminalKeyGroups } from '../../../runtime/terminalKeys'
import { STANDALONE } from '../../../runtime/types'
import { TerminalDock } from '../../../components/TerminalDock'
import { GlassSurfaceProvider } from '../../../components/Glass'
import { IconButton, Row, SectionLabel, Sheet, T, tap } from '../../../components/ui'

export default function Terminal() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <TerminalSession key={id} id={id} />
}

function TerminalSession({ id }: { id: string }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const chat = useChat(id)
  const store = useStore()
  const router = useRouter()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyAction, setKeyAction] = useState<{ sequence: number; key: string }>()
  const [keyboardAction, setKeyboardAction] = useState({ sequence: 0, visible: false })
  useEffect(() => {
    const show = NativeKeyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true))
    const hide = NativeKeyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  const [latch, setLatch] = useState<'ctrl' | 'alt' | null>(null)
  const [tabs, setTabs] = useState<TerminalInfo[]>([])
  const [active, setActive] = useState(0)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const cursor = useRef(0)
  const keySequence = useRef(0)
  const terminal = tabs[active]
  const computer = store.computers.find(c => c.id === chat?.computerId)
  const connected = computer?.status === 'online'
  const write = async (data: string) => {
    if (!chat || !terminal || terminal.exited || store.computers.find(c => c.id === chat.computerId)?.status !== 'online') return
    try { await store.invoke(chat.computerId, 'term.write', terminal.id, data) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const open = async () => {
    if (!chat || opening || !connected) return
    setOpening(true)
    try { const term = await store.invoke(chat.computerId, 'term.open', chat.taskId, null, 80, 24); setTabs(old => [...old, term]); setActive(tabs.length); setKeyAction(undefined); setLatch(null); setSessionsOpen(false) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOpening(false) }
  }
  useEffect(() => {
    let alive = true
    if (chat?.taskId) store.invoke(chat.computerId, 'term.list', chat.taskId).then(list => { if (alive) { setTabs(list); setActive(0); setKeyAction(undefined); setLatch(null) } }).catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [chat?.computerId, chat?.taskId, store.computers.find(c => c.id === chat?.computerId)?.status])
  useEffect(() => {
    if (!chat || !terminal) return
    let alive = true, hydrating = true
    const buffer: { data: string; cursor?: number }[] = []
    const append = (value: { data: string; cursor?: number }) => {
      if (value.cursor != null && value.cursor <= cursor.current) return
      const data = value.cursor != null ? value.data.slice(Math.max(0, cursor.current - (value.cursor - value.data.length))) : value.data
      cursor.current = value.cursor ?? cursor.current + data.length
      setOutput(old => (old + data).slice(-256_000))
    }
    const off = store.subscribe(chat.computerId, (channel, value) => {
      if (value.id !== terminal.id) return
      if (channel === 'term:data') { if (hydrating) buffer.push(value); else append(value) }
      if (channel === 'term:exit') setTabs(old => old.map(t => t.id === value.id ? { ...t, exited: true } : t))
    })
    setOutput(''); cursor.current = 0
    store.invoke(chat.computerId, 'term.snapshot', terminal.id).then(snapshot => { if (!alive) return; cursor.current = snapshot.cursor; setOutput(snapshot.output); hydrating = false; buffer.forEach(append); setError('') }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false; off() }
  }, [chat?.computerId, terminal?.id, store.computers.find(c => c.id === chat?.computerId)?.status])
  const press = async (label: string) => {
    tap()
    if (label === 'ctrl' || label === 'alt') return setLatch(old => old === label ? null : label)
    if (label !== 'paste') { setKeyAction({ sequence: ++keySequence.current, key: label }); return }
    let text = await Clipboard.getStringAsync()
    if (latch === 'ctrl' && text.length === 1) text = String.fromCharCode(text.toUpperCase().charCodeAt(0) & 31)
    else if (latch === 'alt') text = '\x1b' + text
    setLatch(null)
    if (label === 'paste' && /[\r\n]/.test(text)) Alert.alert('Paste into host terminal?', text.slice(0, 1000), [{ text: 'Cancel', style: 'cancel' }, { text: 'Paste', onPress: () => void write('\x1b[200~' + text + '\x1b[201~') }])
    else void write(text)
  }

  const close = (value: TerminalInfo) => {
    if (!chat) return
    Alert.alert('Close terminal?', value.cwd, [{ text: 'Cancel', style: 'cancel' }, { text: 'Close', style: 'destructive', onPress: () => {
      void store.invoke(chat.computerId, 'term.close', value.id).then(() => {
        setTabs(old => old.filter(t => t.id !== value.id)); setActive(0); setKeyAction(undefined); setLatch(null)
      }).catch(e => setError(e.message))
    } }])
  }
  const toggleKeyboard = () => {
    const visible = !keyboardVisible
    setKeyboardVisible(visible)
    setKeyboardAction(old => ({ sequence: old.sequence + 1, visible }))
    if (!visible) NativeKeyboard.dismiss()
  }
  const directory = terminal?.cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || (terminal ? '/' : undefined)
  return <GlassSurfaceProvider><View style={{ flex: 1, backgroundColor: c.terminal, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
    <Stack.Screen options={{ headerShown: false }} />
    <StatusBar style="light" />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {error ? <T tone="bad" style={{ padding: space.m }}>{error}</T> : null}
      <View style={{ flex: 1, paddingHorizontal: 6, paddingTop: 4 }}>
        {!terminal ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <TerminalSquare size={32} color="#a1a1a8" strokeWidth={1.5} />
          <T size={17} weight="600" style={{ color: '#f5f5f7' }}>Your computer’s shell</T>
          <T size={13} style={{ color: '#a1a1a8', textAlign: 'center', lineHeight: 20 }}>Open a session to run commands in this workspace.</T>
        </View> : <TerminalView enabled={!terminal.exited && connected} keyboardAction={keyboardAction} keyAction={keyAction} key={terminal.id} output={output} onInput={data => {
          if (latch === 'ctrl' && data.length === 1) data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31)
          else if (latch === 'alt') data = '\x1b' + data
          setLatch(null); void write(data)
        }} onResize={(cols, rows) => { if (chat && connected && cols >= 2 && rows >= 2) void store.invoke(chat.computerId, 'term.resize', terminal.id, cols, rows).catch(e => setError(e.message)) }} />}
      </View>
      <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: keyboardVisible ? 6 : Math.max(insets.bottom, 10) }}>
        <TerminalDock computer={computer?.name ?? 'Terminal'} directory={directory} count={tabs.length} exited={terminal?.exited} connected={connected} busy={opening} keyboardVisible={keyboardVisible} latch={latch} onBack={() => router.dismissTo({ pathname: '/chat/[id]', params: { id } })} onSessions={() => { setKeyboardVisible(false); NativeKeyboard.dismiss(); setKeyboardAction(old => ({ sequence: old.sequence + 1, visible: false })); setSessionsOpen(true) }} onNew={() => void open()} onClose={terminal ? () => close(terminal) : undefined} onMoreKeys={() => { NativeKeyboard.dismiss(); setKeyboardVisible(false); setKeyboardAction(old => ({ sequence: old.sequence + 1, visible: false })); setKeysOpen(true) }} onKeyboard={toggleKeyboard} onKey={label => { void press(label); setKeyboardAction(old => ({ sequence: old.sequence + 1, visible: true })) }} />
      </View>
    </KeyboardAvoidingView>
    <Sheet open={sessionsOpen} title="Terminal sessions" onClose={() => setSessionsOpen(false)}>
      {tabs.map((value, index) => <Row key={value.id} onPress={() => { tap(); setActive(index); setKeyAction(undefined); setLatch(null); setSessionsOpen(false) }}>
        <TerminalSquare size={19} color={c.accent} />
        <View style={{ flex: 1, gap: 3 }}><T numberOfLines={1} weight="500">{value.exited ? 'Session ended' : `Shell ${index + 1}`}</T><T numberOfLines={1} size={12} tone="muted">{value.cwd}</T></View>
        {index === active ? <Check size={18} color={c.accent} /> : null}
        <IconButton icon={X} label={`Close shell ${index + 1}`} onPress={() => close(value)} />
      </Row>)}
      <Row onPress={() => void open()} disabled={opening || !connected}><Plus size={19} color={c.accent} /><T tone="accent">{opening ? 'Opening shell…' : 'New terminal'}</T></Row>
      <SectionLabel>Switch workspace</SectionLabel>
      <T size={12} tone="muted" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Existing shells keep running in their own workspace.</T>
      {store.chats.filter(other => other.computerId === chat?.computerId && other.taskId && !other.pending && other.status !== 'archived').map(other => <Row key={other.id} onPress={() => {
        setSessionsOpen(false)
        if (other.id !== id) router.replace({ pathname: '/chat/[id]/terminal', params: { id: other.id } })
      }}>
        <Folder size={18} color={c.accent} /><View style={{ flex: 1, gap: 3 }}><T numberOfLines={1} weight="500">{other.title}</T><T size={12} tone="muted" numberOfLines={1}>{store.projects.find(project => project.id === other.projectId)?.name ?? (other.projectId === STANDALONE ? 'Standalone' : 'Workspace')} · {other.mode === 'worktree' ? 'Worktree' : 'Project folders'}</T></View>{other.id === id ? <Check size={18} color={c.accent} /> : null}
      </Row>)}
    </Sheet>
    <Sheet open={keysOpen} title="Terminal keys" onClose={() => setKeysOpen(false)}>
      {terminalKeyGroups.map(group => <View key={group.title}><SectionLabel>{group.title}</SectionLabel><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16 }}>{group.keys.map(label => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => void press(label)} style={({ pressed }) => ({ minWidth: 52, height: 44, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.pressed : c.fill })}><T mono size={13}>{label}</T></Pressable>)}</View></View>)}
    </Sheet>
  </View></GlassSurfaceProvider>
}
