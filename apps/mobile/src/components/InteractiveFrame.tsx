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
  /** The document has drawn its first frame; messages that set what it shows are sent again from here. */
  onPainted?(): void
  /** Messages for the document, delivered once each in id order: page replies, run steps, pick mode. */
  messages?: readonly { id: number; data: object }[]
  /** Larger messages a page may send, such as a photo it picked; documents in a thread stay small. */
  maxMessage?: number
}
/** Browser companion stays a static fallback until a dedicated document origin is available. */
export default function InteractiveFrame(_props: InteractiveFrameProps) {
  const { language } = useStore()
  return <T tone="muted">{translate(language, 'Open this content in the desktop or mobile app to interact.')}</T>
}
