import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
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
  const [painted, setPainted] = useState<string | null>(null)
  const backgroundColor = theme['--background'] ?? 'transparent'
  const readyScript = useMemo(() => {
    const payload = JSON.stringify(JSON.stringify({ ramuInteractive: 1, instance, type: 'painted' }))
    return `requestAnimationFrame(()=>requestAnimationFrame(()=>window.ReactNativeWebView.postMessage(${payload})));true;`
  }, [instance])
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
    <View style={{ height, backgroundColor }}>
      <WebView<object>
        ref={view}
        onLoadStart={() => setPainted(null)}
        onLoadEnd={sendTheme}
        injectedJavaScript={readyScript}
        source={source}
        containerStyle={{ backgroundColor }}
        style={{ height, flex: 0, backgroundColor, opacity: painted === instance ? 1 : 0 }}
        // Let our navigation policy inspect every scheme. The WebView's whitelist fallback
        // otherwise hands rejected URLs to Linking.openURL before consulting our blocker.
        originWhitelist={['*']}
        incognito
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        onOpenWindow={() => {}}
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
            const message = JSON.parse(event.nativeEvent.data)
            if (message?.ramuInteractive === 1 && message.instance === instance && message.type === 'painted') {
              setPainted(instance)
              return
            }
            onMessage(message)
          } catch {}
        }}
        onContentProcessDidTerminate={onStop}
        onRenderProcessGone={() => {
          onStop()
        }}
        onError={onStop}
      />
      {painted !== instance ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color={theme['--muted']} />
        </View>
      ) : null}
    </View>
  )
}
