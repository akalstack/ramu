import { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { translate } from '@ramu/shared/i18n'
import { parseTheme, type RamuTheme } from '@ramu/shared/theme'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, Card, T } from './ui'

const SWATCHES = ['window', 'canvas', 'raised', 'primary', 'accent', 'ok', 'warn', 'bad'] as const

/**
 * A theme an agent drafted in this thread. **Preview theme** starts the same trial as an imported file and opens
 * Appearance, where the always-visible Keep / Revert bar decides: nothing changes for good until the person keeps it.
 */
export function ThemeProposal({ theme }: { theme: RamuTheme }) {
  const { language } = useStore()
  const { c, scheme, tryTheme } = useTheme()
  const router = useRouter()
  const t = (key: string) => translate(language, key)
  const parsed = useMemo(() => parseTheme(theme), [theme])
  if (!parsed.ok) return null
  const variant = parsed.theme[scheme]
  return (
    <Card style={{ padding: space.m, gap: space.s }}>
      <T weight="600" numberOfLines={1}>
        {parsed.theme.name}
      </T>
      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no">
        {SWATCHES.map((role) => (
          <View
            key={role}
            style={{
              width: 18,
              height: 18,
              borderRadius: radius.xs,
              backgroundColor: variant.colors[role],
              borderWidth: 1,
              borderColor: c.lineStrong,
            }}
          />
        ))}
      </View>
      <T size={font.caption} tone="muted">
        {t('Drafted by the agent. Nothing changes until you keep it.')}
      </T>
      <Button
        title={t('Preview theme')}
        onPress={() => {
          tryTheme(parsed.theme)
          router.push({ pathname: '/settings/[section]', params: { section: 'appearance' } })
        }}
      />
    </Card>
  )
}
