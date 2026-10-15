import { createElement, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { TerminalGestureOverlay, readGesture, type GestureDisplay } from './TerminalGestureOverlay'
import { terminalHtml } from '../assets/terminal'
export interface TerminalViewProps { output: string; enabled?: boolean; keyboardAction?: { sequence: number; visible: boolean }; keyAction?: { sequence: number; key: string }; onInput(data: string): void; onResize(cols: number, rows: number): void }
export default function TerminalView({ output, onInput, onResize, enabled = true, keyboardAction, keyAction }: TerminalViewProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const callbacks = useRef({ onInput, onResize, enabled }); callbacks.current = { onInput, onResize, enabled }
  const [ready, setReady] = useState(false)
  const previous = useRef('')
  const consumedKey = useRef<number | undefined>(undefined)
  const [gesture, setGesture] = useState<GestureDisplay | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return
      try { const value = JSON.parse(event.data); if (value.kind === 'gesture' && callbacks.current.enabled) setGesture(readGesture(value)); if (value.kind === 'ready') setReady(true); if (callbacks.current.enabled && value.kind === 'input' && typeof value.data === 'string') callbacks.current.onInput(value.data); if (value.kind === 'resize') callbacks.current.onResize(value.cols, value.rows) } catch {}
    }
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (!ready) return
    const incremental = output.startsWith(previous.current)
    frame.current?.contentWindow?.postMessage(JSON.stringify({ kind: incremental ? 'output' : 'reset', data: incremental ? output.slice(previous.current.length) : output }), '*')
    previous.current = output
  }, [output, ready])
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
    if (ready && keyboardAction) frame.current?.contentWindow?.postMessage(JSON.stringify({ kind: keyboardAction.visible ? 'focus' : 'blur' }), '*')
  }, [ready, keyboardAction])
  return <View style={{ flex: 1 }} onLayout={event => setSize(event.nativeEvent.layout)}>{createElement('iframe', { ref: frame, title: 'Host terminal', srcDoc: terminalHtml, sandbox: 'allow-scripts', style: { flex: 1, width: '100%', height: '100%', border: 0, background: '#0e0e10' } })}<TerminalGestureOverlay state={gesture} {...size} /></View>
}
