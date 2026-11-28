import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshControl, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AppWindow, Pin, Search } from 'lucide-react-native'
import { useTabActions } from '../../../components/Overlays'
import { ARTIFACT_KINDS, type ArtifactInfo, type ArtifactKind } from '@ramu/shared/artifacts'
import { shortHostName } from '@ramu/shared/hostLabel'
import { appendPage, mergedPages } from '@ramu/shared/paging'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { ago, useSay } from '../../../i18n'
import { Header, LargeTitle, PageLegendList, Screen, useScrolledUnderBar } from '../../../components/Screen'
import { Nothing } from '../../../components/InboxParts'
import { HostChip } from '../../../components/HostChip'
import { Chip, Divider, Row, Sheet, T } from '../../../components/ui'
import { ListSearch } from '../../../components/ListSearch'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { ArtifactKindMark, kindIcon, kindLabel } from '../../../components/ArtifactKindMark'

/** The column an artifact's emoji sits in, and where the row's text and divider start after it. */
const ARTIFACT_ICON = 28
const ARTIFACT_TEXT_INSET = space.l + ARTIFACT_ICON + space.m
/** Artifacts each host sends at a time. */
const ARTIFACT_PAGE = 50

/** What one host has sent for the current search and kind. */
interface HostArtifacts {
  items: ArtifactInfo[]
  next: string | null
  kinds: ArtifactKind[]
}

/** The list's order, as the host keeps it: pinned first, then the newest change. */
const byListOrder = (a: ArtifactInfo, b: ArtifactInfo) =>
  Number(b.pinned) - Number(a.pinned) || b.changedAt - a.changedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

/** Every artifact on the paired hosts, newest first with pinned ones on top, as the desktop's Artifacts. */
export default function PagesScreen() {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const scrolledEdge = useScrolledUnderBar(40)
  const multi = store.computers.length > 1
  const [allHosts, setAllHosts] = useState(true)
  const hosts = useMemo(
    () => (multi && allHosts ? store.computers : store.computers.filter((x) => x.id === store.selected)),
    [multi, allHosts, store.computers, store.selected],
  )
  const [pages, setPages] = useState<Record<string, HostArtifacts>>({})
  const [query, setQuery] = useState('')
  // The kind filter appears once the host holds more than one kind to tell apart.
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')
  const [choosingKind, setChoosingKind] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // The search goes to each host as typing pauses, so one word is one request.
  const [searched, setSearched] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  const filter = useMemo(
    () => ({ ...(searched ? { query: searched } : {}), ...(kind === 'all' ? {} : { kind }) }),
    [searched, kind],
  )
  const filterKey = JSON.stringify(filter)
  const latestFilter = useRef(filterKey)
  latestFilter.current = filterKey
  const loading = useRef(new Set<string>())
  /** A host's first page for the current search and kind, or (`more`) the page after what it has shown. */
  const load = useCallback(
    async (computerId: string, more = false) => {
      const asked = filterKey
      const shown = pagesRef.current[computerId]
      const cursor = more ? shown?.next : null
      if (more && (!cursor || loading.current.has(computerId))) return
      loading.current.add(computerId)
      try {
        const page = await store
          .invoke(computerId, 'artifacts.page', filter, cursor ?? null, ARTIFACT_PAGE)
          .catch(async (error: unknown) => {
            // A host too old to page gives its whole list, filtered here.
            if (cursor) throw error
            const all = await store.invoke(computerId, 'artifacts.list')
            return { items: all, next: null, kinds: [...new Set(all.map((entry) => entry.kind))] }
          })
        if (asked !== latestFilter.current) return
        setPages((all) => ({
          ...all,
          [computerId]: {
            items: more ? appendPage(all[computerId]?.items ?? [], page.items, (entry) => entry.id) : page.items,
            next: page.next,
            kinds: page.kinds,
          },
        }))
      } catch {
        // An offline host keeps the list it last gave.
      } finally {
        loading.current.delete(computerId)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filter` is keyed by filterKey
    [store, filterKey],
  )
  const pagesRef = useRef(pages)
  pagesRef.current = pages
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
  const kinds = ARTIFACT_KINDS.filter((entry) => hosts.some((host) => pages[host.id]?.kinds.includes(entry)))
  const needle = query.trim().toLowerCase()
  const rows = mergedPages(
    hosts.map((host) => ({
      items: (pages[host.id]?.items ?? []).map((page) => ({ page, host })),
      next: pages[host.id]?.next ?? null,
    })),
    (a, b) => byListOrder(a.page, b.page),
  ).filter(({ page }) => (kind === 'all' || page.kind === kind) && page.title.toLowerCase().includes(needle))
  const more = hosts.some((host) => pages[host.id]?.next)
  const loadMore = () => {
    for (const host of hosts) if (pages[host.id]?.next && host.status === 'online') void load(host.id, true)
  }
  return (
    <Screen>
      <Header
        back={false}
        large
        scrollEdge
        collapsed={scrolledEdge.scrolled}
        title={say('Artifacts')}
        right={actions}
      />
      <PageLegendList
        fullWidth
        data={rows}
        keyExtractor={({ page, host }) => `${host.id}:${page.id}`}
        renderItem={({ item: { page, host }, index }) => (
          <View>
            {index ? <Divider inset={ARTIFACT_TEXT_INSET} /> : null}
            <Row
              accessibilityLabel={page.title}
              onPress={() =>
                router.push({ pathname: '/artifact/[computer]/[id]', params: { computer: host.id, id: page.id } })
              }
            >
              <View style={{ width: ARTIFACT_ICON, alignItems: 'center' }}>
                <T size={font.title}>{page.icon}</T>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
                  <T weight="500" numberOfLines={1} style={{ flex: 1 }}>
                    {page.title}
                  </T>
                  {page.pinned ? <Pin size={11} color={c.muted} /> : null}
                  <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                    {ago(page.changedAt)}
                  </T>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <ArtifactKindMark kind={page.kind} size={12} color={c.muted} />
                  <T size={font.control} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {[say(kindLabel(page.kind)), multi ? shortHostName(host.name) : null, `v${page.version}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                  {page.lastError ? (
                    <T size={font.control} tone="bad" numberOfLines={1}>
                      {`· ${say('Has an error')}`}
                    </T>
                  ) : null}
                </View>
              </View>
            </Row>
          </View>
        )}
        estimatedItemSize={60}
        // The host names on each row follow how many hosts are paired, which no row's data carries.
        extraData={multi}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={scrolledEdge.onScroll}
        scrollEventThrottle={16}
        // About a screen before the end, the next page is already on its way.
        onEndReached={more ? loadMore : undefined}
        onEndReachedThreshold={1}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.muted}
            onRefresh={() => {
              setRefreshing(true)
              void Promise.all(online.map((id) => load(id))).finally(() => setRefreshing(false))
            }}
          />
        }
        ListHeaderComponent={
          <>
            <LargeTitle>{say('Artifacts')}</LargeTitle>
            {/* Search first, then what narrows the list, in the order Pull requests keeps them. */}
            <ListSearch value={query} onChangeText={setQuery} label={say('Search artifacts')} />
            <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.m }}>
              <HostChip all={multi && allHosts} onAll={multi ? setAllHosts : undefined} />
              {kinds.length > 1 ? (
                <Chip
                  label={kind === 'all' ? say('All kinds') : say(kindLabel(kind))}
                  accessibilityLabel={say('Kind')}
                  chevron
                  onPress={() => setChoosingKind(true)}
                />
              ) : null}
            </View>
          </>
        }
        ListEmptyComponent={
          hosts.some((host) => pages[host.id]?.items.length) || filterKey !== '{}' ? (
            // Kept artifacts that the search or kind leaves out are not "none yet".
            <Nothing icon={Search} title={say('No matches')} detail={say('Try other words, or another kind.')} />
          ) : (
            <Nothing
              icon={AppWindow}
              title={say('No artifacts yet')}
              detail={say(
                'Ask an agent for something to keep, like “a tracker for …”, or choose Keep as artifact on any interactive card in a thread.',
              )}
            />
          )
        }
      />
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
