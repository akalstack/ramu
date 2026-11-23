import { terminalOutputUpdate, type TerminalOutputState } from '@ramu/shared/workspace/terminalOutput'
import { useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { tap } from './ui'
import { TerminalGestureOverlay, readGesture, type GestureDisplay } from './TerminalGestureOverlay'
import { WebView } from 'react-native-webview'
import { terminalHtml } from '../assets/terminal'
import type { TerminalViewProps } from './TerminalView'
import { terminalLinkMessage } from '../runtime/terminalLinkMessage'
import { terminalCopyMessage } from '../runtime/terminalCopy'
import { useSay } from '../i18n'

export default function TerminalView({
  session,
  output,
  cursor,
  onInput,
  onResize,
  enabled = true,
  keyboardAction,
  keyAction,
  fontSize,
  onFontSize,
  onLink,
  captureAction,
  onCapture,
  pasteAction,
}: TerminalViewProps) {
  const say = useSay()
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  const view = useRef<WebView<object>>(null)
  const [ready, setReady] = useState(false)
  const previous = useRef<TerminalOutputState>({ output: '' })
  const consumedKey = useRef<number | undefined>(undefined)
  const consumedPaste = useRef<number | undefined>(undefined)
  const [gesture, setGesture] = useState<GestureDisplay | null>(null)
  const gestureActive = useRef(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ready) return
    const next = { session, output, cursor }
    const message = JSON.stringify(terminalOutputUpdate(previous.current, next))
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
    previous.current = next
  }, [output, cursor, session, ready])
  useEffect(() => {
    if (!ready) return
    const message = JSON.stringify({ kind: 'gesture-control', enabled: enabled && appActive })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
    if (!enabled || !appActive) {
      gestureActive.current = false
      setGesture(null)
    }
  }, [ready, enabled, appActive])
  useEffect(() => {
    if (!ready || !keyAction || consumedKey.current === keyAction.sequence) return
    consumedKey.current = keyAction.sequence
    if (!enabled || !appActive) return
    const message = JSON.stringify({ kind: 'key', key: keyAction.key })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
  }, [ready, enabled, appActive, keyAction])
  useEffect(() => {
    if (!ready || !fontSize) return
    const message = JSON.stringify({ kind: 'font', size: fontSize })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
  }, [ready, fontSize])
  useEffect(() => {
    if (!ready || !captureAction) return
    const message = JSON.stringify({ kind: 'capture', id: captureAction.sequence })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
  }, [ready, captureAction])
  useEffect(() => {
    if (!ready || !pasteAction || consumedPaste.current === pasteAction.sequence) return
    consumedPaste.current = pasteAction.sequence
    if (!enabled || !appActive) return
    const message = JSON.stringify({ kind: 'paste', data: pasteAction.text })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
  }, [ready, enabled, appActive, pasteAction])
  useEffect(() => {
    if (!ready || !keyboardAction) return
    if (keyboardAction.visible) view.current?.requestFocus()
    const message = JSON.stringify({ kind: keyboardAction.visible ? 'focus' : 'blur' })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
  }, [ready, keyboardAction])
  return (
    <View style={{ flex: 1 }} onLayout={(event) => setSize(event.nativeEvent.layout)}>
      <WebView<object>
        accessibilityLabel={say('Host terminal')}
        accessibilityHint={say(
          'Hold, then drag to move the cursor. Drag farther to repeat faster. Pinch to change the text size.',
        )}
        ref={view}
        source={{ html: terminalHtml }}
        style={{ flex: 1, backgroundColor: '#0e0e10' }}
        originWhitelist={['about:blank']}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        javaScriptEnabled
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        onMessage={(event) => {
          try {
            const value = JSON.parse(event.nativeEvent.data)
            if (value.kind === 'gesture' && enabled && appActive) {
              const state = readGesture(value)
              // A tick when the control appears, and one per arrow it sends, as the iOS keyboard trackpad does.
              if (state && (!gestureActive.current || (typeof value.steps === 'number' && value.steps > 0))) tap()
              gestureActive.current = !!state
              setGesture(state)
            }
            if (value.kind === 'ready') setReady(true)
            if (value.kind === 'font' && Number.isInteger(value.size)) onFontSize?.(value.size)
            if (enabled && appActive && value.kind === 'input' && typeof value.data === 'string') onInput(value.data)
            if (value.kind === 'resize' && Number.isInteger(value.cols) && Number.isInteger(value.rows))
              onResize(value.cols, value.rows)
            const link = appActive ? terminalLinkMessage(value) : null
            if (link) onLink?.(link.kind, link.text)
            const capture = appActive ? terminalCopyMessage(value) : null
            if (capture) onCapture?.(capture)
          } catch {}
        }}
      />
      <TerminalGestureOverlay state={gesture} {...size} />
    </View>
  )
}
