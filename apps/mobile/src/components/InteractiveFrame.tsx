import { translate } from '@ramu/shared/i18n'
import { useStore } from '../runtime/store'
import { T } from './ui'
export interface InteractiveFrameProps {
  html: string
  title: string
  snapshot?: string
  instance: string
  height: number
  theme: Record<string, string>
  onMessage(value: unknown): void
  onStop(): void
}
/** Browser companion stays a static fallback until a dedicated document origin is available. */
export default function InteractiveFrame(_props: InteractiveFrameProps) {
  const { language } = useStore()
  return <T tone="muted">{translate(language, 'Open this content in the desktop or mobile app to interact.')}</T>
}
