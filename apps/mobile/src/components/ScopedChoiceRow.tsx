import { useState } from 'react'
import { View } from 'react-native'
import type { PreferenceScope } from '@ramu/shared/preferenceScopes'
import { font, space } from '../theme'
import { useSay, useT, type Strings } from '../i18n'
import type { ScopeBlock, ScopedChoiceControl } from '../runtime/useScopedChoice'
import { deviceKind, scopeText, sourceText } from './ScopeControl'
import { SettingHighlight } from './SettingHighlight'
import { Hint, RowLabel } from './SettingRowContent'
import { Row, Segmented, T } from './ui'

const blockText = (t: Strings, block: ScopeBlock) =>
  block === 'host-update'
    ? t.sharedNeedsHost
    : block === 'viewer'
      ? t.scopeViewerBlocked
      : block === 'permission'
        ? t.scopeSettingsBlocked
        : t.scopeOfflineBlocked

/**
 * One preference with an explicit **Apply to** scope: All devices is the computer's own setting, All mobile devices is
 * kept on the computer for every paired phone, and This phone stays on this device. The row opens on the scope the
 * current value comes from and says so; narrower settings survive a broader change, and one tap returns a narrower
 * scope to what it inherits.
 */
export function ScopedChoiceRow<V extends string>({
  title,
  help,
  options,
  control,
}: {
  /** English copy key; also the title a settings search leads to. */
  title: string
  help?: string
  /** Labels already translated. */
  options: { key: V; label: string }[]
  control: ScopedChoiceControl<V>
}) {
  const t = useT()
  const say = useSay()
  const kind = deviceKind()
  const [scope, setScope] = useState<PreferenceScope>(
    control.effective.source === 'default' ? 'all' : control.effective.source,
  )
  const label = (value: V) => options.find((o) => o.key === value)?.label ?? value
  const own = control.held[scope]
  const inherited = scope === 'all' ? null : control.inherited(scope)
  const shown = own ?? inherited?.value ?? control.effective.value
  const block = control.blocked[scope]
  const source = control.effective.source === 'default' ? 'all' : control.effective.source
  return (
    <SettingHighlight title={title}>
      <Row style={{ paddingVertical: space.m }}>
        <RowLabel title={say(title)} help={help} />
      </Row>
      <View style={{ paddingHorizontal: space.l, gap: space.s, paddingBottom: space.s }}>
        <T size={font.caption} tone="muted">
          {t.scopeApplyTo}
        </T>
        <Segmented<PreferenceScope>
          value={scope}
          onChange={setScope}
          options={[
            { key: 'all', label: scopeText(t, 'all', kind) },
            { key: 'mobile', label: scopeText(t, 'mobile', kind) },
            { key: 'device', label: scopeText(t, 'device', kind) },
          ]}
        />
        <Segmented<V>
          value={shown}
          onChange={(value) => {
            if (!block) control.set(scope, value)
          }}
          options={options}
        />
      </View>
      <Hint>{`${sourceText(t, source, kind)}: ${label(control.effective.value)}. ${t.scopeKeepsOwn}`}</Hint>
      {block ? <Hint>{blockText(t, block)}</Hint> : null}
      {scope !== 'all' && own !== undefined && inherited && !block ? (
        <Row accessibilityRole="button" onPress={() => control.set(scope, null)} style={{ paddingVertical: space.s }}>
          <T tone="accent">{`${t.scopeUseInherited} (${label(inherited.value)})`}</T>
        </Row>
      ) : null}
      {control.pending ? <Hint>{t.sharedSaving}</Hint> : null}
      {control.error ? <Hint>{`${say('Could not save')}: ${control.error}`}</Hint> : null}
    </SettingHighlight>
  )
}
