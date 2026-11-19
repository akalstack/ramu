import { Platform, View } from 'react-native'
import {
  emptyLayers,
  inheritedPreview,
  offeredScopes,
  resolvePreference,
  setOverride,
  type DeviceKind,
  type PreferenceScope,
  type PreferenceSource,
} from '@ramu/shared/preferenceScopes'
import { fill, useT, type Strings } from '../i18n'
import { font, space, useTheme } from '../theme'
import { Button, T } from './ui'

export const deviceKind = (): DeviceKind =>
  Platform.OS === 'web' ? 'unknown' : Platform.OS === 'ios' && Platform.isPad ? 'tablet' : 'phone'

export function scopeText(t: Strings, scope: PreferenceScope, kind: DeviceKind): string {
  if (scope === 'all') return t.scopeAll
  if (scope === 'mobile') return t.scopeMobile
  return kind === 'phone' ? t.scopeThisPhone : kind === 'tablet' ? t.scopeThisTablet : t.scopeThisDevice
}

export function sourceText(t: Strings, source: PreferenceSource, kind: DeviceKind): string {
  if (source === 'all') return t.scopeUsingAll
  if (source === 'mobile') return t.scopeUsingMobile
  if (source === 'device')
    return kind === 'phone' ? t.scopeSetOnPhone : kind === 'tablet' ? t.scopeSetOnTablet : t.scopeSetHere
  return t.scopeBuiltIn
}

/**
 * Shows where a setting applies and where its value comes from, with the inherited value previewed before a narrower
 * override is removed. Only this device is writable until a sync transport exists; the shared scopes say why they are
 * unavailable instead of appearing to save.
 */
export function ScopeControl({
  field,
  overridden,
  inheritedLabel,
  onUseInherited,
  sharedMobile = false,
}: {
  field: string
  /** True when this device holds its own value for the field. */
  overridden: boolean
  /** Display text for the value the field falls back to when the device override is removed. */
  inheritedLabel: string
  onUseInherited: () => void
  /** The selected computer holds the all-mobile layer for this field, so that scope is offered, not described as missing. */
  sharedMobile?: boolean
}) {
  const t = useT()
  const { c } = useTheme()
  const kind = deviceKind()
  const layers = overridden ? setOverride(emptyLayers(), 'device', field, true, 'this-device', 0) : emptyLayers()
  const { source } = resolvePreference(layers, field)
  const unavailable = offeredScopes(field, kind, { shared: false, mobile: sharedMobile }).filter((o) => !o.enabled)
  const preview = overridden ? inheritedPreview(layers, field, 'device') : null
  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.s, gap: space.xs }}>
      <T size={font.caption} tone="muted">
        {`${t.scopeApplyTo}: ${scopeText(t, 'device', kind)}. ${sourceText(t, source, kind)}.`}
      </T>
      {unavailable.length ? (
        <T size={font.caption} tone="muted">
          {`${unavailable.map((o) => scopeText(t, o.scope, kind)).join(' · ')}: ${t.scopeNeedsSync}`}
        </T>
      ) : null}
      <T size={font.caption} tone="muted">
        {t.scopeKeepsOwn}
      </T>
      {preview ? (
        <View style={{ gap: space.xs, alignItems: 'flex-start', paddingTop: space.xs }}>
          <T size={font.caption} style={{ color: c.soft }}>
            {fill(t.scopeInheritedPreview, inheritedLabel)}
          </T>
          <Button kind="secondary" title={t.scopeUseInherited} onPress={onUseInherited} />
        </View>
      ) : null}
    </View>
  )
}
