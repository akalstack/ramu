import { terminalOutputUpdate, type TerminalOutputState } from '@ramu/shared/workspace/terminalOutput'
import { createElement, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { TerminalGestureOverlay, readGesture, type GestureDisplay } from './TerminalGestureOverlay'
import { terminalHtml } from '../assets/terminal'
import { useSay } from '../i18n'
import type { TerminalLinkKind } from '@ramu/shared/workspace/terminalLinks'
import { terminalLinkMessage } from '../runtime/terminalLinkMessage'
import { terminalCopyMessage, type TerminalCopyChoices } from '../runtime/terminalCopy'
export interface TerminalViewProps {
  /** Which shell `output` belongs to; a different one always starts the screen over. */ session?: string
  output: string
  cursor?: number
  enabled?: boolean
  keyboardAction?: { sequence: number; visible: boolean }
  keyAction?: { sequence: number; key: string }
  onInput(data: string): void
  onResize(cols: number, rows: number): void
  /** Text size this phone remembers for terminals; pinching changes it and reports the new size. */
  fontSize?: number
  onFontSize?(size: number): void
  /** A web address or path tapped in the output. */
  onLink?(kind: TerminalLinkKind, text: string): void
  /** Asks the terminal for what it can copy; it answers through `onCapture` with the same sequence as its id. */
  captureAction?: { sequence: number }
  onCapture?(choices: TerminalCopyChoices): void
  /** Text pasted through the terminal, which brackets it only for a program that asked for bracketed paste. */
  pasteAction?: { sequence: number; text: string }
}

export default function TerminalView({
  session,
  output,
  cursor,
  onInput,
  onResize,
  enabled = true,
  keyboardAction,
  keyAction,
  onLink,
  captureAction,
  onCapture,
  pasteAction,
}: TerminalViewProps) {
  const say = useSay()
  const frame = useRef<HTMLIFrameElement>(null)
  const callbacks = useRef({ onInput, onResize, onLink, onCapture, enabled })
  callbacks.current = { onInput, onResize, onLink, onCapture, enabled }
  const consumedPaste = useRef<number | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const previous = useRef<TerminalOutputState>({ output: '' })
  const consumedKey = useRef<number | undefined>(undefined)
  const [gesture, setGesture] = useState<GestureDisplay | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return
      try {
        const value = JSON.parse(event.data)
        if (value.kind === 'gesture' && callbacks.current.enabled) setGesture(readGesture(value))
        if (value.kind === 'ready') setReady(true)
        if (callbacks.current.enabled && value.kind === 'input' && typeof value.data === 'string')
          callbacks.current.onInput(value.data)
        if (value.kind === 'resize') callbacks.current.onResize(value.cols, value.rows)
        const link = terminalLinkMessage(value)
        if (link) callbacks.current.onLink?.(link.kind, link.text)
        const capture = terminalCopyMessage(value)
        if (capture) callbacks.current.onCapture?.(capture)
      } catch {}
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (!ready) return
    const next = { session, output, cursor }
    const message = terminalOutputUpdate(previous.current, next)
    frame.current?.contentWindow?.postMessage(JSON.stringify(message), '*')
    previous.current = next
  }, [output, cursor, session, ready])
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage(JSON.stringify({ kind: 'gesture-control', enabled }), '*')
    if (!enabled) setGesture(null)
  }, [ready, enabled])
  useEffect(() => {
    if (!ready || !keyAction || consumedKey.current === keyAction.sequence) return
    consumedKey.current = keyAction.sequence
    if (enabled) frame.current?.contentWindow?.postMessage(JSON.stringify({ kind: 'key', key: keyAction.key }), '*')
  }, [ready, enabled, keyAction])
  useEffect(() => {
    if (ready && captureAction)
      frame.current?.contentWindow?.postMessage(JSON.stringify({ kind: 'capture', id: captureAction.sequence }), '*')
  }, [ready, captureAction])
  useEffect(() => {
    if (!ready || !pasteAction || consumedPaste.current === pasteAction.sequence) return
    consumedPaste.current = pasteAction.sequence
    if (enabled)
      frame.current?.contentWindow?.postMessage(JSON.stringify({ kind: 'paste', data: pasteAction.text }), '*')
  }, [ready, enabled, pasteAction])
  useEffect(() => {
    if (ready && keyboardAction)
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ kind: keyboardAction.visible ? 'focus' : 'blur' }),
        '*',
      )
  }, [ready, keyboardAction])
  return (
    <View style={{ flex: 1 }} onLayout={(event) => setSize(event.nativeEvent.layout)}>
      {createElement('iframe', {
        ref: frame,
        title: say('Host terminal'),
        srcDoc: terminalHtml,
        sandbox: 'allow-scripts',
        style: { flex: 1, width: '100%', height: '100%', border: 0, background: '#0e0e10' },
      })}
      <TerminalGestureOverlay state={gesture} {...size} />
    </View>
  )
}
