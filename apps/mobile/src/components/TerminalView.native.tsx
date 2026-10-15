import { useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { BlurSurface } from './Glass'
import { tap } from './ui'
import { TerminalGestureOverlay, readGesture, type GestureDisplay } from './TerminalGestureOverlay'
import { WebView } from 'react-native-webview'
import { terminalHtml } from '../assets/terminal'
import type { TerminalViewProps } from './TerminalView'

export default function TerminalView({
  session,
  output,
  onInput,
  onResize,
  enabled = true,
  keyboardAction,
  keyAction,
}: TerminalViewProps) {
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  const view = useRef<WebView>(null)
  const [ready, setReady] = useState(false)
  const previous = useRef('')
  const shown = useRef(session)
  const consumedKey = useRef<number | undefined>(undefined)
  const [gesture, setGesture] = useState<GestureDisplay | null>(null)
  const gestureActive = useRef(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ready) return
    const switched = shown.current !== session
    shown.current = session
    const incremental = !switched && output.startsWith(previous.current)
    const message = JSON.stringify({
      kind: incremental ? 'output' : 'reset',
      data: incremental ? output.slice(previous.current.length) : output,
    })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
    previous.current = output
  }, [output, session, ready])
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
    if (!ready || !keyboardAction) return
    if (keyboardAction.visible) view.current?.requestFocus()
    const message = JSON.stringify({ kind: keyboardAction.visible ? 'focus' : 'blur' })
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    )
  }, [ready, keyboardAction])
  return (
    <View style={{ flex: 1 }} onLayout={(event) => setSize(event.nativeEvent.layout)}>
      <BlurSurface style={{ flex: 1 }}>
        <WebView
          accessibilityLabel="Host terminal"
          accessibilityHint="Hold, then drag to move the cursor. Drag farther to repeat faster."
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
                if (state && !gestureActive.current) tap()
                gestureActive.current = !!state
                setGesture(state)
              }
              if (value.kind === 'ready') setReady(true)
              if (enabled && appActive && value.kind === 'input' && typeof value.data === 'string') onInput(value.data)
              if (value.kind === 'resize' && Number.isInteger(value.cols) && Number.isInteger(value.rows))
                onResize(value.cols, value.rows)
            } catch {}
          }}
        />
      </BlurSurface>
      <TerminalGestureOverlay state={gesture} {...size} />
    </View>
  )
}
