import { useEffect, useMemo, useRef } from 'react'
import { WebView } from 'react-native-webview'
import type { InteractiveFrameProps } from './InteractiveFrame'
/** Separate from the terminal renderer: this bridge accepts only document state and size. */
export default function InteractiveFrame({
  html,
  snapshot,
  height,
  instance,
  theme,
  onMessage,
  onStop,
}: InteractiveFrameProps) {
  const source = useMemo(() => ({ html, baseUrl: 'https://ramu-content.invalid/' }), [html])
  const view = useRef<WebView<object>>(null)
  const sendTheme = () =>
    view.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({ ramuInteractive: 1, instance, type: 'theme', value: theme })}}));true;`,
    )
  useEffect(() => {
    if (!snapshot?.startsWith(instance + ':')) return
    const data = JSON.stringify({ ramuInteractive: 1, instance, type: 'snapshot', requestId: snapshot })
    view.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{data:${data}}));true;`)
  }, [snapshot, instance])
  useEffect(sendTheme, [theme, instance])
  return (
    <WebView<object>
      ref={view}
      onLoadEnd={sendTheme}
      source={source}
      style={{ height, flex: 0 }}
      originWhitelist={['about:blank', 'https://ramu-content.invalid']}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback={false}
      mediaPlaybackRequiresUserAction
      domStorageEnabled={false}
      geolocationEnabled={false}
      onShouldStartLoadWithRequest={(request) =>
        request.isTopFrame !== false &&
        (request.url === 'about:blank' || request.url === 'https://ramu-content.invalid/')
      }
      onMessage={(event) => {
        if (event.nativeEvent.data.length > 40_000) return
        try {
          onMessage(JSON.parse(event.nativeEvent.data))
        } catch {}
      }}
      onContentProcessDidTerminate={onStop}
      onRenderProcessGone={() => {
        onStop()
      }}
      onError={onStop}
    />
  )
}
