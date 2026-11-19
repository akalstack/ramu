import { goBackOrHome } from '../runtime/navigation'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Check, Folder, MessagesSquare } from 'lucide-react-native'
import type { ScheduleInput } from '@ramu/shared/types'
import { font, space, useTheme } from '../theme'
import { scoped, useStore } from '../runtime/store'
import { useAutomation } from '../runtime/automation'
import {
  NO_PROJECT,
  VIEW_ONLY_SCHEDULE_NOTICE,
  RULE_KINDS,
  RULE_LABELS,
  addDays,
  defaultInput,
  describeRule,
  formatWhen,
  onceInstant,
  ruleOfKind,
  toggleWeekday,
  validateInput,
} from '../runtime/scheduleModel'
import { useSay, useT } from '../i18n'
import { GlassButton, Header, PageScrollView, Screen } from '../components/Screen'
import { ReadableColumn } from '../components/ReadableColumn'
import { ModelChip, type ModelChoice } from '../components/Composer'
import { Field, Stepper, TextField, TimeField, WeekdayPicker } from '../components/ScheduleFields'
import { Row, Segmented, Sheet, T } from '../components/ui'
import { SheetGroup, SheetOption } from '../components/SheetOptions'

const UNITS = [
  { key: 'minutes', label: 'min', factor: 1 },
  { key: 'hours', label: 'hours', factor: 60 },
  { key: 'days', label: 'days', factor: 1440 },
] as const
type Unit = (typeof UNITS)[number]['key']
const unitOf = (minutes: number): Unit => (minutes % 1440 === 0 ? 'days' : minutes % 60 === 0 ? 'hours' : 'minutes')
const factor = (unit: Unit) => UNITS.find((u) => u.key === unit)!.factor

/** Create or edit a schedule on the selected computer. The computer validates it again and works out the next run. */
export default function ScheduleEdit() {
  const { c } = useTheme()
  const t = useT()
  const say = useSay()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useStore()
  const auto = useAutomation()
  const { computer, id } = useLocalSearchParams<{ computer?: string; id?: string }>()
  const ownerId = computer ?? store.selected
  const existing = id ? auto.of(ownerId).schedules.find((s) => s.id === id) : undefined
  // Runs on: a schedule lives on the host that fires it. Moving one saves it there, then removes it here on confirmation.
  const [computerId, setComputerId] = useState(ownerId)
  const hosts = store.computers.filter((pc) => pc.status === 'online' && pc.access !== 'viewer')
  const preset = store.defaults[computerId]
  const [input, setInput] = useState<ScheduleInput>(() =>
    existing
      ? { ...existing }
      : defaultInput(
          preset ?? { provider: 'claude-code', model: '', effort: null, access: 'full', autoFallback: true },
        ),
  )
  const rule = input.rule
  const [unit, setUnit] = useState<Unit>(() => (rule.kind === 'interval' ? unitOf(rule.minutes) : 'hours'))
  const [onceDay, setOnceDay] = useState(() => (rule.kind === 'once' ? new Date(rule.at) : addDays(new Date(), 1)))
  // Opened from a link before the computer has answered: take the schedule in once it arrives.
  const seeded = useRef(Boolean(existing) || !id)
  useEffect(() => {
    if (seeded.current || !existing) return
    seeded.current = true
    setInput({ ...existing })
    if (existing.rule.kind === 'interval') setUnit(unitOf(existing.rule.minutes))
    if (existing.rule.kind === 'once') setOnceDay(new Date(existing.rule.at))
  }, [existing])
  const [projectSheet, setProjectSheet] = useState(false)
  const [preview, setPreview] = useState<number[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pc = store.computers.find((pc) => pc.id === computerId)
  const online = pc?.status === 'online'
  const viewOnly = pc?.access === 'viewer'
  const projects = store.projects.filter((p) => p.computerId === computerId)
  const lang = store.language
  const patch = (next: Partial<ScheduleInput>) => setInput((current) => ({ ...current, ...next }))

  // Which times the rule produces, worked out by the computer so DST and month ends match what will really run.
  const ruleKey = JSON.stringify(rule)
  useEffect(() => {
    if (!online || viewOnly) return
    let alive = true
    const timer = setTimeout(() => {
      auto.previewRule(computerId, rule, input.timezone).then(
        (dates) => {
          if (!alive) return
          setPreview(dates)
          setPreviewError(null)
        },
        (e) => {
          if (!alive) return
          setPreview([])
          setPreviewError(e instanceof Error ? e.message : String(e))
        },
      )
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [ruleKey, input.timezone, online, viewOnly, computerId] by design; the values it reads beyond these are current as of that run
  }, [ruleKey, input.timezone, online, viewOnly, computerId])

  const problem = validateInput(input, Date.now(), lang)
  const save = async () => {
    if (viewOnly || !online) return
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const moving = !!existing && computerId !== ownerId
      await auto.saveSchedule(computerId, input, moving ? undefined : existing?.id)
      if (moving && existing) {
        const from = store.computers.find((pc) => pc.id === ownerId)?.name ?? ''
        const to = store.computers.find((pc) => pc.id === computerId)?.name ?? ''
        Alert.alert(say('Saved on {0}. Remove it from {1}?', { 0: to, 1: from }), undefined, [
          { text: say('Keep both'), style: 'cancel', onPress: () => goBackOrHome(router) },
          {
            text: say('Remove'),
            style: 'destructive',
            onPress: () => void auto.deleteSchedule(ownerId, existing.id).finally(() => goBackOrHome(router)),
          },
        ])
        return
      }
      goBackOrHome(router)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  const projectName =
    input.projectId === NO_PROJECT
      ? t.noProject
      : (projects.find((p) => p.id === scoped(computerId, input.projectId))?.name ?? input.projectId)
  const model: ModelChoice = {
    provider: input.settings.provider,
    model: input.settings.model,
    effort: input.settings.effort ?? '',
    settings: {
      access: input.settings.access,
      autoFallback: input.settings.autoFallback,
      serviceTier: input.settings.serviceTier,
    },
  }

  const chooseModel = (m: ModelChoice) =>
    patch({
      settings: {
        ...input.settings,
        provider: m.provider,
        model: m.model,
        effort: (m.effort || null) as ScheduleInput['settings']['effort'],
        access: m.settings?.access ?? input.settings.access,
        autoFallback: m.settings?.autoFallback ?? input.settings.autoFallback,
        serviceTier: m.settings?.serviceTier ?? input.settings.serviceTier,
      },
    })

  if (viewOnly)
    return (
      <Screen bg="canvas">
        <Header modal title={existing ? t.editSchedule : t.newSchedule} subtitle={pc?.name} />
        <PageScrollView contentContainerStyle={{ padding: space.l }}>
          <T accessibilityRole="alert" tone="muted">
            {VIEW_ONLY_SCHEDULE_NOTICE[lang]}
          </T>
        </PageScrollView>
      </Screen>
    )

  return (
    <Screen bg="canvas" scrollable={false}>
      <Header
        modal
        title={existing ? t.editSchedule : t.newSchedule}
        subtitle={store.computers.find((pc) => pc.id === computerId)?.name}
      />
      <PageScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          padding: space.l,
          gap: space.l + 4,
          paddingBottom: Platform.OS === 'ios' ? space.xl : insets.bottom + 96,
        }}
      >
        {hosts.length > 1 ? (
          <Field label={say('Runs on')}>
            <Segmented
              value={computerId}
              onChange={(next) => {
                setComputerId(next)
                // Projects are per host; that host checks the model when the schedule is saved.
                patch({ projectId: NO_PROJECT, workspaceId: null })
              }}
              options={hosts.map((pc) => ({ key: pc.id, label: pc.name }))}
            />
          </Field>
        ) : null}
        <Field label={t.name}>
          <TextField
            value={input.name}
            maxLength={200}
            placeholder={t.namePlaceholder}
            onChangeText={(name) => patch({ name })}
          />
        </Field>
        <Field label={t.prompt}>
          <TextField
            multiline
            value={input.prompt}
            maxLength={100_000}
            placeholder={t.promptPlaceholder}
            onChangeText={(prompt) => patch({ prompt })}
          />
        </Field>
        <Field label={t.scope}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            <Row
              onPress={() => setProjectSheet(true)}
              style={{ backgroundColor: c.raised2, borderRadius: 999, paddingVertical: 8, minHeight: 0, flexShrink: 1 }}
            >
              <Folder size={14} color={c.soft} />
              <T weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
                {projectName}
              </T>
            </Row>
            <ModelChip value={model} computerId={computerId} onChange={chooseModel} />
          </View>
        </Field>

        {rule.kind === 'webhook' ? (
          <Field label={t.repeat}>
            <T tone="soft">{describeRule(rule, lang)}</T>
            <T size={font.caption} tone="muted">
              {say('Set up the trigger, address and secret on a computer, where you can copy them into the sender.')}
            </T>
          </Field>
        ) : (
          <Field label={t.repeat}>
            <Segmented
              value={rule.kind}
              onChange={(kind) => patch({ rule: ruleOfKind(kind, rule) })}
              options={RULE_KINDS.map((kind) => ({ key: kind, label: RULE_LABELS[kind][lang] }))}
            />
          </Field>
        )}

        {rule.kind === 'weekly' ? (
          <Field label={t.days}>
            <WeekdayPicker
              lang={lang}
              value={rule.weekdays}
              onToggle={(day) => patch({ rule: { ...rule, weekdays: toggleWeekday(rule.weekdays, day) } })}
            />
          </Field>
        ) : null}
        {rule.kind === 'monthly' ? (
          <Field label={t.dayOfMonth}>
            <Stepper value={rule.day} min={1} max={31} onChange={(day) => patch({ rule: { ...rule, day } })} />
          </Field>
        ) : null}
        {rule.kind === 'interval' ? (
          <Field label={t.every}>
            <View style={{ gap: space.m }}>
              <Stepper
                value={Math.max(1, Math.round(rule.minutes / factor(unit)))}
                min={unit === 'minutes' ? 5 : 1}
                max={unit === 'minutes' ? 600 : unit === 'hours' ? 168 : 365}
                step={unit === 'minutes' ? 5 : 1}
                onChange={(n) => patch({ rule: { ...rule, minutes: n * factor(unit) } })}
              />
              <Segmented
                value={unit}
                onChange={(next) => {
                  setUnit(next)
                  patch({
                    rule: { ...rule, minutes: Math.max(5, Math.round(rule.minutes / factor(unit)) * factor(next)) },
                  })
                }}
                options={UNITS.map((u) => ({ key: u.key, label: u.label }))}
              />
            </View>
          </Field>
        ) : null}
        {rule.kind === 'once' ? (
          <Field label={t.date}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
              <Stepper
                value={0}
                min={-1}
                max={1}
                format={() =>
                  onceDay.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })
                }
                onChange={(delta) => {
                  const next = addDays(onceDay, delta)
                  setOnceDay(next)
                  patch({ rule: { kind: 'once', at: onceInstant(next, hhmm(rule.at)) } })
                }}
              />
            </View>
          </Field>
        ) : null}
        {rule.kind !== 'interval' && rule.kind !== 'webhook' ? (
          <Field label={t.time}>
            <TimeField
              value={rule.kind === 'once' ? hhmm(rule.at) : rule.time}
              onChange={(time) =>
                patch({
                  rule: rule.kind === 'once' ? { kind: 'once', at: onceInstant(onceDay, time) } : { ...rule, time },
                })
              }
            />
          </Field>
        ) : null}

        {rule.kind !== 'webhook' ? (
          <Field label={t.missedPolicy}>
            <Segmented
              value={input.missedPolicy}
              onChange={(missedPolicy) => patch({ missedPolicy })}
              options={[
                { key: 'latest', label: t.runLatest },
                { key: 'skip', label: t.skipIt },
              ]}
            />
          </Field>
        ) : null}

        {rule.kind !== 'webhook' ? (
          <Field label={t.upcoming}>
            <View style={{ gap: 4 }}>
              <T tone="soft" weight="500">
                {describeRule(rule, lang, input.timezone)}
              </T>
              {preview.slice(0, 5).map((at) => (
                <T key={at} size={font.control} tone="muted">
                  {formatWhen(at, input.timezone, lang)}
                </T>
              ))}
              {previewError ? (
                <T size={font.control} tone="bad">
                  {previewError}
                </T>
              ) : null}
              <T size={font.caption} tone="muted">{`${t.timezone}: ${input.timezone}`}</T>
            </View>
          </Field>
        ) : null}
        {error ? (
          <T tone="bad" size={font.control}>
            {error}
          </T>
        ) : null}
        {!online ? (
          <T tone="warn" size={font.control}>
            {t.offlineNeeded}
          </T>
        ) : null}
      </PageScrollView>
      {Platform.OS === 'ios' ? (
        // The system's floating bottom toolbar, as Settings and Search use, with a native prominent button.
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            variant="prominent"
            tintColor={c.primary}
            disabled={busy || !online || Boolean(problem)}
            accessibilityLabel={t.save}
            onPress={() => void save()}
          >
            {busy ? '…' : t.save}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Spacer />
        </Stack.Toolbar>
      ) : (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, space.m) }}>
          <ReadableColumn style={{ paddingHorizontal: space.l }}>
            <GlassButton
              primary
              title={busy ? '…' : t.save}
              icon={busy ? undefined : Check}
              disabled={busy || !online || Boolean(problem)}
              onPress={() => void save()}
            />
          </ReadableColumn>
        </View>
      )}
      {busy ? <ActivityIndicator style={{ position: 'absolute', alignSelf: 'center', top: 120 }} /> : null}
      <Sheet open={projectSheet} onClose={() => setProjectSheet(false)} title={t.scope}>
        <SheetGroup>
          {[
            { id: NO_PROJECT, name: t.noProject },
            // The computer knows projects by their own id; the phone's ids carry the computer in front.
            ...projects.map((p) => ({ id: p.id.slice(p.id.indexOf(':') + 1), name: p.name })),
          ].map((p) => (
            <SheetOption
              key={p.id}
              icon={p.id === NO_PROJECT ? MessagesSquare : Folder}
              title={p.name}
              selected={p.id === input.projectId}
              onPress={() => {
                patch({ projectId: p.id, workspaceId: null })
                setProjectSheet(false)
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
    </Screen>
  )
}

/** "HH:mm" of an ISO instant, in this device's timezone. */
function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
