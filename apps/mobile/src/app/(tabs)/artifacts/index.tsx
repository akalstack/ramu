import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshControl, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AppWindow, Pin } from 'lucide-react-native'
import { useTabActions } from '../../../components/Overlays'
import { ARTIFACT_KINDS, type ArtifactInfo, type ArtifactKind } from '@ramu/shared/artifacts'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { ago, useSay } from '../../../i18n'
import { Header, LargeTitle, PageScrollView, Screen, useScrolledUnderBar } from '../../../components/Screen'
import { Nothing } from '../../../components/InboxParts'
import { HostChip } from '../../../components/HostChip'
import { Chip, Row, Sheet, T } from '../../../components/ui'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { ArtifactKindMark, kindIcon, kindLabel } from '../../../components/ArtifactKindMark'

/** Every artifact on the paired hosts, newest first with pinned ones on top, as the desktop's Artifacts. */
export default function PagesScreen() {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const edge = useScrolledUnderBar(40)
  const multi = store.computers.length > 1
  const [allHosts, setAllHosts] = useState(true)
  const hosts = useMemo(
    () => (multi && allHosts ? store.computers : store.computers.filter((x) => x.id === store.selected)),
    [multi, allHosts, store.computers, store.selected],
  )
  const [pages, setPages] = useState<Record<string, ArtifactInfo[]>>({})
  const [query, setQuery] = useState('')
  // The kind filter appears once the list holds more than one kind to tell apart.
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  const [choosingKind, setChoosingKind] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(
    async (computerId: string) => {
      try {
        const list = await store.invoke(computerId, 'artifacts.list')
        setPages((all) => ({ ...all, [computerId]: list }))
      } catch {
        // An offline host keeps the list it last gave.
      }
    },
    [store],
  )
  const online = hosts.filter((host) => host.status === 'online').map((host) => host.id)
  const onlineKey = online.join(',')
  useEffect(() => {
    for (const id of onlineKey.split(',').filter(Boolean)) void load(id)
    const offs = onlineKey
      .split(',')
      .filter(Boolean)
      .map((id) =>
        store.subscribe(id, (...[channel, payload]) => {
          if (channel === 'artifacts:changed' && !(payload as { run?: unknown }).run) void load(id)
        }),
      )
    return () => offs.forEach((off) => off())
  }, [onlineKey, load, store])
  // Artifacts come from threads; this tab is where they are found again, so it has no New of its own.
  const actions = useTabActions()
  const kinds = ARTIFACT_KINDS.filter((entry) =>
    hosts.some((host) => (pages[host.id] ?? []).some((page) => page.kind === entry)),
  )
  const rows = hosts
    .flatMap((host) => (pages[host.id] ?? []).map((page) => ({ page, host })))
    .filter(
      ({ page }) =>
        (kind === 'all' || page.kind === kind) && page.title.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Number(b.page.pinned) - Number(a.page.pinned) || b.page.changedAt - a.page.changedAt)
  return (
    <Screen>
      <Header back={false} large scrollEdge collapsed={edge.scrolled} title={say('Artifacts')} right={actions} />
      <PageScrollView
        fullWidth
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.muted}
            onRefresh={() => {
              setRefreshing(true)
              void Promise.all(online.map(load)).finally(() => setRefreshing(false))
            }}
          />
        }
      >
        <LargeTitle>{say('Artifacts')}</LargeTitle>
        <View style={{ flexDirection: 'row', paddingHorizontal: space.l, paddingTop: space.m }}>
          <HostChip all={multi && allHosts} onAll={multi ? setAllHosts : undefined} />
          {kinds.length > 1 ? (
            <View style={{ marginLeft: space.s }}>
              <Chip
                label={kind === 'all' ? say('All kinds') : say(kindLabel(kind))}
                accessibilityLabel={say('Kind')}
                chevron
                onPress={() => setChoosingKind(true)}
              />
            </View>
          ) : null}
        </View>
        <TextInput
          accessibilityLabel={say('Search artifacts')}
          placeholder={say('Search artifacts')}
          placeholderTextColor={c.muted}
          value={query}
          onChangeText={setQuery}
          style={{
            marginHorizontal: space.l,
            marginTop: space.m,
            marginBottom: space.s,
            minHeight: 40,
            paddingHorizontal: space.m,
            borderRadius: 10,
            backgroundColor: c.fill,
            color: c.text,
          }}
        />
        {rows.length ? (
          rows.map(({ page, host }) => (
            <Row
              key={`${host.id}:${page.id}`}
              accessibilityLabel={page.title}
              onPress={() =>
                router.push({ pathname: '/artifact/[computer]/[id]', params: { computer: host.id, id: page.id } })
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}
            >
              <T size={font.title}>{page.icon}</T>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1}>{page.title}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <ArtifactKindMark kind={page.kind} size={12} color={c.muted} />
                  <T size={font.caption} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                    {[
                      say(kindLabel(page.kind)),
                      multi ? host.name : null,
                      `v${page.version}`,
                      page.lastError ? say('Has an error') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                </View>
              </View>
              {page.pinned ? <Pin size={14} color={c.muted} /> : null}
              <T size={font.caption} tone="muted">
                {ago(page.changedAt)}
              </T>
            </Row>
          ))
        ) : (
          <Nothing
            icon={AppWindow}
            title={say('No artifacts yet')}
            detail={say(
              'Ask an agent for something to keep, like “a tracker for …”, or choose Keep as artifact on any interactive card in a thread.',
            )}
          />
        )}
      </PageScrollView>
      <Sheet open={choosingKind} onClose={() => setChoosingKind(false)} title={say('Kind')}>
        <SheetGroup>
          {(['all', ...kinds] as const).map((entry) => (
            <SheetOption
              key={entry}
              icon={entry === 'all' ? undefined : kindIcon(entry)}
              title={entry === 'all' ? say('All kinds') : say(kindLabel(entry))}
              selected={kind === entry}
              onPress={() => {
                setKind(entry)
                setChoosingKind(false)
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
    </Screen>
  )
}
