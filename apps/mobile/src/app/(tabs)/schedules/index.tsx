import { useCallback, useMemo, useState } from 'react'
import { RefreshControl, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CalendarClock, Plus } from 'lucide-react-native'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { useAutomation } from '../../../runtime/automation'
import { runsOf, sortSchedules } from '../../../runtime/scheduleModel'
import { useT } from '../../../i18n'
import {
  GlassButton,
  Header,
  LargeTitle,
  PageScrollView,
  Screen,
  nativeScrollEdge,
  useScrolledUnderBar,
} from '../../../components/Screen'
import { TopFade } from '../../../components/Glass'
import { Group, Nothing } from '../../../components/InboxParts'
import { openNeedComputer, useTabActions } from '../../../components/Overlays'
import { ComputerSwitcher } from '../../../components/ComputerSwitcher'
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
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    if (online) await auto.reload(store.selected)
    setRefreshing(false)
  }, [auto, store.selected, online])
  const create = () => {
    if (!pc) openNeedComputer('none')
    else if (pc.status === 'revoked') openNeedComputer('revoked')
    else if (!online) openNeedComputer('offline')
    else router.push({ pathname: '/schedule-edit', params: { computer: store.selected } })
  }
  const actions = useTabActions({ icon: Plus, label: t.newSchedule, systemIcon: 'plus', onPress: create })
  return (
    <Screen>
      <Header
        back={false}
        large
        collapsed={edge.scrolled}
        title={t.schedules}
        right={actions}
      />
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.muted} />}
      >
        <LargeTitle>{t.schedules}</LargeTitle>
        <ComputerSwitcher />
        <T
          tone="muted"
          size={font.control}
          style={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.m, lineHeight: 19 }}
        >
          {t.schedulesHint}
        </T>
        {data.error ? (
          <T tone="bad" size={font.control} style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            {data.error}
          </T>
        ) : null}
        {schedules.length ? (
          <Group>
            {schedules.map((schedule, i) => (
              <ScheduleRow
                key={schedule.id}
                computerId={store.selected}
                schedule={schedule}
                lastRun={runsOf(data.runs, schedule.id)[0]}
                divider={i > 0}
              />
            ))}
          </Group>
        ) : data.loaded || !online ? (
          <View>
            <Nothing icon={CalendarClock} title={t.noSchedules} detail={online ? t.noSchedulesHint : t.offlineNeeded} />
            {online ? (
              <View style={{ alignItems: 'center' }}>
                <GlassButton primary title={t.newSchedule} icon={Plus} onPress={create} />
              </View>
            ) : null}
          </View>
        ) : null}
      </PageScrollView>
      {nativeScrollEdge ? null : <TopFade visible={edge.scrolled} />}
    </Screen>
  )
}
