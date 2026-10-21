import { useEffect, useRef, useState } from 'react'
import { Linking, View } from 'react-native'
import { Globe } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { canOpenBrowserLinkOnDevice } from '@ramu/shared/browserLinks'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Button, Sheet, T } from './ui'
import { BrowserViewer } from './BrowserViewer'

/** Observes the host's metadata. Opening a website here never transfers its sign-in or local address to the phone. */
export function BrowserActivity({ chat }: { chat: Chat }) {
  const store = useStore()
  const t = (key: string) => translate(store.language, key)
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [hosted, setHosted] = useState(false)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [externalURLs, setExternalURLs] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [revision, refresh] = useState(0)
  const online = store.isOnline(chat.computerId)
  const io = useRef(store)
  io.current = store
  useEffect(() => {
    if (!open || !online || !chat.taskId) return
    let active = true
    setStatus('Loading…')
    void io.current.invoke(chat.computerId, 'hostBrowser.status').then(status => { if (active) setHosted(status.available) }).catch(() => { if (active) setHosted(false) })
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
        setStatus(/unknown method/i.test(message) ? 'Update this host to view browser activity.' : message)
      },
    )
    return () => {
      active = false
    }
  }, [chat.computerId, chat.taskId, open, online, revision])
  if (!chat.taskId) return null
  const host = store.computers.find((computer) => computer.id === chat.computerId)?.name ?? chat.computerId
  return (
    <>
      <Button kind="ghost" icon={Globe} title={t('Browser')} onPress={() => setOpen(true)} />
      {viewing && <BrowserViewer chat={chat} onClose={() => setViewing(false)}/>}
      <Sheet open={open} onClose={() => setOpen(false)} title={`${t('Browser')} · ${host}`}>
        <View style={{ padding: space.m, gap: space.m }}>
          <T tone="muted">
            {t(
              'Website sign-ins and local addresses belong to this host. Remote viewing requires a host browser and a separate device/thread grant.',
            )}
          </T>
          {hosted && <Button kind="secondary" title={t('View host browser')} disabled={!online || store.computers.find(computer => computer.id === chat.computerId)?.access === 'viewer'} onPress={() => { setOpen(false); setViewing(true) }}/>} 
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
                <T tone="muted">{t('Open this local or private address on its owning computer.')}</T>
              )}
            </View>
          ))}
          {!status && online && !tabs.length ? <T tone="muted">{t('No browser tabs in this thread.')}</T> : null}
          <Button kind="ghost" title={t('Refresh')} disabled={!online} onPress={() => refresh((value) => value + 1)} />
        </View>
      </Sheet>
    </>
  )
}
