import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { ContextUsage } from '@ramu/shared/types'
import { font, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { T } from './ui'
import Svg, { Circle } from 'react-native-svg'

const CIRCUMFERENCE = 2 * Math.PI * 5.5

/** How full the chat's context window is, like the desktop's ring beside the model: green, amber from 80%, red from 95%. */
export function ContextMeter({ computerId, sessionId }: { computerId: string; sessionId: string | null }) {
  const store = useStore()
  const { c } = useTheme()
  const [context, setContext] = useState<ContextUsage | null>(null)
  const online = store.isOnline(computerId)
  useEffect(() => {
    setContext(null)
    if (!sessionId || !online) return
    let alive = true
    void store.invoke(computerId, 'agent.context', sessionId).then(
      (value) => {
        if (alive) setContext(value)
      },
      () => {},
    )
    const unwatch = store.watch(computerId, ['context:changed'], { 'context:changed': [sessionId] })
    const off = store.subscribe(computerId, (channel, payload) => {
      if (channel === 'context:changed' && payload.sessionId === sessionId) setContext(payload.context)
    })
    return () => {
      alive = false
      off()
      unwatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computerId, sessionId, online] by design; the values it reads beyond these are current as of that run
  }, [computerId, sessionId, online])
  if (!context) return null
  const color = context.percent >= 95 ? c.bad : context.percent >= 80 ? c.warn : c.muted
  // At least a visible dot, so a nearly empty context still reads as a ring with progress.
  const arc = Math.max(1.5, (Math.min(100, context.percent) / 100) * CIRCUMFERENCE)
  const k = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`)
  return (
    <View
      accessible
      accessibilityLabel={`Context ${Math.round(context.percent)}% used, ${k(context.used)} of ${k(context.max)} tokens`}
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
