import { VIEW_ONLY_BROWSER_NOTICE } from '../runtime/viewerAccess'
import { useEffect, useRef, useState } from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { canOpenBrowserLinkOnDevice } from '@ramu/shared/browserLinks'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Button, T } from './ui'
import { BrowserViewer } from './BrowserViewer'
import { ViewerHeader, ViewerScreen } from './ViewerChrome'

/** Observes the host's metadata. Opening a website here never transfers its sign-in or local address to the phone. */
export function BrowserActivity({ chat, open, onClose }: { chat: Chat; open: boolean; onClose(): void }) {
  const store = useStore()
  const t = (key: string) => translate(store.language, key)
  const [hosted, setHosted] = useState(false)
  const [hostManaged, setHostManaged] = useState(false)
  const [hostReason, setHostReason] = useState('')
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [externalURLs, setExternalURLs] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [revision, refresh] = useState(0)
  const online = store.isOnline(chat.computerId)
  const viewOnly = store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const io = useRef(store)
  io.current = store
  useEffect(() => {
    if (viewOnly || !open || !online || !chat.taskId) return
    let active = true
    setStatus('Loading…')
    void io.current
      .invoke(chat.computerId, 'hostBrowser.status')
      .then((status) => {
        if (!active) return
        const viewable = status.viewable ?? status.enabled ?? status.available
        setHosted(viewable)
        setHostManaged(status.enabled === true)
        setHostReason(
          !viewable
            ? 'No browser is running for this thread yet. Open Ramu on the computer, or turn on Host browser in Settings → Browser.'
            : '',
        )
      })
      .catch(() => {
        if (!active) return
        setHosted(false)
        setHostReason('Could not check the host browser. Update Ramu on the host and try again.')
      })
    void io.current.invoke(chat.computerId, 'browser.activity', chat.taskId).then(
      (result) => {
        if (!active) return
        setTabs(result.tabs)
        setExternalURLs(result.externalURLs ?? [])
        setStatus(result.available ? '' : 'Open Ramu on the execution host to use its integrated browser.')
      },
      (reason) => {
        if (!active) return
        setTabs([])
        const message = reason instanceof Error ? reason.message : String(reason)
        setStatus(message)
      },
    )
    return () => {
      active = false
    }
  }, [chat.computerId, chat.taskId, open, online, revision, viewOnly])
  if (!chat.taskId) return null
  const host = store.computers.find((computer) => computer.id === chat.computerId)?.name ?? chat.computerId
  // One full-screen surface for every state, so iOS never swaps modals while the host check finishes.
  return (
    <ViewerScreen open={open} onClose={onClose}>
      {open && hosted ? (
        <BrowserViewer chat={chat} hostManaged={hostManaged} onClose={onClose} />
      ) : (
        <View style={{ flex: 1 }}>
          <ViewerHeader title={t('Browser')} subtitle={host} closeLabel={t('Close browser')} onClose={onClose} />
          <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
            {viewOnly ? (
              <View style={{ padding: space.m }}>
                <T tone="muted">{VIEW_ONLY_BROWSER_NOTICE[store.language]}</T>
              </View>
            ) : (
              <View style={{ padding: space.m, gap: space.m }}>
                <T tone="muted">
                  {t(
                    'Website sign-ins and local addresses stay on this host. Paired owner devices can view its browser through the existing connection.',
                  )}
                </T>
                {hostReason ? <T tone="muted">{t(hostReason)}</T> : null}
                {!online ? (
                  <T tone="muted">{t('Offline · last-known activity')}</T>
                ) : status ? (
                  <T tone="muted">{t(status)}</T>
                ) : null}
                {tabs.map((tab) => (
                  <View key={tab.id} style={{ gap: space.s }}>
                    <T weight="600">{tab.title || tab.url}</T>
                    <T size={font.caption} tone="muted">
                      {tab.url}
                    </T>
                    <T size={font.caption} tone="muted">
                      {t(
                        tab.paused
                          ? 'Control disconnected'
                          : tab.controller === 'agent'
                            ? 'Agent control'
                            : tab.controller === 'human'
                              ? 'You are in control'
                              : 'Open browser',
                      )}
                    </T>
                    {externalURLs.includes(tab.url) && canOpenBrowserLinkOnDevice(tab.url) ? (
                      <Button
                        kind="secondary"
                        title={t('Open in system browser')}
                        disabled={!online}
                        onPress={() => {
                          void Linking.openURL(tab.url).catch((reason) => setStatus(String(reason)))
                        }}
                      />
                    ) : (
                      <T tone="muted">{t('Open this local or private address on the computer it belongs to.')}</T>
                    )}
                  </View>
                ))}
                {!status && online && !tabs.length ? <T tone="muted">{t('No browser tabs in this thread.')}</T> : null}
                <Button
                  kind="ghost"
                  title={t('Refresh')}
                  disabled={!online}
                  onPress={() => refresh((value) => value + 1)}
                />
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </ViewerScreen>
  )
}
