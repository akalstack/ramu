import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, FlatList, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowDown, Check, CircleArrowUp, CircleCheck, GitBranch, GitCompareArrows, Monitor, SquareTerminal } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { commitAndPush, pushBranch } from '../../../runtime/gitQuick'
import { foldTurns } from '../../../runtime/turns'
import { STANDALONE } from '../../../runtime/types'
import { Header, HeaderButton, HeaderMenu, Screen, PageFlatList, type HeaderMenuItem } from '../../../components/Screen'
import { Composer } from '../../../components/Composer'
import { TranscriptItemView } from '../../../components/Transcript'
import { ConnectionDot, Row, Sheet, T, tap } from '../../../components/ui'
import { BottomFade, Glass, floatingChrome } from '../../../components/Glass'
import { OfflineBanner, PendingBubble } from '../../../components/Outbox'

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const { c } = useTheme()
  const store = useStore()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scroll = useRef<FlatList<import('../../../runtime/types').TranscriptItem>>(null)
  const following = useRef(true)
  const [away, setAway] = useState(false)
  const [composerHeight, setComposerHeight] = useState(120)
  const [restore, setRestore] = useState<{ text: string; n: number }>()
  const computer = store.computers.find((x) => x.id === chat?.computerId)
  // Branch and change counts feed the header's git menu. Native menus have no on-open hook,
  // so refetch on focus, when a turn finishes, and after each action here.
  const [git, setGit] = useState<{ chatId: string; repoId: string; repos: number; branch: string; changed: number; ahead: number; published: boolean }>()
  const [refresh, setRefresh] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string>()
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])
  useFocusEffect(useCallback(() => {
    if (!chat?.taskId || chat.projectId === STANDALONE || computer?.status !== 'online') return
    let alive = true
    void (async () => {
      const bindings = (await store.invoke(chat.computerId, 'tasks.bindings', chat.taskId)).filter(b => !b.folderOnly && !b.notGit && b.setupState === 'ready')
      const binding = bindings[0]
      if (!alive || !binding) return
      const status = await store.invoke(chat.computerId, 'git.status', chat.taskId, binding.repoId)
      if (alive) setGit({ chatId: chat.id, repoId: binding.repoId, repos: bindings.length, branch: status.branch ?? (status.oid ? status.oid.slice(0, 7) : 'Detached HEAD'), changed: status.entries.length, ahead: status.ahead, published: Boolean(status.upstream) })
    })().catch(() => {})
    return () => { alive = false }
  }, [chat?.id, chat?.taskId, chat?.computerId, chat?.projectId, chat?.status, computer?.status, refresh]))
  const rows = useMemo(() => foldTurns(chat?.items ?? [], chat?.status === 'running', chat?.status === 'needs-input'), [chat?.items, chat?.status])
  if (!chat) return <Screen><Header title="Chat not found" /></Screen>
  const live = git?.chatId === chat.id ? git : undefined
  const branch = live?.branch ?? chat.branch
  const project = chat.projectId === STANDALONE ? 'Standalone' : store.projects.find((p) => p.id === chat.projectId)?.name
  const running = chat.status === 'running'
  const offline = !store.isOnline(chat.computerId)
  const pending = store.outbox.filter((o) => o.chatId === chat.id)
  const editPending = (text: string) => setRestore((r) => ({ text, n: (r?.n ?? 0) + 1 }))
  const openScm = () => router.push({ pathname: '/chat/[id]/scm', params: { id: chat.id } })
  const openChanges = () => router.push({ pathname: '/chat/[id]/changes', params: { id: chat.id } })
  const say = (text: string) => { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(undefined), 5000) }
  const act = async (fn: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try { say(await fn()) } catch (error) { say(error instanceof Error ? error.message : String(error)) } finally { setBusy(false); setRefresh(n => n + 1) }
  }
  const changed = live?.changed ?? 0
  // One repository: Commit & push is a true one-tap shortcut. With several, it would commit only one, so it opens Source Control.
  const quickCommit = () => {
    if (!live || live.repos > 1) return openScm()
    Alert.alert(`Commit & push ${changed} change${changed === 1 ? '' : 's'}?`, `${computer?.name ?? 'This computer'} · ${live.branch}\n\nRamu drafts the message with AI, commits every change, and pushes to origin.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Commit & push', onPress: () => void act(async () => `Pushed: ${await commitAndPush(store.invoke, chat, live.repoId)}`) },
    ])
  }
  const pushReason = !live ? 'Checking repository…' : changed ? 'Commit or stash local changes before pushing.' : live.ahead ? `Push ${live.ahead} commit${live.ahead === 1 ? '' : 's'} to origin` : !live.published ? 'Publish this branch to origin' : 'Nothing to push'
  const canPush = Boolean(live) && !changed && (Boolean(live!.ahead) || !live!.published)
  const push = () => live && void act(async () => { await pushBranch(store.invoke, chat, live.repoId); return `Pushed ${live.branch}` })
  const gitItems: HeaderMenuItem[] = [
    { title: branch || 'Source control', subtitle: live ? `${changed ? `${changed} changed` : 'No changes'}${live.ahead ? ` · ${live.ahead}↑` : ''}` : undefined, systemIcon: 'arrow.triangle.branch', onPress: openScm },
    { title: live?.repos && live.repos > 1 ? 'Commit…' : changed ? 'Commit & push' : 'Push', subtitle: changed || !canPush ? undefined : pushReason, systemIcon: 'arrow.up.circle', disabled: busy || (changed ? false : !canPush), onPress: changed ? quickCommit : push },
    { title: 'Review changes', subtitle: 'Turn diffs and worktree changes', systemIcon: 'text.bubble', onPress: openChanges },
    { title: 'More', subtitle: 'Commit, files, branches', systemIcon: 'ellipsis', onPress: () => setSheet(true) },
  ]

  return (
    <Screen bg="canvas">
      <Header
        title={chat.title}
        subtitle={<View accessible accessibilityLabel={`Computer: ${computer?.name ?? 'Unavailable'}, ${computer?.status ?? 'offline'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
          <Monitor size={11} color={c.muted} /><T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{computer?.name ?? 'Computer unavailable'}</T><ConnectionDot status={computer?.status ?? 'offline'} size={5} />
        </View>}
        right={
          !chat.pending ? (
            <>
              {chat.projectId !== STANDALONE ? <HeaderMenu icon={GitBranch} label="Source Control" systemIcon="arrow.triangle.branch" items={gitItems} onPress={() => setSheet(true)} /> : null}
              <HeaderButton icon={SquareTerminal} label="Terminal" onPress={() => router.push({ pathname: '/chat/[id]/terminal', params: { id: chat.id } })} />
            </>
          ) : null
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <PageFlatList
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={<View style={{ gap: space.s, paddingBottom: space.m }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1, maxWidth: '50%' }}>{project}</T>{branch ? <><GitBranch size={12} color={c.muted} /><T size={12} mono tone="muted" numberOfLines={1} style={{ flex: 1 }}>{branch}</T></> : null}</View>
            {offline ? <OfflineBanner computer={computer?.name ?? 'Computer unavailable'} pending={pending.length} /> : null}
          </View>}
          data={rows}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <TranscriptItemView item={item} chat={chat} />}
          initialNumToRender={20}
          maxToRenderPerBatch={12}
          windowSize={7}
          ItemSeparatorComponent={() => <View style={{ height: space.m + 2 }} />}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.l, paddingBottom: floatingChrome ? composerHeight + space.l : space.l }}
          onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; const gap = contentSize.height - contentOffset.y - layoutMeasurement.height; following.current = gap < 100; setAway(gap > 240) }}
          scrollEventThrottle={100}
          onContentSizeChange={() => { if (following.current) scroll.current?.scrollToEnd({ animated: false }) }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={<View style={{ gap: space.m, paddingTop: space.m }}>{pending.map(o => <PendingBubble key={o.id} item={o} computer={computer?.name ?? 'the computer'} onEdit={editPending} />)}{running && !offline ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}><ActivityIndicator size="small" color={c.accent} /><T size={font.control} tone="muted">Thinking</T></View> : null}</View>}
        />
        <BottomFade height={composerHeight * 0.75} color={c.canvas} />
        {/* iOS/web: the glass composer floats over the transcript, which scrolls beneath it. */}
        <View
          onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
          style={[{ paddingBottom: Math.max(insets.bottom, space.s), paddingTop: space.xs }, floatingChrome && { position: 'absolute', left: 0, right: 0, bottom: 0 }]}
        >
          <Composer
            running={running}
            model={{ provider: chat.provider, model: chat.model, effort: chat.effort, settings: chat.settings }}
            onModel={(m) => store.setModel(chat.id, m.provider, m.model, m.effort, m.settings)}
            onSend={(text, mode, attachments, context) => store.send(chat.id, text, mode, attachments, context)}
            taskId={chat.taskId || undefined}
            computerId={chat.computerId}
            draftKey={`${chat.computerId}:chat:${chat.taskId || chat.id}`}
            onStop={() => store.stop(chat.id)}
            goal={chat.goal}
            queue={chat.queue}
            onToggleGoal={() => store.toggleGoal(chat.id)}
            onClearGoal={() => store.clearGoal(chat.id)}
            onRemoveQueued={(q) => store.removeQueued(chat.id, q)}
            offline={offline}
            restore={restore}
            placeholder={offline ? `Message · sends when ${computer?.name ?? 'it'} is back` : undefined}
          />
        </View>
      {away ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Scroll to latest" onPress={() => { tap(); following.current = true; setAway(false); scroll.current?.scrollToEnd({ animated: true }) }} style={{ position: 'absolute', alignSelf: 'center', bottom: composerHeight + space.s }}>
          <Glass radius={radius.full} interactive style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: floatingChrome ? undefined : c.raised }}>
            {running ? <ActivityIndicator size="small" color={c.accent} /> : <ArrowDown size={18} color={c.text} strokeWidth={2} />}
          </Glass>
        </Pressable>
      ) : null}
      </KeyboardAvoidingView>
      {toast ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: space.l, right: space.l, top: insets.top + 56 + space.s }}>
          <Glass radius={radius.full} style={{ paddingHorizontal: space.l, paddingVertical: space.m, flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: floatingChrome ? undefined : c.raised }}>
            <Check size={15} color={c.ok} />
            <T size={font.control} weight="500" numberOfLines={2} style={{ flex: 1 }}>{toast}</T>
          </Glass>
        </View>
      ) : null}
      <Sheet open={sheet} onClose={() => setSheet(false)} title={branch || 'Source control'}>
        {([
          { icon: CircleCheck, title: 'Commit', sub: !live ? 'Open Source Control' : changed ? `${changed} file${changed === 1 ? '' : 's'} changed` : 'No changes to commit', run: openScm },
          { icon: CircleArrowUp, title: 'Commit & push', sub: changed ? 'AI message, commit all, push' : 'No changes to commit', run: quickCommit, off: !changed || busy },
          { icon: CircleArrowUp, title: 'Push', sub: pushReason, run: push, off: !canPush || busy },
          { icon: GitCompareArrows, title: 'Review changes', sub: 'Inspect turn diffs and worktree changes', run: openChanges },
          { icon: GitBranch, title: 'Branches', sub: 'Switch, create, stash, and sync', run: openScm },
        ] as const).map(item => (
          <Row key={item.title} disabled={'off' in item && item.off} style={{ opacity: 'off' in item && item.off ? 0.45 : 1 }} onPress={() => { setSheet(false); setTimeout(item.run, 300) }}>
            <item.icon size={19} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="600">{item.title}</T>
              <T size={font.caption} tone="muted">{item.sub}</T>
            </View>
          </Row>
        ))}
      </Sheet>
    </Screen>
  )
}
