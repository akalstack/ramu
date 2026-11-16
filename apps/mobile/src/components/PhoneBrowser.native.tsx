import { useRef, useState } from 'react'
import { ActivityIndicator, Linking, Platform, TextInput, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { ChevronLeft, ExternalLink, Monitor, RotateCw } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { addressFrom } from '@ramu/shared/browserLinks'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, T } from './ui'
import { ControlPill, ViewerHeader } from './ViewerChrome'
import type { PhoneBrowserProps } from './PhoneBrowser'

/**
 * Loads a host browser page in this phone's own WebView, for scrolling and typing without a stream. It is a private
 * session: nothing from the host browser's profiles reaches it, and it keeps no cookies after closing. The address field
 * opens addresses and searches as the host browser's does.
 */
export default function PhoneBrowser({ url, forward, searchTemplate, onClose, onOpenOnHost }: PhoneBrowserProps) {
  const { language } = useStore()
  const t = (text: string) => translate(language, text)
  const { c } = useTheme()
  const view = useRef<WebView<object>>(null)
  const [page, setPage] = useState({ title: '', url, canGoBack: false })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState(url)
  const [draft, setDraft] = useState<string | null>(null)
  const go = () => {
    const next = addressFrom(draft ?? '', searchTemplate)
    setDraft(null)
    if (!next || !/^https?:\/\//i.test(next)) return
    setFailed(false)
    if (next === target) view.current?.reload()
    else setTarget(next)
  }
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
            {onOpenOnHost ? (
              <ControlPill
                icon={Monitor}
                label={t('Open in the host browser')}
                onPress={() => onOpenOnHost(page.url)}
                size={44}
              />
            ) : null}
          </View>
        }
      />
      <View style={{ paddingHorizontal: space.m, paddingBottom: space.s }}>
        <TextInput
          accessibilityLabel={t('Address')}
          value={draft ?? page.url}
          onChangeText={setDraft}
          onBlur={() => setDraft(null)}
          onSubmitEditing={go}
          placeholder={t('Search or enter a web address')}
          placeholderTextColor={c.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={Platform.OS === 'ios' ? 'web-search' : 'url'}
          returnKeyType="go"
          selectTextOnFocus
          numberOfLines={1}
          style={{
            height: 40,
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: c.lineStrong,
            backgroundColor: c.fill,
            paddingHorizontal: space.l,
            color: c.text,
            fontSize: font.control + 1,
          }}
        />
      </View>
      {forward ? (
        <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
          {translate(
            language,
            'From port {0} on the host, for this phone only. Closes in 30 minutes or when you leave.',
            {
              0: forward.targetPort,
            },
          )}
        </T>
      ) : null}
      {failed ? (
        <View style={{ padding: space.l, gap: space.m }}>
          <T weight="600">{t('This page did not load on this phone.')}</T>
          <T tone="muted">
            {forward
              ? t('Check that the dev server is still running on the host, or go back to the host browser.')
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
            source={{ uri: target }}
            style={{ flex: 1, backgroundColor: c.window }}
            // Every scheme reaches the check below; the whitelist fallback would hand rejected URLs to Linking.openURL.
            originWhitelist={['*']}
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
