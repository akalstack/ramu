import { RowLabel } from './SettingRowContent'
export { RowLabel, Hint } from './SettingRowContent'
import { useState, type ReactNode } from 'react'
import { translate } from '@ramu/shared/i18n'
import { ModelFlowRow } from './ModelFlowRow'
import { useStore } from '../runtime/store'
import { ActivityIndicator, TextInput, View } from 'react-native'
import { Check, ChevronsUpDown } from 'lucide-react-native'
import type { LimitChoice } from '@ramu/shared/chat/limitPolicy'
import { font, radius, space, useTheme } from '../theme'
import {
  allowedOptions,
  limitChoiceEdits,
  limitChoiceState,
  visibleGroups,
  type SettingRow,
  type SettingsSection,
  type Option,
} from '../runtime/settingsModel'
import type { useHostSettings } from '../runtime/useHostSettings'
import { Button, Card, Divider, Row, SectionLabel, Sheet, T, Toggle, tap } from './ui'

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
    <Row
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      style={{ paddingVertical: space.m, opacity: disabled ? 0.5 : 1 }}
      onPress={() => onChange(!value)}
    >
      <RowLabel title={title} help={help} />
      <Toggle accessibilityLabel={title} disabled={disabled} value={value} onValueChange={onChange} />
    </Row>
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
      <Row
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${current?.label ?? String(value)}`}
        disabled={disabled}
        style={{ paddingVertical: space.m, opacity: disabled ? 0.5 : 1 }}
        onPress={() => setOpen(true)}
      >
        <RowLabel title={title} help={help} />
        <T size={font.control} tone="muted" numberOfLines={1} style={{ maxWidth: '40%' }}>
          {current?.label ?? String(value ?? '')}
        </T>
        <ChevronsUpDown size={15} color={c.muted} />
      </Row>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Row
              key={String(option.value)}
              accessibilityRole="menuitem"
              accessibilityState={{ selected }}
              onPress={() => {
                tap()
                setOpen(false)
                if (!selected) onChange(option.value)
              }}
            >
              <T style={{ flex: 1 }} weight={selected ? '600' : '400'}>
                {option.label}
              </T>
              {selected ? <Check size={17} color={c.primary} /> : null}
            </Row>
          )
        })}
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
  )
}

/** One computer-side row, drawn from its definition and the live value. */
function HostRow({ row, host, disabled }: { row: SettingRow; host: Host; disabled?: boolean }) {
  const { language } = useStore()
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
  return (
    <ChoiceRow
      title={row.title}
      help={row.help}
      value={value}
      options={allowedOptions(row.options, schema, value)}
      disabled={disabled}
      onChange={(next) => host.set(row.path, next)}
    />
  )
}

/** Explains why a computer's settings aren't on screen, with the one action that can help. */
export function HostNotice({ host, name, children }: { host: Host; name?: string; children?: ReactNode }) {
  const { state } = host
  if (state.status === 'ready') return <>{children}</>
  return (
    <View style={{ padding: space.xl, gap: space.m, alignItems: 'center' }}>
      {state.status === 'loading' ? <ActivityIndicator /> : null}
      <T tone="muted" style={{ textAlign: 'center', lineHeight: 21 }}>
        {state.status === 'loading'
          ? `Loading settings from ${name ?? 'this computer'}…`
          : state.status === 'offline'
            ? `${name ?? 'This computer'} is not reachable, so its settings can't be shown. Phone settings still work.`
            : state.status === 'outdated'
              ? `Update Ramu on ${name ?? 'this computer'} to change its settings from your phone.`
              : state.message}
      </T>
      {state.status === 'error' ? <Button title="Try again" onPress={host.reload} /> : null}
    </View>
  )
}

/** A section's computer-side rows in the desktop's groups. */
export function HostGroups({ section, host, name }: { section: SettingsSection; host: Host; name?: string }) {
  const { language } = useStore()
  if (host.state.status !== 'ready') return <HostNotice host={host} name={name} />
  const groups = visibleGroups(section, host.state.settings, host.read)
  if (!groups.length)
    return (
      <T tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
        {name ?? 'This host'} offers no settings here.
      </T>
    )
  return (
    <>
      {groups.map((group) => (
        <View key={group.title ?? 'rows'}>
          {group.title ? <SectionLabel>{translate(language, group.title)}</SectionLabel> : null}
          <Card style={{ marginHorizontal: space.l }}>
            {group.rows.map((row, index) => (
              <View key={row.path}>
                {index ? <Divider inset={space.l} /> : null}
                <HostRow row={row} host={host} />
              </View>
            ))}
          </Card>
        </View>
      ))}
    </>
  )
}
