import { useRef, useState } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { ChevronLeft, ExternalLink, RotateCw } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { useStore } from '../runtime/store'
import { space, useTheme } from '../theme'
import { Button, T } from './ui'
import { ControlPill, ViewerHeader } from './ViewerChrome'
import type { PhoneBrowserProps } from './PhoneBrowser'

/**
 * Loads a host browser page in this phone's own WebView, for scrolling and typing without a stream. It is a private
 * session: nothing from the host browser's profiles reaches it, and it keeps no cookies after closing.
 */
export default function PhoneBrowser({ url, rewritten, onClose }: PhoneBrowserProps) {
  const { language } = useStore()
  const t = (text: string) => translate(language, text)
  const { c } = useTheme()
  const view = useRef<WebView<object>>(null)
  const [page, setPage] = useState({ title: '', url, canGoBack: false })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setFailed(false)
    setAttempt((value) => value + 1)
  }
  return (
    <View style={{ flex: 1 }}>
      <ViewerHeader
        title={page.title || t('On this phone')}
        subtitle={page.url}
        closeLabel={t('Back to the host browser')}
        onClose={onClose}
        right={
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            {page.canGoBack ? (
              <ControlPill icon={ChevronLeft} label={t('Back')} onPress={() => view.current?.goBack()} size={44} />
            ) : null}
            <ControlPill
              icon={RotateCw}
              label={t('Reload')}
              onPress={failed ? retry : () => view.current?.reload()}
              size={44}
            />
          </View>
        }
      />
      {failed ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <T weight="600">{t('This page did not load on this phone.')}</T>
          <T tone="muted">
            {rewritten
              ? t(
                  'It runs on the host’s localhost. Start the dev server on all addresses (for example with --host 0.0.0.0) and allow it through the host’s firewall, or go back to the host browser.',
                )
              : t('Check that this phone can reach the address, or go back to the host browser.')}
          </T>
          <Button title={t('Try again')} icon={RotateCw} onPress={retry} />
          <Button
            title={t('Open in browser')}
            icon={ExternalLink}
            kind="secondary"
            onPress={() => void Linking.openURL(page.url)}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView<object>
            key={attempt}
            ref={view}
            source={{ uri: url }}
            style={{ flex: 1, backgroundColor: c.window }}
            originWhitelist={['http://*', 'https://*']}
            onShouldStartLoadWithRequest={(request) => /^(https?:|about:blank)/i.test(request.url)}
            incognito
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            geolocationEnabled={false}
            allowsBackForwardNavigationGestures
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onNavigationStateChange={(state) =>
              setPage({ title: state.title, url: state.url, canGoBack: state.canGoBack })
            }
            onError={() => setFailed(true)}
            onContentProcessDidTerminate={() => view.current?.reload()}
            onRenderProcessGone={() => setFailed(true)}
          />
          {loading ? (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: space.l, left: 0, right: 0, alignItems: 'center' }}
            >
              <ActivityIndicator color={c.soft} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}
