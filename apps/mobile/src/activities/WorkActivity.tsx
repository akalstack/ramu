import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, lineLimit, padding } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'
import type { MobileLiveActivityContent } from '@ramu/shared/api'

/**
 * Pure SwiftUI layouts serialized into the native ActivityKit extension. The function runs there on its own, so it
 * imports nothing and words come in both of the app's languages. Content from older hosts and apps has only the
 * counts and `phase`, so every newer field is read as optional.
 */
function WorkActivity(props: MobileLiveActivityContent, environment: LiveActivityEnvironment) {
  'widget'
  const id = props.locale === 'id'
  const failedCount = props.failed || 0
  const doneCount = props.done || 0
  const tone = props.tone
    ? props.tone
    : props.phase === 'finished'
      ? 'done'
      : props.waiting > 0
        ? 'attention'
        : 'working'
  const need = props.need || 'input'
  const rows = props.rows || []
  // Out of date only once iOS says so; content from older apps said it with `paused`.
  const stale = !!environment.isStale || props.phase === 'paused'
  const light = environment.colorScheme === 'light'
  const pick = (dark: string, onLight: string, island: boolean) =>
    environment.isLuminanceReduced ? '#ffffff' : island || !light ? dark : onLight
  // The Dynamic Island is always black, so it takes the dark colors; the Lock Screen follows the system.
  const toneColor = (which: string, island: boolean) =>
    stale
      ? pick('#a1a1a8', '#6b6b73', island)
      : which === 'attention'
        ? pick('#ffb340', '#a35f00', island)
        : which === 'failed'
          ? pick('#ff6961', '#c62828', island)
          : which === 'done'
            ? pick('#5fd38d', '#2e7d32', island)
            : pick('#b7a6f3', '#5b40ad', island)
  const accent = toneColor(tone, false)
  const islandAccent = toneColor(tone, true)
  const mark = 'terminal.fill'
  const symbol =
    tone === 'attention'
      ? need === 'limit'
        ? 'hourglass'
        : 'hand.raised.fill'
      : tone === 'failed'
        ? 'xmark.circle.fill'
        : tone === 'done'
          ? 'checkmark.circle.fill'
          : 'ellipsis'
  const statusWord = (status: string) =>
    status === 'approval'
      ? id
        ? 'Perlu persetujuan'
        : 'Needs approval'
      : status === 'question'
        ? id
          ? 'Pertanyaan'
          : 'Question'
        : status === 'limit'
          ? id
            ? 'Batas tercapai'
            : 'Limit reached'
          : status === 'input'
            ? id
              ? 'Perlu Anda'
              : 'Needs you'
            : status === 'failed'
              ? id
                ? 'Gagal'
                : 'Failed'
              : status === 'done'
                ? id
                  ? 'Selesai'
                  : 'Done'
                : id
                  ? 'Bekerja'
                  : 'Working'
  const statusTone = (status: string) =>
    status === 'failed' ? 'failed' : status === 'done' ? 'done' : status === 'working' ? 'working' : 'attention'
  // Only counts that are not zero; with none left the work is simply over.
  const parts: string[] = []
  if (props.waiting > 0) parts.push(props.waiting + (id ? ' perlu Anda' : ' needs you'))
  if (props.running > 0) parts.push(props.running + (id ? ' berjalan' : ' running'))
  if (failedCount > 0) parts.push(failedCount + (id ? ' gagal' : ' failed'))
  if (props.running + props.waiting === 0 && doneCount > 0) parts.push(doneCount + (id ? ' selesai' : ' done'))
  const headline = parts.length ? parts.join(' · ') : id ? 'Semua pekerjaan selesai' : 'All work done'
  const hint = stale
    ? id
      ? 'Buka Ramu untuk memperbarui'
      : 'Open Ramu to update'
    : tone === 'attention'
      ? id
        ? 'Ketuk untuk menjawab'
        : 'Tap to respond'
      : tone === 'failed'
        ? id
          ? 'Ketuk untuk melihat apa yang gagal'
          : 'Tap to see what failed'
        : tone === 'done'
          ? id
            ? 'Ketuk untuk meninjau'
            : 'Tap to review'
          : id
            ? 'Agen sedang bekerja'
            : 'Agents working'
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
  const row = (entry: { title: string; status: string } | undefined, island: boolean) =>
    entry ? (
      <HStack spacing={8}>
        <Text modifiers={[font({ size: 13 }), lineLimit(1)]}>{entry.title}</Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 12, weight: 'medium' }),
            foregroundStyle(toneColor(statusTone(entry.status), island)),
          ]}
        >
          {statusWord(entry.status)}
        </Text>
      </HStack>
    ) : null
  const rowsView = (island: boolean) =>
    rows.length ? (
      <VStack alignment="leading" spacing={5}>
        {row(rows[0], island)}
        {row(rows[1], island)}
        {row(rows[2], island)}
      </VStack>
    ) : island || !stale ? (
      // The Lock Screen already says it is out of date under the headline.
      <Text modifiers={[font({ size: 13 }), secondary]}>{hint}</Text>
    ) : null
  const timer = (size: number) => (
    <Text date={new Date(props.startedAt)} dateStyle="timer" modifiers={[font({ size, design: 'monospaced' })]} />
  )
  const trailingWord =
    tone === 'attention'
      ? statusWord(need)
      : tone === 'failed'
        ? statusWord('failed')
        : tone === 'done'
          ? statusWord('done')
          : null
  return {
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 })]}>
        <HStack spacing={10}>
          <Image systemName={mark} color={accent} modifiers={[font({ size: 20 })]} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 16, weight: 'semibold' }), lineLimit(1)]}>{headline}</Text>
            <Text
              modifiers={[
                font({ size: 12 }),
                foregroundStyle(stale ? accent : { type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              {stale ? hint : 'Ramu'}
            </Text>
          </VStack>
          <Spacer />
          {!stale && tone === 'working' ? (
            timer(15)
          ) : (
            <Image systemName={symbol} color={accent} modifiers={[font({ size: 17 })]} />
          )}
        </HStack>
        {rowsView(false)}
      </VStack>
    ),
    bannerSmall: (
      <HStack spacing={8} modifiers={[padding({ all: 12 })]}>
        <Image systemName={mark} color={accent} modifiers={[font({ size: 13 })]} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>{headline}</Text>
      </HStack>
    ),
    compactLeading: <Image systemName={mark} color={islandAccent} modifiers={[font({ size: 14 })]} />,
    compactTrailing:
      tone === 'attention' && !stale ? (
        <HStack spacing={2}>
          <Image systemName={symbol} color={islandAccent} modifiers={[font({ size: 12 })]} />
          <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(islandAccent)]}>
            {Math.min(99, props.waiting)}
          </Text>
        </HStack>
      ) : tone === 'working' && !stale && props.running > 0 ? (
        <Text modifiers={[font({ size: 14, weight: 'semibold', design: 'monospaced' }), foregroundStyle(islandAccent)]}>
          {Math.min(99, props.running)}
        </Text>
      ) : (
        <Image systemName={symbol} color={islandAccent} modifiers={[font({ size: 14 })]} />
      ),
    minimal:
      tone === 'working' && !stale && props.running > 0 ? (
        <Text modifiers={[font({ size: 14, weight: 'semibold', design: 'monospaced' }), foregroundStyle(islandAccent)]}>
          {Math.min(99, props.running)}
        </Text>
      ) : (
        <Image systemName={symbol} color={islandAccent} modifiers={[font({ size: 14 })]} />
      ),
    expandedLeading: (
      <HStack spacing={6}>
        <Image systemName={mark} color={islandAccent} modifiers={[font({ size: 14 })]} />
        <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>Ramu</Text>
      </HStack>
    ),
    expandedTrailing: stale ? (
      <Text modifiers={[font({ size: 12 }), foregroundStyle(islandAccent)]}>
        {id ? 'Tidak terkini' : 'Out of date'}
      </Text>
    ) : trailingWord ? (
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(islandAccent)]}>{trailingWord}</Text>
    ) : (
      timer(14)
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ top: 6, bottom: 4 })]}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(islandAccent), lineLimit(1)]}>
          {headline}
        </Text>
        {rowsView(true)}
      </VStack>
    ),
  }
}

export const WorkActivityFactory = createLiveActivity<MobileLiveActivityContent>('RamuWork', WorkActivity)
