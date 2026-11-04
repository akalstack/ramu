import { useCallback, useMemo, useState } from 'react'
import { Platform, RefreshControl, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CalendarClock, Plus } from 'lucide-react-native'
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
  const data = auto.of(store.selected)
  const schedules = useMemo(() => sortSchedules(data.schedules), [data.schedules])
  const online = pc?.status === 'online'
  const viewOnly = pc?.access === 'viewer'
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    if (online) await auto.reload(store.selected)
    setRefreshing(false)
  }, [auto, store.selected, online])
  const create = () => {
    if (viewOnly) return
    if (!pc) openNeedComputer('none')
    else if (pc.status === 'revoked') openNeedComputer('revoked')
    else if (!online) openNeedComputer('offline')
    else router.push({ pathname: '/schedule-edit', params: { computer: store.selected } })
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
        {/* Schedules belong to one host, so the host chip has no All hosts here. */}
        <View style={{ flexDirection: 'row', paddingHorizontal: space.l, paddingTop: space.m }}>
          <HostChip />
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
        {data.error ? (
          <T tone="bad" size={font.control} style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            {data.error}
          </T>
        ) : null}
        {schedules.length ? (
          <View>
            {schedules.map((schedule, i) => (
              <ScheduleRow
                key={schedule.id}
                computerId={store.selected}
                schedule={schedule}
                lastRun={runsOf(data.runs, schedule.id)[0]}
                divider={i > 0}
              />
            ))}
          </View>
        ) : data.loaded || !online ? (
          <View>
            <Nothing
              icon={CalendarClock}
              title={t.noSchedules}
              detail={viewOnly ? '' : online ? t.noSchedulesHint : t.offlineNeeded}
            />
            {online && !viewOnly ? (
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
