import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'

/** A page run on the Lock Screen and in the Dynamic Island while it works: the page, its latest step and the time. */
export interface PageRunActivityProps {
  page: string
  run: string
  step: string
  startedAt: number
  phase: 'running' | 'done' | 'failed' | 'stopped'
  locale: 'en' | 'id'
}

function PageRunLayout(props: PageRunActivityProps, environment: LiveActivityEnvironment) {
  'widget'
  const id = props.locale === 'id'
  const accent = environment.colorScheme === 'light' ? '#5b40ad' : '#b7a6f3'
  const symbol =
    props.phase === 'done' ? 'checkmark.circle.fill' : props.phase === 'running' ? 'sparkles' : 'xmark.circle'
  const status =
    props.phase === 'done'
      ? id
        ? 'Selesai'
        : 'Done'
      : props.phase === 'running'
        ? props.step
        : id
          ? 'Berhenti'
          : 'Stopped'
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 })]}>
        <HStack spacing={10}>
          <Image systemName={symbol} color={accent} modifiers={[font({ size: 20 })]} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.run}</Text>
            <Text modifiers={[font({ size: 12 }), secondary]}>{props.page}</Text>
          </VStack>
          <Spacer />
          {props.phase === 'running' ? (
            <Text
              date={new Date(props.startedAt)}
              dateStyle="timer"
              modifiers={[font({ size: 15, design: 'monospaced' })]}
            />
          ) : null}
        </HStack>
        <Text modifiers={[font({ size: 13 }), secondary]}>{status}</Text>
      </VStack>
    ),
    compactLeading: <Image systemName={symbol} color={accent} modifiers={[font({ size: 14 })]} />,
    compactTrailing:
      props.phase === 'running' ? (
        <Text
          date={new Date(props.startedAt)}
          dateStyle="timer"
          modifiers={[font({ size: 13, design: 'monospaced' })]}
        />
      ) : (
        <Image systemName={symbol} color={accent} modifiers={[font({ size: 14 })]} />
      ),
    minimal: <Image systemName={symbol} color={accent} modifiers={[font({ size: 14 })]} />,
    expandedLeading: <Image systemName={symbol} color={accent} modifiers={[font({ size: 14 })]} />,
    expandedTrailing: <Text modifiers={[font({ size: 13 }), secondary]}>{props.page}</Text>,
    expandedBottom: (
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.run}</Text>
        <Text modifiers={[font({ size: 13 }), secondary]}>{status}</Text>
      </VStack>
    ),
  }
}

export const PageRunActivityFactory = createLiveActivity<PageRunActivityProps>('RamuPageRun', PageRunLayout)
