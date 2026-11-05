import { Alert, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Pause, Play, Trash2, Zap } from 'lucide-react-native'
import type { Schedule, ScheduleRun } from '@ramu/shared/types'
import { font, space, useTheme } from '../theme'
import { useAutomation } from '../runtime/automation'
import { useStore } from '../runtime/store'
import { RUN_LABELS, describeRule, nextRunText, runTone, scheduleWriteProblem } from '../runtime/scheduleModel'
import { ago, useT } from '../i18n'
import { Divider, Row, T, tap } from './ui'
import { SwipeRow } from './SwipeRow'

export function useScheduleCommands(computerId: string, schedule: Schedule) {
  const auto = useAutomation()
  const t = useT()
  const store = useStore()
  const computer = store.computers.find((pc) => pc.id === computerId)
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (e) {
      Alert.alert(schedule.name, e instanceof Error ? e.message : String(e))
    }
  }
  return {
    paused: schedule.state === 'paused',
    disabled: scheduleWriteProblem(computer, store.language) !== null,
    viewOnly: computer?.access === 'viewer',
    toggle: () => run(() => auto.pauseSchedule(computerId, schedule.id, schedule.state !== 'paused')),
    runNow: () => run(() => auto.runScheduleNow(computerId, schedule.id)),
    remove: (after?: () => void) =>
      Alert.alert(schedule.name, undefined, [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.delete,
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await auto.deleteSchedule(computerId, schedule.id)
              after?.()
            }),
        },
      ]),
  }
}

/** A schedule in the list: its name, when it repeats, when it runs next, and how the last run went. */
export function ScheduleRow({
  computerId,
  schedule,
  lastRun,
  divider,
  host,
}: {
  computerId: string
  schedule: Schedule
  lastRun?: ScheduleRun
  divider?: boolean
  /** The host that fires it, named when the list mixes hosts. */
  host?: string
}) {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const { language } = useStore()
  const commands = useScheduleCommands(computerId, schedule)
  const dot = schedule.state === 'active' ? c.ok : c.placeholder
  return (
    <>
      {/* Inset to the name, past the 8pt state dot. */}
      {divider ? <Divider inset={space.l + 8 + space.m} /> : null}
      <SwipeRow
        background={c.window}
        fullSwipe
        actions={
          commands.disabled
            ? []
            : [
                {
                  icon: commands.paused ? Play : Pause,
                  label: commands.paused ? t.resume : t.pause,
                  color: c.primary,
                  onPress: () => void commands.toggle(),
                },
                { icon: Zap, label: t.runNow, color: c.warn, onPress: () => void commands.runNow() },
                { icon: Trash2, label: t.delete, color: c.bad, onPress: () => commands.remove() },
              ]
        }
      >
        <Row
          onPress={() => {
            tap()
            router.push({ pathname: '/schedules/[id]', params: { id: schedule.id, computer: computerId } })
          }}
          style={{
            alignItems: 'flex-start',
            paddingVertical: 11,
          }}
        >
          <View style={{ paddingTop: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="500" numberOfLines={1} tone={schedule.state === 'active' ? 'text' : 'muted'}>
              {schedule.name}
            </T>
            <T size={font.control} tone="soft" numberOfLines={1}>
              {[host, describeRule(schedule.rule, language, schedule.timezone)].filter(Boolean).join(' · ')}
            </T>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <T size={font.control} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {nextRunText(schedule, language)}
              </T>
              {lastRun ? (
                <T size={font.control} tone={runTone(lastRun.status)} numberOfLines={1}>
                  {`· ${RUN_LABELS[lastRun.status][language]} ${ago(lastRun.dueAt)}`}
                </T>
              ) : null}
            </View>
          </View>
        </Row>
      </SwipeRow>
    </>
  )
}
