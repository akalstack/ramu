import { RowLabel } from './SettingRowContent'
export { RowLabel, Hint } from './SettingRowContent'
import { useState, type ReactNode } from 'react'
import { translate } from '@ramu/shared/i18n'
import { ModelFlowRow } from './ModelFlowRow'
import { useStore, type Language } from '../runtime/store'
import { accountName, modelStepLabel, providerAccountOrder } from '@ramu/shared/providers/providers'
import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import type { WorkModel, WorkModelChoice } from '@ramu/shared/providers/workModel'
import { useAccountLogins } from '../runtime/useAccountLogins'
import type { AgentProvider, ModelPreferences, ReasoningEffort } from '@ramu/shared/types'
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { AgentSettingMark } from '@ramu/shared/settingsCompatibility'
import { ChevronDown, ChevronsUpDown, RotateCcw } from 'lucide-react-native'
import type { LimitChoice } from '@ramu/shared/chat/limitPolicy'
import { font, radius, space, useTheme } from '../theme'
import {
  allowedOptions,
  limitChoiceEdits,
  limitChoiceState,
  rowDefaultEdits,
  sectionLabel,
  splitAdvanced,
  visibleGroups,
  type RowGroup,
  type SettingRow,
  type SettingsSection,
  type Option,
} from '../runtime/settingsModel'
import type { useHostSettings } from '../runtime/useHostSettings'
import { Button, Card, Divider, Row, SectionLabel, Sheet, T, Toggle } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'
import { SettingHighlight, useSettingTargetTitle } from './SettingHighlight'
import { useSay } from '../i18n'

type Host = ReturnType<typeof useHostSettings>

export function ToggleRow({
  title,
  help,
  value,
  onChange,
  disabled,
}: {
  title: string
  help?: string
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <SettingHighlight title={title}>
      <Row
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        style={{ paddingVertical: space.m, opacity: disabled ? 0.5 : 1 }}
        onPress={() => onChange(!value)}
      >
        <RowLabel title={title} help={help} />
        {/* Its own column, so the switch centres on a multi-line label even where the native frame stretches. */}
        <View style={{ alignSelf: 'stretch', justifyContent: 'center' }}>
          <Toggle accessibilityLabel={title} disabled={disabled} value={value} onValueChange={onChange} />
        </View>
      </Row>
    </SettingHighlight>
  )
}

export function ChoiceRow({
  title,
  help,
  value,
  options,
  onChange,
  disabled,
}: {
  title: string
  help?: string
  value: unknown
  options: Option[]
  onChange: (value: Option['value']) => void
  disabled?: boolean
}) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)
  return (
    <>
      <SettingHighlight title={title}>
        <Row
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${current?.label ?? String(value)}`}
          disabled={disabled}
          style={{ paddingVertical: space.m, opacity: disabled ? 0.5 : 1 }}
          onPress={() => setOpen(true)}
        >
          {/* The value sits under the explanation, not beside it, so neither is squeezed into a narrow column and cut off. */}
          <View style={{ flex: 1, gap: space.s }}>
            <RowLabel title={title} help={help} />
            <View
              style={{
                alignSelf: 'flex-start',
                maxWidth: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
                backgroundColor: c.fill,
                borderRadius: radius.s + 2,
                paddingHorizontal: space.m,
                paddingVertical: space.xs + 2,
              }}
            >
              <T size={font.control} weight="500" numberOfLines={2} style={{ flexShrink: 1 }}>
                {current?.label ?? String(value ?? '')}
              </T>
              <ChevronsUpDown size={14} color={c.muted} />
            </View>
          </View>
        </Row>
      </SettingHighlight>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <SheetGroup footer={help}>
          {options.map((option) => (
            <SheetOption
              key={String(option.value)}
              title={option.label}
              selected={option.value === value}
              onPress={() => {
                setOpen(false)
                if (option.value !== value) onChange(option.value)
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
    </>
  )
}

/** Free text, saved when you leave the field rather than on every keystroke. */
export function TextRow({
  title,
  help,
  value,
  placeholder,
  maxLength,
  onCommit,
  disabled,
}: {
  title: string
  help?: string
  value: string
  placeholder?: string
  maxLength?: number
  onCommit: (value: string) => void
  disabled?: boolean
}) {
  const { c } = useTheme()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <SettingHighlight title={title}>
      <View style={{ padding: space.l, gap: space.s, opacity: disabled ? 0.5 : 1 }}>
        <RowLabel title={title} help={help} />
        <TextInput
          editable={!disabled}
          multiline
          maxLength={maxLength}
          value={draft ?? value}
          placeholder={placeholder}
          placeholderTextColor={c.placeholder}
          accessibilityLabel={title}
          onChangeText={setDraft}
          onBlur={() => {
            if (draft !== null && draft !== value) onCommit(draft)
            setDraft(null)
          }}
          style={{
            minHeight: 88,
            textAlignVertical: 'top',
            color: c.text,
            fontSize: font.body,
            backgroundColor: c.fill,
            borderRadius: radius.s + 2,
            padding: space.m,
          }}
        />
      </View>
    </SettingHighlight>
  )
}

type StepValue = { provider: AgentProvider; model: string; effort: ReasoningEffort | null } | null

/**
 * A model chosen from the host's model steps, as the desktop's Writing model and background model rows offer them.
 * The steps and their names come from the host, so the phone lists exactly what the desktop does.
 */
function ModelStepRow({
  row,
  host,
  value,
  disabled,
}: {
  row: Extract<SettingRow, { kind: 'model' }>
  host: Host
  value: unknown
  disabled?: boolean
}) {
  const store = useStore()
  const sets = (host.read('$models') as ModelPreferences | undefined)?.sets ?? []
  const steps = sets.flatMap((set) => set.steps)
  const catalogs = store.catalogs[host.computerId] ?? []
  const current = value as StepValue
  const chosen =
    steps.find(
      (step) => step.provider === current?.provider && step.model === current.model && step.effort === current.effort,
    )?.id ?? ''
  return (
    <ChoiceRow
      title={row.title}
      help={row.help}
      value={chosen}
      options={[
        { value: '', label: row.emptyLabel },
        ...steps.map((step) => ({ value: step.id, label: modelStepLabel(step, catalogs) })),
      ]}
      disabled={disabled}
      onChange={(id) => {
        const step = steps.find((entry) => entry.id === id)
        host.set(
          row.path,
          step
            ? {
                ...(row.withId ? { id: step.id } : {}),
                provider: step.provider,
                model: step.model,
                effort: step.effort,
              }
            : null,
        )
      }}
    />
  )
}

/**
 * The model one kind of Ramu's own work runs on, as on the desktop: the thread's own, the default model, or one model the
 * person keeps visible, then its effort and, for a provider with several logins, which login it runs on.
 */
function WorkModelRow({
  row,
  host,
  value,
  disabled,
}: {
  row: Extract<SettingRow, { kind: 'work-model' }>
  host: Host
  value: unknown
  disabled?: boolean
}) {
  const store = useStore()
  const say = useSay()
  const catalogs = store.catalogs[host.computerId] ?? []
  const preferences = store.appPreferences[host.computerId]
  const choice = (value ?? null) as WorkModelChoice
  const explicit: WorkModel | null = choice && !('use' in choice) ? choice : null
  const models = catalogs.flatMap((catalog) =>
    catalog.models
      .filter(
        (model) =>
          (!model.isLegacy &&
            isModelListed(preferences?.visibleModels, { provider: catalog.provider, id: model.id })) ||
          (explicit?.provider === catalog.provider && explicit.model === model.id),
      )
      .map((model) => ({ ...model, provider: catalog.provider })),
  )
  const key = (provider: string, model: string) => `${provider}\n${model}`
  const chosen = explicit && models.find((model) => model.provider === explicit.provider && model.id === explicit.model)
  const order = explicit ? providerAccountOrder(preferences?.providerBinaries, explicit.provider) : []
  const logins = useAccountLogins([host.computerId], order.length > 1)[host.computerId]
  return (
    <>
      <ChoiceRow
        title={row.title}
        help={row.help}
        value={explicit ? key(explicit.provider, explicit.model) : choice && 'use' in choice ? choice.use : 'thread'}
        options={[
          { value: 'thread', label: say('Same as thread') },
          { value: 'default', label: say('Default model') },
          ...models.map((model) => ({
            value: key(model.provider, model.id),
            label: modelStepLabel({ provider: model.provider, model: model.id, effort: null }, catalogs),
          })),
        ]}
        disabled={disabled}
        onChange={(next) => {
          if (next === 'thread' || next === 'default') return host.set(row.path, { use: next })
          const model = models.find((entry) => key(entry.provider, entry.id) === next)
          if (!model) return
          const accountId = explicit?.provider === model.provider ? explicit.accountId : undefined
          host.set(row.path, {
            provider: model.provider,
            model: model.id,
            effort: model.defaultEffort ?? null,
            ...(accountId ? { accountId } : {}),
          })
        }}
      />
      {explicit && chosen && chosen.efforts.length > 1 ? (
        <ChoiceRow
          title={say('Effort')}
          value={explicit.effort ?? chosen.defaultEffort ?? chosen.efforts[0]}
          options={chosen.efforts.map((effort) => ({
            value: effort,
            label: modelStepLabel({ provider: explicit.provider, model: explicit.model, effort }, catalogs),
          }))}
          disabled={disabled}
          onChange={(effort) => host.set(row.path, { ...explicit, effort })}
        />
      ) : null}
      {explicit && order.length > 1 ? (
        <ChoiceRow
          title={say('Account')}
          value={explicit.accountId && order.includes(explicit.accountId) ? explicit.accountId : order[0]}
          options={order.map((id) => ({
            value: id,
            label: accountName(
              preferences?.providerBinaries,
              explicit.provider,
              id,
              logins?.[explicit.provider]?.[id],
              say,
            ),
          }))}
          disabled={disabled}
          onChange={(accountId) => host.set(row.path, { ...explicit, accountId })}
        />
      ) : null}
    </>
  )
}

/** One computer-side row, drawn from its definition and the live value. */
function HostRow({ row, host, disabled }: { row: SettingRow; host: Host; disabled?: boolean }) {
  if (row.path === '$models.defaultBarMode' && row.kind === 'choice')
    return (
      <ModelFlowRow
        title={row.title}
        help={row.help}
        options={row.options}
        disabled={disabled}
        save={(next) => host.set(row.path, next)}
      />
    )
  const value = host.read(row.path)
  if (row.kind === 'toggle')
    return (
      <ToggleRow
        title={row.title}
        help={row.help}
        value={value === true}
        disabled={disabled}
        onChange={(next) => host.set(row.path, next)}
      />
    )
  if (row.kind === 'limit') {
    const { current, options } = limitChoiceState(host.read, row)
    return (
      <ChoiceRow
        title={row.title}
        help={row.help}
        value={current}
        options={options}
        disabled={disabled}
        onChange={(next) => {
          for (const [path, edit] of limitChoiceEdits(next as LimitChoice, host.read, row)) host.set(path, edit)
        }}
      />
    )
  }
  if (row.kind === 'model') return <ModelStepRow row={row} host={host} value={value} disabled={disabled} />
  if (row.kind === 'work-model') return <WorkModelRow row={row} host={host} value={value} disabled={disabled} />
  if (row.kind === 'text')
    return (
      <TextRow
        title={row.title}
        help={row.help}
        placeholder={row.placeholder}
        maxLength={row.maxLength}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onCommit={(next) => host.set(row.path, next)}
      />
    )
  const schema =
    host.state.status === 'ready' ? host.state.settings.find((s) => s.path === row.path)?.schema : undefined
  // An unset setting shows as its unset choice; choosing it removes the setting rather than storing null.
  const unset = row.unsetLabel !== undefined
  const shown = unset && (value === undefined || value === null) ? null : value
  return (
    <ChoiceRow
      title={row.title}
      help={row.help}
      value={shown}
      options={[
        ...(unset ? [{ value: null, label: row.unsetLabel! }] : []),
        ...allowedOptions(row.options, schema, shown === null ? undefined : shown),
      ]}
      disabled={disabled}
      onChange={(next) => host.set(row.path, unset && next === null ? undefined : next)}
    />
  )
}

/** Explains why a computer's settings aren't on screen, with the one action that can help. */
export function HostNotice({ host, name, children }: { host: Host; name?: string; children?: ReactNode }) {
  const say = useSay()
  const { state } = host
  if (state.status === 'ready') return <>{children}</>
  return (
    <View style={{ padding: space.xl, gap: space.m, alignItems: 'center' }}>
      {state.status === 'loading' ? <ActivityIndicator /> : null}
      <T tone="muted" style={{ textAlign: 'center', lineHeight: 21 }}>
        {state.status === 'loading'
          ? name
            ? say('Loading settings from {0}…', { 0: name })
            : say('Loading settings from this computer…')
          : state.status === 'offline'
            ? name
              ? say("{0} is not reachable, so its settings can't be shown. Phone settings still work.", { 0: name })
              : say("This computer is not reachable, so its settings can't be shown. Phone settings still work.")
            : state.message}
      </T>
      {state.status === 'error' ? <Button title={say('Try again')} onPress={host.reload} /> : null}
    </View>
  )
}

/** Under a row an agent changed: a dot and the thread whose agent changed it, which opens that thread. */
function ChangeLine({ mark, computerId }: { mark?: AgentSettingMark; computerId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const router = useRouter()
  if (!mark) return null
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingHorizontal: space.l,
        paddingBottom: space.m,
        marginTop: -space.xs,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
      <Pressable
        accessibilityRole="link"
        style={{ flexShrink: 1 }}
        onPress={() =>
          router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, mark.taskId) } })
        }
      >
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {say('Changed by an agent in {0}', { '0': mark.thread })}
        </T>
      </Pressable>
    </View>
  )
}

/** A page's groups of computer-side rows, each row with its change line. */
function rowGroups(groups: RowGroup[], host: Host, locked: boolean, language: Language) {
  if (host.state.status !== 'ready') return null
  const { marks } = host.state
  return groups.map((group) => (
    <View key={group.title ?? 'rows'}>
      {group.title ? <SectionLabel>{translate(language, group.title)}</SectionLabel> : null}
      <Card style={{ marginHorizontal: space.l }}>
        {group.rows.map((row, index) => (
          <View key={row.path}>
            {index ? <Divider inset={space.l} /> : null}
            <HostRow row={row} host={host} disabled={locked} />
            <ChangeLine mark={marks.find((entry) => entry.path === row.path)} computerId={host.computerId} />
          </View>
        ))}
      </Card>
    </View>
  ))
}

/** Rows few people change, under a fold that starts closed unless a search opened the page for one of them. */
function AdvancedGroups({ groups, host, locked }: { groups: RowGroup[]; host: Host; locked: boolean }) {
  const say = useSay()
  const { c } = useTheme()
  const { language } = useStore()
  const target = useSettingTargetTitle()
  const [open, setOpen] = useState(() => groups.some((group) => group.rows.some((row) => row.title === target)))
  if (!groups.length) return null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          paddingHorizontal: space.l,
          paddingTop: space.l,
          paddingBottom: space.s,
        }}
      >
        <T size={font.caption} tone="muted" weight="500">
          {say('Advanced')}
        </T>
        <ChevronDown size={14} color={c.muted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open ? rowGroups(groups, host, locked, language) : null}
    </>
  )
}

/** A section's computer-side rows in the desktop's groups, with the rows few people change folded under Advanced. */
export function HostGroups({
  section,
  host,
  name,
  locked = false,
  withPanels = false,
}: {
  section: SettingsSection
  host: Host
  name?: string
  /** This device may read the host's settings but not change them. */
  locked?: boolean
  /** The page has panels of its own, so a host with no plain settings for it needs no notice. */
  withPanels?: boolean
}) {
  const say = useSay()
  const { language } = useStore()
  if (host.state.status !== 'ready') return <HostNotice host={host} name={name} />
  const groups = visibleGroups(section, host.state.settings, host.read)
  if (!groups.length && withPanels) return null
  if (!groups.length)
    return (
      <T tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
        {name ? say('{0} offers no settings here.', { 0: name }) : say('This host offers no settings here.')}
      </T>
    )
  const { main, advanced } = splitAdvanced(groups)
  const reset = rowDefaultEdits(
    groups.flatMap((group) => group.rows),
    host.state.settings,
    host.read,
  )
  const resetPage = () =>
    Alert.alert(
      say('Reset {0} to defaults?', { '0': translate(language, sectionLabel(section)) }),
      say('Every setting on this page goes back to its default on {0}.', { '0': name ?? say('This host') }),
      [
        { text: say('Cancel'), style: 'cancel' },
        { text: say('Reset'), style: 'destructive', onPress: () => host.setAll(reset) },
      ],
    )
  return (
    <>
      {rowGroups(main, host, locked, language)}
      <AdvancedGroups groups={advanced} host={host} locked={locked} />
      <View style={{ paddingHorizontal: space.l, paddingTop: space.m, alignItems: 'flex-start' }}>
        <Button
          kind="ghost"
          icon={RotateCcw}
          title={say('Reset defaults')}
          disabled={locked || !reset.length}
          onPress={resetPage}
        />
      </View>
    </>
  )
}
