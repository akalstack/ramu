import { View } from 'react-native'
import { font, useTheme } from '../theme'
import { useContextUsage } from '../runtime/useContextUsage'
import { T } from './ui'
import { useSay } from '../i18n'
import Svg, { Circle } from 'react-native-svg'

const CIRCUMFERENCE = 2 * Math.PI * 5.5

/** How full the chat's context window is, like the desktop's ring beside the model: green, amber from 80%, red from 95%. */
export function ContextMeter({ computerId, sessionId }: { computerId: string; sessionId: string | null }) {
  const { c } = useTheme()
  const say = useSay()
  const context = useContextUsage(computerId, sessionId)
  if (!context) return null
  const color = context.percent >= 95 ? c.bad : context.percent >= 80 ? c.warn : c.muted
  // At least a visible dot, so a nearly empty context still reads as a ring with progress.
  const arc = Math.max(1.5, (Math.min(100, context.percent) / 100) * CIRCUMFERENCE)
  const k = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`)
  return (
    <View
      accessible
      accessibilityLabel={say('Context {0}% used, {1} of {2} tokens', {
        0: Math.round(context.percent),
        1: k(context.used),
        2: k(context.max),
      })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 6 }}
    >
      {/* A ring that fills clockwise from the top, like the desktop's meter. */}
      <Svg width={14} height={14} viewBox="0 0 14 14">
        <Circle cx={7} cy={7} r={5.5} stroke={c.lineStrong} strokeWidth={2} fill="none" />
        <Circle
          cx={7}
          cy={7}
          r={5.5}
          stroke={color}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
          transform="rotate(-90 7 7)"
        />
      </Svg>
      <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
        {Math.round(context.percent)}%
      </T>
    </View>
  )
}
