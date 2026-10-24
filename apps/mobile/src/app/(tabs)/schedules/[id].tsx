import { goBackOrHome } from '../../../runtime/navigation'
import { View } from 'react-native'
import type { Schedule } from '@ramu/shared/types'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CalendarClock, ChevronRight, Pause, Pencil, Play, Trash2, Zap } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { scoped, useStore } from '../../../runtime/store'
import { useAutomation } from '../../../runtime/automation'
import {
  NO_PROJECT,
  VIEW_ONLY_SCHEDULE_NOTICE,
  RUN_LABELS,
  describeRule,
  formatWhen,
  nextRunText,
  runTone,
  runsOf,
} from '../../../runtime/scheduleModel'
import { ago, useT } from '../../../i18n'
import { Header, HeaderButton, PageScrollView, Screen } from '../../../components/Screen'
import { Group, Nothing } from '../../../components/InboxParts'
import { useScheduleCommands } from '../../../components/ScheduleRow'
import { Button, Row, SectionLabel, T, tap } from '../../../components/ui'

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <View style={{ gap: 2 }}>
      <T size={font.caption} weight="600" tone="muted" style={{ letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {label}
      </T>
      <T tone="soft" style={{ lineHeight: 21 }}>
        {children}
      </T>
    </View>
  )
}

/** One schedule: what it does, when it runs, controls, and how its recent runs went. */
export default function ScheduleDetail() {
  const t = useT()
  const auto = useAutomation()
  const { computer, id } = useLocalSearchParams<{ computer: string; id: string }>()
  const data = auto.of(computer)
  const schedule = data.schedules.find((s) => s.id === id)
  if (!schedule)
    return (
      <Screen>
        <Header title={t.schedules} />
        <Nothing icon={CalendarClock} title={data.loaded ? t.noSchedules : '…'} detail="" />
      </Screen>
    )
  return <Detail computer={computer} schedule={schedule} runs={runsOf(data.runs, schedule.id)} />
}

function Detail({
  computer,
  schedule,
  runs,
}: {
  computer: string
  schedule: Schedule
  runs: ReturnType<typeof runsOf>
}) {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const commands = useScheduleCommands(computer, schedule)
  const lang = store.language
  const project =
    schedule.projectId === NO_PROJECT
      ? t.noProject
      : (store.projects.find((p) => p.id === scoped(computer, schedule.projectId))?.name ?? schedule.projectId)
  const open = (run: (typeof runs)[number]) => {
    if (!run.taskId) return
    router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computer, run.taskId) } })
  }
  return (
    <Screen>
      <Header
        title={schedule.name}
        right={
          commands.viewOnly ? null : (
            <HeaderButton
              icon={Pencil}
              label="Edit"
              systemIcon="pencil"
              onPress={() => router.push({ pathname: '/schedule-edit', params: { computer, id: schedule.id } })}
            />
          )
        }
      />
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, paddingBottom: space.xl * 2, gap: space.l }}
      >
        <View style={{ backgroundColor: c.raised2, borderRadius: radius.l, padding: space.l, gap: space.m }}>
          <Fact label={t.prompt}>{schedule.prompt}</Fact>
          <Fact label={t.repeat}>{describeRule(schedule.rule, lang, schedule.timezone)}</Fact>
          <Fact label={t.upcoming}>{nextRunText(schedule, lang)}</Fact>
          <Fact label={t.scope}>{`${project} · ${schedule.settings.model || schedule.settings.provider}`}</Fact>
          <Fact label={t.timezone}>{schedule.timezone}</Fact>
        </View>
        {commands.viewOnly && (
          <T tone="muted" accessibilityRole="alert">
            {VIEW_ONLY_SCHEDULE_NOTICE[lang]}
          </T>
        )}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button
            title={commands.paused ? t.resume : t.pause}
            icon={commands.paused ? Play : Pause}
            kind="secondary"
            disabled={commands.disabled}
            style={{ flex: 1 }}
            onPress={() => void commands.toggle()}
          />
          <Button
            title={t.runNow}
            icon={Zap}
            disabled={commands.disabled}
            style={{ flex: 1 }}
            onPress={() => void commands.runNow()}
          />
        </View>
        <View>
          <SectionLabel>{t.recentRuns}</SectionLabel>
          {runs.length ? (
            <Group>
              {runs.slice(0, 20).map((run, i) => (
                <Row
                  key={run.id}
                  disabled={!run.taskId}
                  onPress={() => {
                    tap()
                    open(run)
                  }}
                  style={{
                    paddingVertical: 11,
                    borderTopWidth: i ? 0.5 : 0,
                    borderTopColor: c.lineStrong,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <T weight="500" tone={runTone(run.status)}>
                      {RUN_LABELS[run.status][lang]}
                    </T>
                    <T size={font.control} tone="muted">
                      {`${formatWhen(run.dueAt, schedule.timezone, lang)} · ${ago(run.dueAt)}`}
                    </T>
                    {run.error ? (
                      <T size={font.control} tone="bad" numberOfLines={3}>
                        {run.error}
                      </T>
                    ) : null}
                  </View>
                  {run.taskId ? <ChevronRight size={16} color={c.muted} /> : null}
                </Row>
              ))}
            </Group>
          ) : (
            <T tone="muted" style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
              {t.noRuns}
            </T>
          )}
        </View>
        <Button
          title={t.delete}
          icon={Trash2}
          kind="danger"
          disabled={commands.disabled}
          onPress={() => commands.remove(() => goBackOrHome(router))}
        />
      </PageScrollView>
    </Screen>
  )
}
