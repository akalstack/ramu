import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'
import type { MobileLiveActivityContent } from '@ramu/shared/api'

/** Pure SwiftUI layouts serialized into the native ActivityKit extension. */
function WorkActivity(props: MobileLiveActivityContent, environment: LiveActivityEnvironment) {
  'widget'
  const stale = environment.isStale || props.phase === 'paused'
  const attention = !stale && props.waiting > 0
  const id = props.locale === 'id'
  const accent = environment.isLuminanceReduced
    ? '#ffffff'
    : stale
      ? environment.colorScheme === 'light'
        ? '#6b6b73'
        : '#a1a1a8'
      : attention
        ? environment.colorScheme === 'light'
          ? '#b26b00'
          : '#ffb340'
        : environment.colorScheme === 'light'
          ? '#5b40ad'
          : '#b7a6f3'
  const symbol = stale
    ? 'arrow.clockwise.circle'
    : attention
      ? 'exclamationmark.circle.fill'
      : props.phase === 'finished'
        ? 'checkmark.circle.fill'
        : 'terminal'
  const summary = stale
    ? id
      ? 'Buka untuk memperbarui'
      : 'Open to refresh'
    : props.phase === 'finished'
      ? id
        ? 'Pekerjaan selesai'
        : 'Work finished'
      : attention
        ? id
          ? 'Perlu perhatian'
          : 'Needs attention'
        : id
          ? 'Agen sedang bekerja'
          : 'Agents working'
  const count = Math.min(99, props.running + props.waiting)
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
  return {
    banner: (
      <VStack alignment="leading" spacing={12} modifiers={[padding({ all: 16 })]}>
        <HStack spacing={10}>
          <Image systemName={symbol} color={accent} modifiers={[frame({ width: 24, height: 24 })]} />
          <VStack alignment="leading" spacing={3}>
            <Text modifiers={[font({ size: 16, weight: 'semibold' })]}>{summary}</Text>
            <Text modifiers={[font({ size: 12 }), secondary]}>Ramu</Text>
          </VStack>
          <Spacer />
          {!stale && props.phase !== 'finished' ? (
            <Text
              date={new Date(props.startedAt)}
              dateStyle="timer"
              modifiers={[font({ size: 17, design: 'monospaced' })]}
            />
          ) : null}
        </HStack>
        <HStack spacing={16}>
          <Text modifiers={[font({ size: 13 }), secondary]}>
            {props.running} {id ? 'berjalan' : 'running'}
          </Text>
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(attention ? accent : { type: 'hierarchical', style: 'secondary' }),
            ]}
          >
            {props.waiting} {id ? 'menunggu' : 'waiting'}
          </Text>
          <Spacer />
          <Text date={new Date(props.updatedAt)} dateStyle="relative" modifiers={[font({ size: 11 }), secondary]} />
        </HStack>
      </VStack>
    ),
    bannerSmall: (
      <HStack spacing={8} modifiers={[padding({ all: 12 })]}>
        <Image systemName={symbol} color={accent} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>{summary}</Text>
        <Spacer />
        <Text>{count}</Text>
      </HStack>
    ),
    compactLeading: <Image systemName={symbol} color={accent} modifiers={[frame({ width: 20, height: 20 })]} />,
    compactTrailing: (
      <Text modifiers={[font({ size: 14, weight: 'semibold', design: 'monospaced' }), foregroundStyle(accent)]}>
        {stale ? '—' : attention ? props.waiting : count}
      </Text>
    ),
    minimal:
      attention || stale || props.phase === 'finished' ? (
        <Image systemName={symbol} color={accent} />
      ) : (
        <Text modifiers={[font({ size: 14, weight: 'semibold', design: 'monospaced' }), foregroundStyle(accent)]}>
          {count}
        </Text>
      ),
    expandedLeading: (
      <HStack spacing={6}>
        <Image systemName={symbol} color={accent} />
        <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>Ramu</Text>
      </HStack>
    ),
    expandedTrailing:
      props.phase === 'finished' ? (
        <Text modifiers={[font({ size: 12 }), secondary]}>{id ? 'Selesai' : 'Done'}</Text>
      ) : stale ? (
        <Text modifiers={[font({ size: 12 }), secondary]}>{id ? 'Tidak terkini' : 'Out of date'}</Text>
      ) : (
        <Text
          date={new Date(props.startedAt)}
          dateStyle="timer"
          modifiers={[font({ size: 14, design: 'monospaced' })]}
        />
      ),
    expandedBottom: (
      <VStack alignment="leading" spacing={7} modifiers={[padding({ top: 8, bottom: 4 })]}>
        <Text modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle(accent)]}>{summary}</Text>
        <HStack spacing={14}>
          <Text modifiers={[font({ size: 12 }), secondary]}>
            {props.running} {id ? 'berjalan' : 'running'}
          </Text>
          <Text modifiers={[font({ size: 12 }), secondary]}>
            {props.waiting} {id ? 'menunggu' : 'waiting'}
          </Text>
          <Spacer />
          <Text modifiers={[font({ size: 12 }), secondary]}>{id ? 'Ketuk untuk membuka' : 'Tap to open'}</Text>
        </HStack>
      </VStack>
    ),
  }
}

export const WorkActivityFactory = createLiveActivity<MobileLiveActivityContent>('RamuWork', WorkActivity)
