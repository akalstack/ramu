import { useEffect, useRef, useState } from 'react'
import { AppState, Image, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type {
  BrowserDialog,
  BrowserHumanInput,
  BrowserDownloadInfo,
  BrowserPageSnapshot,
} from '@ramu/shared/browserBridge'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { translate } from '@ramu/shared/i18n'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, T } from './ui'
import { CONTROL_TEXT, controlState, profileLabel, viewerMessage } from '../runtime/browserViewerState'

/** The phone views the owning host's browser; it never substitutes a phone WebView or copies credentials. */
export function BrowserViewer({
  chat,
  onClose,
  embedded = false,
}: {
  chat: Chat
  onClose(): void
  embedded?: boolean
}) {
  const store = useStore()
  const { c: theme } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [selected, setSelected] = useState('')
  const [owned, setOwned] = useState<number | null>(null)
  const [frame, setFrame] = useState('')
  const [address, setAddress] = useState('')
  const [text, setText] = useState('')
  const [privateText, setPrivateText] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<BrowserDialog | null>(null)
  const [dialogText, setDialogText] = useState('')
  const [pageText, setPageText] = useState('')
  const [observation, setObservation] = useState<BrowserPageSnapshot | null>(null)
  const [uploadPath, setUploadPath] = useState('')
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [downloads, setDownloads] = useState<BrowserDownloadInfo[]>([])
  const [paths, setPaths] = useState<Record<string, string>>({})
  const downloadsVisible = useRef(downloadsOpen)
  downloadsVisible.current = downloadsOpen
  const [active, setActive] = useState(AppState.currentState === 'active')
  const [width, setWidth] = useState(1)
  const current = useRef<BrowserTabInfo | undefined>(undefined)
  const editing = useRef(false)
  const io = useRef(store)
  io.current = store
  const tab = tabs.find((tab) => tab.id === selected) ?? tabs[0]
  current.current = tab
  const controlled =
    !!tab &&
    tab.controller === 'human' &&
    tab.generation === owned &&
    !tab.paused &&
    active &&
    store.isOnline(chat.computerId)
  const own = controlled && !!tab?.inputReady
  const state = tab
    ? controlState(tab, { online: store.isOnline(chat.computerId), active, ownedGeneration: owned })
    : null
  const invoke = store.invoke.bind(store)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (!active || !chat.taskId || !store.isOnline(chat.computerId)) return
    let mounted = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const listed = await io.current.invoke(chat.computerId, 'hostBrowser.list', chat.taskId!)
        if (!mounted) return
        setTabs(listed)
        if (downloadsVisible.current) {
          const entries = await io.current.invoke(chat.computerId, 'hostBrowser.downloads', chat.taskId!)
          if (!mounted) return
          setDownloads(entries)
        }
        const tab = listed.find((tab) => tab.id === current.current?.id) ?? listed[0]
        if (tab) {
          const websiteDialog = await io.current.invoke(chat.computerId, 'hostBrowser.dialog', chat.taskId!, tab.id)
          if (!mounted) return
          setDialog(websiteDialog)
          if (!editing.current) setAddress(tab.url)
          if (!websiteDialog) {
            const image = await io.current.invoke(chat.computerId, 'hostBrowser.frame', chat.taskId!, tab.id)
            if (!mounted) return
            setFrame(`data:${image.mimeType};base64,${image.data}`)
          }
        } else {
          setFrame('')
          setDialog(null)
        }
        setError('')
      } catch (error) {
        if (mounted) setError(error instanceof Error ? error.message : String(error))
      } finally {
        if (mounted) timer = setTimeout(() => void poll(), 750)
      }
    }
    void poll()
    return () => {
      mounted = false
      clearTimeout(timer)
      void io.current.invoke(chat.computerId, 'hostBrowser.disconnect').catch(() => {})
    }
  }, [chat.computerId, chat.taskId, active, store.isOnline(chat.computerId)])
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const input = (input: BrowserHumanInput) => {
    if (!own || !tab || !chat.taskId) return
    void act(() => invoke(chat.computerId, 'hostBrowser.input', chat.taskId!, tab.id, tab.generation, input))
  }
  const inputStyle = {
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    padding: space.s,
    fontSize: font.body,
  }
  const Container = embedded ? View : SafeAreaView
  const content = (
    <Container style={{ flex: 1, backgroundColor: theme.canvas }}>
      {!embedded && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.m }}>
          <T weight="600">
            {t('Browser')} · {store.computers.find((computer) => computer.id === chat.computerId)?.name}
          </T>
          <Button kind="ghost" title={t('Close')} onPress={onClose} />
        </View>
      )}
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: space.s, paddingHorizontal: space.m }}
      >
        {tabs.map((entry) => (
          <Button
            key={entry.id}
            kind={entry.id === tab?.id ? 'secondary' : 'ghost'}
            title={entry.title || entry.url}
            onPress={() => {
              setSelected(entry.id)
              setOwned(null)
              setFrame('')
            }}
          />
        ))}
      </ScrollView>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.m, gap: space.s }}>
        <T tone="muted">{t('Browser runs on the selected execution host. Sign-ins stay there.')}</T>
        {error ? <T tone="muted">{t(viewerMessage(error))}</T> : null}
        {tab && state && (
          <View accessibilityRole="summary" style={{ gap: 2 }}>
            <T tone="muted" size={font.caption}>
              {t(profileLabel(tab.profileId))} ·{' '}
              {store.computers.find((computer) => computer.id === chat.computerId)?.name}
            </T>
            <T
              accessibilityLiveRegion="polite"
              tone={state === 'disconnected' ? undefined : 'muted'}
              weight={state === 'disconnected' ? '600' : undefined}
            >
              {t(CONTROL_TEXT[state])}
            </T>
          </View>
        )}
        <TextInput
          accessibilityLabel={t('Address')}
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => {
            editing.current = true
          }}
          onBlur={() => {
            editing.current = false
          }}
          editable={own || !tab}
          style={inputStyle}
          onSubmitEditing={() =>
            void act(async () => {
              if (!chat.taskId) return
              const url = /^https?:\/\//i.test(address) ? address : `https://${address}`
              if (tab) await invoke(chat.computerId, 'hostBrowser.navigate', chat.taskId, tab.id, url)
              else {
                const result = await invoke(chat.computerId, 'hostBrowser.open', chat.taskId, url)
                setSelected(result.tab.id)
                setOwned(result.tab.generation)
              }
            })
          }
        />
        {tab && (
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            <Button
              title={controlled ? t('Give control to agent') : t('Take control')}
              disabled={busy || !active}
              onPress={() =>
                void act(async () => {
                  const next = await invoke(
                    chat.computerId,
                    controlled ? 'hostBrowser.release' : 'hostBrowser.take',
                    chat.taskId!,
                    tab.id,
                  )
                  setOwned(controlled ? null : next.generation)
                })
              }
            />
            {(['back', 'forward', 'reload'] as const).map((direction) => (
              <Button
                key={direction}
                kind="ghost"
                title={t(direction === 'back' ? 'Back' : direction === 'forward' ? 'Forward' : 'Reload')}
                disabled={!own || busy}
                onPress={() =>
                  void act(() => invoke(chat.computerId, 'hostBrowser.history', chat.taskId!, tab.id, direction))
                }
              />
            ))}
          </View>
        )}
        {dialog && (
          <View accessibilityRole="alert" style={{ gap: space.s }}>
            <T>{dialog.message}</T>
            {dialog.type === 'prompt' && (
              <TextInput
                accessibilityLabel={t('Website dialog answer')}
                value={dialogText}
                onChangeText={setDialogText}
                style={inputStyle}
              />
            )}
            {[false, true].map((accept) => (
              <Button
                key={String(accept)}
                title={accept ? t('OK') : t('Cancel')}
                disabled={!controlled || busy}
                onPress={() =>
                  void act(() =>
                    invoke(
                      chat.computerId,
                      'hostBrowser.answerDialog',
                      chat.taskId!,
                      tab!.id,
                      dialog.id,
                      accept,
                      dialogText,
                    ),
                  )
                }
              />
            ))}
          </View>
        )}
        {frame ? (
          <Pressable
            disabled={!own || busy}
            accessibilityRole="button"
            accessibilityLabel={t('Browser page on the execution host')}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            onPress={(event) =>
              input({
                kind: 'click',
                x: Math.max(0, Math.min(1, event.nativeEvent.locationX / width)),
                y: Math.max(0, Math.min(1, event.nativeEvent.locationY / (width * 0.75))),
                button: 'left',
                clickCount: 1,
              })
            }
          >
            <Image source={{ uri: frame }} resizeMode="contain" style={{ width: '100%', aspectRatio: 4 / 3 }} />
          </Pressable>
        ) : (
          <T tone="muted">{t('Choose a tab or enter an address to open a page.')}</T>
        )}
        {tab && (
          <Button
            kind="ghost"
            title={t('Read page text')}
            onPress={() =>
              void act(async () => {
                const snapshot = await invoke(chat.computerId, 'hostBrowser.read', chat.taskId!, tab.id)
                setPageText(snapshot.text)
                setObservation(snapshot)
              })
            }
          />
        )}
        {!!pageText && <T>{pageText}</T>}
        {own && observation?.elements.some((element) => element.type === 'file') && (
          <View style={{ gap: space.s }}>
            <TextInput
              accessibilityLabel={t('Upload from workspace path')}
              value={uploadPath}
              maxLength={4000}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setUploadPath}
              placeholder={t('Relative workspace file (maximum 8 MiB)')}
              style={inputStyle}
            />
            {observation.elements
              .filter((element) => element.type === 'file')
              .map((element) => (
                <Button
                  key={element.ref}
                  title={`${t('Upload')} · ${element.name || t('Website file input')}`}
                  disabled={busy || !uploadPath}
                  onPress={() =>
                    void act(async () => {
                      const result = await invoke(
                        chat.computerId,
                        'hostBrowser.upload',
                        chat.taskId!,
                        tab!.id,
                        tab!.generation,
                        observation.snapshot,
                        element.ref,
                        uploadPath,
                      )
                      if (!result.ok) throw new Error(result.reason ?? 'Read the page again before uploading.')
                      setObservation(null)
                      setUploadPath('')
                    })
                  }
                />
              ))}
          </View>
        )}
        <Button kind="ghost" title={t('Downloads')} onPress={() => setDownloadsOpen(!downloadsOpen)} />
        {downloadsOpen && (
          <View style={{ gap: space.s }}>
            <T tone="muted">
              {t(
                'Downloads stay on the execution host. Save into a new relative workspace file; existing files are never overwritten.',
              )}
            </T>
            <Button
              kind="secondary"
              title={t('Allow next download')}
              disabled={!own || busy || !tab}
              onPress={() =>
                tab && void act(() => invoke(chat.computerId, 'hostBrowser.allowDownload', chat.taskId!, tab.id))
              }
            />
            {downloads.map((entry) => (
              <View key={entry.id} style={{ gap: space.s }}>
                <T>
                  {entry.name} · {t(entry.state)} · {Math.ceil(entry.received / 1024)} KiB
                </T>
                {entry.state === 'completed' && (
                  <>
                    <TextInput
                      accessibilityLabel={t('Save to workspace path')}
                      value={paths[entry.id] ?? entry.name}
                      maxLength={4000}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={inputStyle}
                      onChangeText={(value) => setPaths((paths) => ({ ...paths, [entry.id]: value }))}
                    />
                    <Button
                      title={t('Save')}
                      disabled={busy}
                      onPress={() =>
                        void act(async () => {
                          await invoke(
                            chat.computerId,
                            'hostBrowser.saveDownload',
                            chat.taskId!,
                            entry.id,
                            paths[entry.id] ?? entry.name,
                          )
                          setError(t('Saved to the thread workspace.'))
                        })
                      }
                    />
                  </>
                )}
                <Button
                  kind="ghost"
                  title={entry.state === 'progressing' ? t('Cancel') : t('Remove')}
                  disabled={busy}
                  onPress={() =>
                    void act(() => invoke(chat.computerId, 'hostBrowser.cancelDownload', chat.taskId!, entry.id))
                  }
                />
              </View>
            ))}
          </View>
        )}
        {own && (
          <>
            <TextInput
              accessibilityLabel={t('Text for the focused website field')}
              secureTextEntry={privateText}
              autoCapitalize="none"
              autoCorrect={false}
              value={text}
              maxLength={2000}
              onChangeText={setText}
              style={inputStyle}
            />
            <Button
              kind="ghost"
              title={privateText ? t('Show text') : t('Hide text')}
              onPress={() => setPrivateText(!privateText)}
            />
            <Button
              title={t('Type')}
              disabled={busy || !text}
              onPress={() =>
                void act(async () => {
                  await invoke(chat.computerId, 'hostBrowser.input', chat.taskId!, tab!.id, tab!.generation, {
                    kind: 'text',
                    text,
                  })
                  setText((current) => (current === text ? '' : current))
                })
              }
            />
            <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
              {['Enter', 'Tab', 'Backspace', 'Escape'].map((key) => (
                <Button
                  key={key}
                  kind="ghost"
                  title={key}
                  disabled={busy}
                  onPress={() => input({ kind: 'key', key })}
                />
              ))}
              <Button
                kind="ghost"
                title={t('Scroll up')}
                disabled={busy}
                onPress={() => input({ kind: 'scroll', x: 0, y: -500 })}
              />
              <Button
                kind="ghost"
                title={t('Scroll down')}
                disabled={busy}
                onPress={() => input({ kind: 'scroll', x: 0, y: 500 })}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Container>
  )
  return embedded ? (
    content
  ) : (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {content}
    </Modal>
  )
}
