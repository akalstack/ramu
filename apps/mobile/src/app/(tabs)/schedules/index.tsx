import { useCallback, useMemo, useState } from 'react'
import { Platform, RefreshControl, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CalendarClock, Plus } from 'lucide-react-native'
import type { Schedule } from '@ramu/shared/types'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { useAutomation } from '../../../runtime/automation'
import { runsOf, sortSchedules, VIEW_ONLY_SCHEDULE_NOTICE } from '../../../runtime/scheduleModel'
import { useT } from '../../../i18n'
import {
  GlassButton,
  Header,
  LargeTitle,
  PageScrollView,
  Screen,
  useScrolledUnderBar,
} from '../../../components/Screen'
import { TopFade } from '../../../components/Glass'
import { Nothing } from '../../../components/InboxParts'
import { openNeedComputer, useTabActions } from '../../../components/Overlays'
import { HostChip } from '../../../components/HostChip'
import { ScheduleRow } from '../../../components/ScheduleRow'
import { T } from '../../../components/ui'

export default function SchedulesScreen() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const auto = useAutomation()
  const edge = useScrolledUnderBar(40)
  const pc = store.computers.find((x) => x.id === store.selected)
  // As on Threads: every host's schedules in one list by default, or the host picked from the host chip. Each schedule
  // still lives on, and is fired by, its own host; the row names it once there is more than one.
  const multi = store.computers.length > 1
  const [allHosts, setAllHosts] = useState(true)
  const merged = multi && allHosts
  const hosts = useMemo(
    () => (merged ? store.computers : store.computers.filter((x) => x.id === store.selected)),
    [merged, store.computers, store.selected],
  )
  const entries = useMemo(() => {
    const owner = new Map<Schedule, string>()
    for (const host of hosts) for (const schedule of auto.of(host.id).schedules) owner.set(schedule, host.id)
    return sortSchedules([...owner.keys()]).map((schedule) => ({ schedule, computerId: owner.get(schedule)! }))
  }, [hosts, auto])
  const anyOnline = hosts.some((host) => host.status === 'online')
  const loaded = hosts.every((host) => auto.of(host.id).loaded || host.status !== 'online')
  const errors = hosts.flatMap((host) => {
    const error = auto.of(host.id).error
    return error ? [merged ? `${host.name}: ${error}` : error] : []
  })
  // A view-only pairing cannot create here, but All hosts can still create on another host from the editor.
  const viewOnly = merged ? store.computers.every((x) => x.access === 'viewer') : pc?.access === 'viewer'
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all(hosts.filter((host) => host.status === 'online').map((host) => auto.reload(host.id)))
    setRefreshing(false)
  }, [auto, hosts])
  // With All hosts, a new schedule starts on the selected host when it can take one, else on the first that can; the
  // editor's Runs on still moves it.
  const target = merged
    ? ([pc, ...store.computers].find((x) => x?.status === 'online' && x.access !== 'viewer') ?? pc)
    : pc
  const create = () => {
    if (viewOnly) return
    if (!target) openNeedComputer('none')
    else if (target.status === 'revoked') openNeedComputer('revoked')
    else if (target.status !== 'online') openNeedComputer('offline')
    else router.push({ pathname: '/schedule-edit', params: { computer: target.id } })
  }
  const actions = useTabActions(
    viewOnly ? null : { icon: Plus, label: t.newSchedule, systemIcon: 'plus', onPress: create },
  )
  return (
    <Screen>
      <Header back={false} large scrollEdge collapsed={edge.scrolled} title={t.schedules} right={actions} />
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.muted} />}
      >
        <LargeTitle>{t.schedules}</LargeTitle>
        <View style={{ flexDirection: 'row', paddingHorizontal: space.l, paddingTop: space.m }}>
          <HostChip all={merged} onAll={multi ? setAllHosts : undefined} />
        </View>
        <T
          tone="muted"
          size={font.control}
          style={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.m, lineHeight: 19 }}
        >
          {t.schedulesHint}
        </T>
        {viewOnly && (
          <T
            tone="muted"
            size={font.control}
            accessibilityRole="alert"
            style={{ paddingHorizontal: space.l, paddingBottom: space.m }}
          >
            {VIEW_ONLY_SCHEDULE_NOTICE[store.language]}
          </T>
        )}
        {errors.map((error) => (
          <T key={error} tone="bad" size={font.control} style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            {error}
          </T>
        ))}
        {entries.length ? (
          <View>
            {entries.map(({ schedule, computerId }, i) => (
              <ScheduleRow
                key={`${computerId}:${schedule.id}`}
                computerId={computerId}
                schedule={schedule}
                host={merged ? store.computers.find((x) => x.id === computerId)?.name : undefined}
                lastRun={runsOf(auto.of(computerId).runs, schedule.id)[0]}
                divider={i > 0}
              />
            ))}
          </View>
        ) : loaded || !anyOnline ? (
          <View>
            <Nothing
              icon={CalendarClock}
              title={t.noSchedules}
              detail={viewOnly ? '' : anyOnline ? t.noSchedulesHint : t.offlineNeeded}
            />
            {anyOnline && !viewOnly ? (
              <View style={{ alignItems: 'center' }}>
                <GlassButton primary title={t.newSchedule} icon={Plus} onPress={create} />
              </View>
            ) : null}
          </View>
        ) : null}
      </PageScrollView>
      {Platform.OS === 'ios' ? null : <TopFade visible={edge.scrolled} />}
    </Screen>
  )
}
