import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView as HScroll, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Check, ChevronDown, ChevronRight, Folder, FolderGit2, MessagesSquare, Monitor, Search, Settings, SquarePen, WifiOff, Clock, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { useT } from '../i18n'
import { Header, HeaderButton, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { ChatRow } from '../components/ChatRow'
import { ConnectionDot, IconButton, Row, SectionLabel, Sheet, T, tap } from '../components/ui'
import { confirmCancel } from '../components/Outbox'
import { BottomFade, Glass, GlassGroup, floatingChrome } from '../components/Glass'

function ComputerSwitcher() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const { computers, chats, selected } = useStore()
  const pc = computers.find((x) => x.id === selected)
  const n = counts(chats, selected)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.computers}
      onPress={() => {
        tap()
        router.push('/computers')
      }}
      style={({ pressed }) => ({ marginHorizontal: space.l, marginTop: space.s, flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderRadius: radius.m, backgroundColor: pressed ? c.raised : c.raised2 })}
    >
      <View style={{ width: 34, height: 34, borderRadius: radius.s + 2, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Monitor size={17} color={c.soft} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T weight="600" numberOfLines={1}>
            {pc?.name ?? t.pair}
          </T>
          {pc ? <ConnectionDot status={pc.status} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {pc ? pc.address.replace(/^https?:\/\//, '') : ''}
          </T>
          {n.running ? <T size={font.caption} weight="600" tone="accent">{`· ${n.running} ${t.running}`}</T> : null}
          {n.waiting ? <T size={font.caption} weight="600" tone="warn">{`· ${n.waiting} ${t.waiting}`}</T> : null}
        </View>
      </View>
      <ChevronDown size={16} color={c.muted} />
    </Pressable>
  )
}

export default function Home() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { chats, projects, selected, computers, outbox: allOutbox, cancelOutbox } = useStore()
  const outbox = allOutbox.filter((o) => o.computerId === selected)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pc = computers.find((x) => x.id === selected)
  // New chats work offline too: they wait in the outbox. Only a revoked pairing blocks them.
  const online = !!pc && pc.status !== 'revoked'

  type StatusFilter = 'all' | 'running' | 'needs-input' | 'failed' | 'archived'
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [scope, setScope] = useState<string | null>(null)
  const [scopeSheet, setScopeSheet] = useState(false)
  const projectList = projects.filter((p) => p.computerId === selected)
  const nameOf = (id: string) => projectList.find((p) => p.id === id)?.name
  const scoped = useMemo(() => chats.filter((x) => x.computerId === selected && (!scope || x.projectId === scope)), [chats, selected, scope])
  const mine = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scoped
      .filter((x) => (filter === 'archived' ? x.status === 'archived' : x.status !== 'archived' && (filter === 'all' || x.status === filter)) && (!q || x.title.toLowerCase().includes(q) || x.preview.toLowerCase().includes(q) || (nameOf(x.projectId) ?? '').toLowerCase().includes(q)))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [scoped, filter, query, projectList])
  const filtering = Boolean(query) || filter !== 'all' || scope !== null
  const pinned = mine.filter((x) => x.pinnedAt !== null && filter !== 'archived').sort((a, b) => b.pinnedAt! - a.pinnedAt!)
  const unpinned = mine.filter((x) => !pinned.includes(x))
  const waiting = mine.filter((x) => x.status === 'needs-input')
  const standalone = unpinned.filter((x) => x.projectId === STANDALONE)
  const scopeName = scope ? nameOf(scope) ?? 'Workspace' : 'All workspaces'
  const live = scoped.filter((x) => x.status !== 'archived')
  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: live.length },
    { key: 'running', label: 'Running', count: live.filter((x) => x.status === 'running').length },
    { key: 'needs-input', label: 'Needs you', count: live.filter((x) => x.status === 'needs-input').length },
    { key: 'failed', label: 'Failed', count: live.filter((x) => x.status === 'failed').length },
    { key: 'archived', label: 'Archived', count: scoped.filter((x) => x.status === 'archived').length },
  ]

  return (
    <Screen>
      <Header
        back={false}
        title={t.workspaces}
        right={
          <>
            <HeaderButton icon={Settings} label={t.settings} onPress={() => router.push('/settings')} />
          </>
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: insets.bottom + 96 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <ComputerSwitcher />

        {pc?.status === 'offline' ? (
          <View style={{ margin: space.l, marginBottom: 0, padding: space.m, borderRadius: radius.m, backgroundColor: c.fill, flexDirection: 'row', gap: space.m }}>
            <WifiOff size={16} color={c.muted} />
            <T size={font.control} tone="muted" style={{ flex: 1, lineHeight: 19 }}>
              {t.offlineHint}
            </T>
          </View>
        ) : null}

        <HScroll horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.m, gap: space.s }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Filter by workspace" onPress={() => { tap(); setScopeSheet(true) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: space.m, borderRadius: radius.full, backgroundColor: scope ? c.accentWash : c.raised2 }}>
            <Folder size={14} color={scope ? c.accent : c.soft} />
            <T size={font.control} weight="500" tone={scope ? 'accent' : 'soft'} numberOfLines={1} style={{ maxWidth: 150 }}>{scopeName}</T>
            <ChevronDown size={13} color={c.muted} />
          </Pressable>
          {chips.filter((chip) => chip.key === 'all' || chip.key === filter || chip.count > 0).map((chip) => (
            <Pressable key={chip.key} accessibilityRole="button" accessibilityState={{ selected: filter === chip.key }} onPress={() => { tap(); setFilter(chip.key) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: space.m, borderRadius: radius.full, backgroundColor: filter === chip.key ? c.primary : c.raised2 }}>
              <T size={font.control} weight="500" style={{ color: filter === chip.key ? c.primaryInk : undefined }} tone={filter === chip.key ? undefined : 'soft'}>{chip.label}</T>
              {chip.count ? <T size={font.caption} style={{ color: filter === chip.key ? c.primaryInk : undefined, opacity: 0.7 }} tone={filter === chip.key ? undefined : 'muted'}>{chip.count}</T> : null}
            </Pressable>
          ))}
        </HScroll>

        {!floatingChrome ? (
          <View style={{ marginHorizontal: space.l, marginTop: space.m, flexDirection: 'row', alignItems: 'center', gap: space.s, height: 48, paddingHorizontal: space.l, borderRadius: radius.full, backgroundColor: c.raised }}>
            <Search size={18} color={c.muted} />
            <TextInput value={query} onChangeText={setQuery} placeholder={t.search} placeholderTextColor={c.placeholder} style={{ flex: 1, color: c.text, fontSize: font.body }} returnKeyType="search" />
          </View>
        ) : null}

        {outbox.length && !filtering ? (
          <>
            <SectionLabel right={<T size={font.caption} tone="muted">sends when online</T>}>{`${t.outbox} ${outbox.length}`}</SectionLabel>
            {outbox.map((o) => {
              const chat = chats.find((x) => x.id === o.chatId)
              return (
                <Row key={o.id} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: o.chatId } })} style={{ paddingVertical: 10 }}>
                  <Clock size={16} color={c.muted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T size={font.body} weight="500" numberOfLines={1}>
                      {o.kind === 'chat' ? `New chat · ${nameOf(chat?.projectId ?? '') ?? 'Standalone'}` : chat?.title}
                    </T>
                    <T size={font.control} tone="muted" numberOfLines={1}>
                      {o.text}
                    </T>
                  </View>
                  <IconButton icon={X} label="Cancel" size={32} tone="muted" onPress={() => confirmCancel(o, undefined, cancelOutbox)} />
                </Row>
              )
            })}
          </>
        ) : null}

        {waiting.length && !filtering ? (
          <>
            <SectionLabel>{t.needsYou}</SectionLabel>
            {waiting.map((x) => (
              <ChatRow key={x.id} chat={x} project={nameOf(x.projectId)} />
            ))}
          </>
        ) : null}

        {pinned.length ? (
          <>
            <SectionLabel>Pinned</SectionLabel>
            {pinned.map((x) => (
              <ChatRow key={x.id} chat={x} project={nameOf(x.projectId)} />
            ))}
          </>
        ) : null}

        <SectionLabel>{filter === 'archived' ? 'Archived' : t.projects}</SectionLabel>
        {projectList.filter((p) => !scope || p.id === scope).map((p) => {
          const list = unpinned.filter((x) => x.projectId === p.id)
          const closed = collapsed[p.id]
          if (filtering && !list.length) return null
          return (
            <View key={p.id}>
              <Pressable
                onPress={() => {
                  tap()
                  setCollapsed((s) => ({ ...s, [p.id]: !closed }))
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, paddingVertical: 9, backgroundColor: pressed ? c.pressed : 'transparent' })}
              >
                {p.kind === 'workspace' ? <Folder size={16} color={c.soft} strokeWidth={1.8} /> : <FolderGit2 size={16} color={c.soft} strokeWidth={1.8} />}
                <T weight="600" style={{ flexShrink: 1 }} numberOfLines={1}>
                  {p.name}
                </T>
                {p.kind === 'workspace' ? (
                  <T size={font.caption} tone="muted">
                    {p.repos.length} repos
                  </T>
                ) : null}
                <View style={{ flex: 1 }} />
                <T size={font.caption} tone="muted">
                  {list.length}
                </T>
                {closed ? <ChevronRight size={15} color={c.muted} /> : <ChevronDown size={15} color={c.muted} />}
              </Pressable>
              {!closed ? (
                <View style={{ paddingLeft: space.s }}>
                  {list.length ? (
                    list.map((x) => <ChatRow key={x.id} chat={x} />)
                  ) : (
                    <T size={font.control} tone="muted" style={{ paddingHorizontal: space.l + space.l, paddingVertical: space.s }}>
                      {t.empty}
                    </T>
                  )}
                </View>
              ) : null}
            </View>
          )
        })}

        {standalone.length ? (
          <>
            <SectionLabel>{t.standalone}</SectionLabel>
            {standalone.map((x) => (
              <ChatRow key={x.id} chat={x} />
            ))}
          </>
        ) : null}

        {filtering && !mine.length ? (
          <View style={{ alignItems: 'center', padding: space.xl * 2, gap: space.m }}>
            <Search size={26} color={c.placeholder} />
            <T tone="muted">No chats match.</T>
            <Pressable onPress={() => { tap(); setQuery(''); setFilter('all'); setScope(null) }}><T tone="accent" weight="500">Clear filters</T></Pressable>
          </View>
        ) : null}

        {!filtering && !mine.length && !projectList.length ? (
          <View style={{ alignItems: 'center', padding: space.xl * 2, gap: space.m }}>
            <MessagesSquare size={28} color={c.placeholder} />
            <T tone="muted">{t.empty}</T>
          </View>
        ) : null}
      </ScrollView>

      <BottomFade height={insets.bottom + 96} />
      {floatingChrome ? (
        // iOS 26 layout: search sits at the bottom in a glass capsule, compose floats to its right.
        <GlassGroup style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.l, paddingBottom: Math.max(insets.bottom, space.m) }}>
          <Glass radius={radius.full} interactive style={{ flex: 1, height: 48 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l }}>
              <Search size={18} color={c.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder={t.search} placeholderTextColor={c.placeholder} style={{ flex: 1, color: c.text, fontSize: font.body }} returnKeyType="search" clearButtonMode="while-editing" />
            </View>
          </Glass>
          <Pressable accessibilityRole="button" accessibilityLabel={t.newChat} disabled={!online} onPress={() => { tap(); router.push('/new') }} style={{ opacity: online ? 1 : 0.5 }}>
            <Glass radius={radius.full} interactive tint={c.primary} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <SquarePen size={20} color={c.primaryInk} strokeWidth={2} />
            </Glass>
          </Pressable>
        </GlassGroup>
      ) : (
        // Android: Material extended FAB at the bottom right.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.newChat}
          disabled={!online}
          onPress={() => { tap(); router.push('/new') }}
          style={({ pressed }) => ({ position: 'absolute', right: space.l, bottom: insets.bottom + space.l, flexDirection: 'row', alignItems: 'center', gap: space.s, height: 56, paddingHorizontal: 20, borderRadius: 16, backgroundColor: c.primary, elevation: 6, opacity: !online ? 0.5 : pressed ? 0.85 : 1 })}
        >
          <SquarePen size={20} color={c.primaryInk} strokeWidth={2} />
          <T weight="600" style={{ color: c.primaryInk }}>
            {t.newChat}
          </T>
        </Pressable>
      )}
      </KeyboardAvoidingView>
      <Sheet open={scopeSheet} onClose={() => setScopeSheet(false)} title="Workspace">
        {[{ id: null as string | null, name: 'All workspaces', n: chats.filter((x) => x.computerId === selected && x.status !== 'archived').length }, ...projectList.map((p) => ({ id: p.id as string | null, name: p.name, n: chats.filter((x) => x.projectId === p.id && x.status !== 'archived').length }))].map((o) => (
          <Row key={o.id ?? 'all'} onPress={() => { setScope(o.id); setScopeSheet(false) }}>
            <Folder size={17} color={c.soft} />
            <T style={{ flex: 1 }} weight={o.id === scope ? '600' : '400'} numberOfLines={1}>{o.name}</T>
            <T size={font.caption} tone="muted">{o.n}</T>
            {o.id === scope ? <Check size={16} color={c.accent} /> : <View style={{ width: 16 }} />}
          </Row>
        ))}
      </Sheet>
    </Screen>
  )
}
