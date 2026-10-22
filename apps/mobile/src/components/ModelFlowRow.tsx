import { useState } from 'react'
import { Platform, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import type { ModelFlow } from '@ramu/shared/modelFlow'
import { scopeLabel, sourceLabel, type DeviceKind, type PreferenceScope } from '@ramu/shared/preferenceScopes'
import { space } from '../theme'
import { useStore } from '../runtime/store'
import { useModelFlow } from '../runtime/useModelFlow'
import { Row, Segmented, T } from './ui'
import { Hint, RowLabel } from './SettingRows'

const deviceKind = (): DeviceKind =>
  Platform.OS === 'web' ? 'unknown' : Platform.OS === 'ios' && Platform.isPad ? 'tablet' : 'phone'

/**
 * Steps versus Model then effort, with an explicit **Apply to** scope. All devices is the computer's own setting
 * (desktop and every phone without its own choice); All mobile devices is kept on the computer for its paired phones;
 * This phone stays on this device. Narrower settings survive a broader change, and one tap returns to the inherited value.
 */
export function ModelFlowRow({
  title,
  help,
  options,
  save,
  disabled,
}: {
  title: string
  help?: string
  options: { value: unknown; label: string }[]
  /** Saves the computer's own setting (the all-device baseline). */
  save: (value: ModelFlow) => void
  disabled?: boolean
}) {
  const { language, selected } = useStore()
  const flow = useModelFlow(selected)
  const kind = deviceKind()
  const tr = (text: string) => translate(language, text)
  const [scope, setScope] = useState<PreferenceScope>('all')
  const label = (value: unknown) => tr(options.find((o) => o.value === value)?.label ?? String(value))
  const hasOverride = scope !== 'all' && flow.overridden[scope]
  const scoped = scope === 'mobile' && !flow.sharedAvailable
  const choose = (value: ModelFlow) => {
    if (scope === 'all') save(value)
    else if (scope === 'device') flow.setDevice(value)
    else void flow.setMobile(value)
  }
  const clear = () => {
    if (scope === 'device') flow.setDevice(null)
    else if (scope === 'mobile') void flow.setMobile(null)
  }
  const inherited = scope === 'all' ? null : flow.inherited(scope)
  const shownScope = (s: PreferenceScope) => tr(scopeLabel(s, kind))
  const source = flow.effective.source === 'all' || flow.effective.source === 'default' ? 'all' : flow.effective.source
  return (
    <View>
      <Row style={{ paddingVertical: space.m }}>
        <RowLabel title={tr(title)} help={help ? tr(help) : undefined} />
      </Row>
      <View style={{ paddingHorizontal: space.l, gap: space.s, paddingBottom: space.s }}>
        <T size={12} tone="muted">
          {tr('Apply to')}
        </T>
        <Segmented<PreferenceScope>
          value={scope}
          onChange={setScope}
          options={[
            { key: 'all', label: shownScope('all') },
            { key: 'mobile', label: shownScope('mobile') },
            { key: 'device', label: shownScope('device') },
          ]}
        />
        <Segmented<ModelFlow>
          value={
            scope === 'all'
              ? flow.host
              : hasOverride
                ? flow.effective.value
                : (inherited?.value ?? flow.effective.value)
          }
          onChange={(value) => {
            if (!disabled && !scoped) choose(value)
          }}
          options={options.map((o) => ({ key: o.value as ModelFlow, label: label(o.value) }))}
        />
      </View>
      <Hint>
        {`${tr(sourceLabel(source, kind))}: ${label(flow.effective.value)}. ${tr('Devices with their own setting keep it.')}`}
      </Hint>
      {scoped ? (
        <Hint>{tr('This computer needs an update before it can share a setting with all mobile devices.')}</Hint>
      ) : null}
      {scope !== 'all' && hasOverride && inherited ? (
        <Row accessibilityRole="button" onPress={clear} style={{ paddingVertical: space.s }}>
          <T tone="accent">{`${tr('Use inherited setting')} (${label(inherited.value)})`}</T>
        </Row>
      ) : null}
      {flow.pending ? <Hint>{tr('Saving…')}</Hint> : null}
      {flow.error ? <Hint>{`${tr('Could not save')}: ${flow.error}`}</Hint> : null}
    </View>
  )
}
