import { BrowserInputQueue, watchBrowserFrames } from '@ramu/shared/browserLiveViewer'
import { VIEW_ONLY_BROWSER_NOTICE } from '../runtime/viewerAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Image, Modal, PanResponder, ScrollView, TextInput, View } from 'react-native'
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
import {
  CONTROL_TEXT,
  controlState,
  frameGesture,
  frameScroll,
  profileLabel,
  viewerMessage,
} from '../runtime/browserViewerState'

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
  const viewOnly = store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const target = `${chat.computerId}:${chat.taskId}`
  const currentTarget = useRef(target)
  currentTarget.current = target
  const { c: theme } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [selected, setSelected] = useState('')
  const [owned, setOwned] = useState<number | null>(null)
  const [frame, setFrame] = useState('')
  const [frameSize, setFrameSize] = useState({ width: 4, height: 3 })
  const [address, setAddress] = useState('')
  const [text, setText] = useState('')
  const [privateText, setPrivateText] = useState(true)
  const [error, setError] = useState('')
  const [frameError, setFrameError] = useState('')
  const [frameReady, setFrameReady] = useState(false)
  const inputQueue = useRef<BrowserInputQueue | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTab, setNewTab] = useState(false)
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
  const addressEdited = useRef(false)
  const addressValue = useRef(address)
  addressValue.current = address
  const io = useRef(store)
  io.current = store
  const allowed = useCallback(
    () =>
      currentTarget.current === target &&
      io.current.computers?.find((host) => host.id === chat.computerId)?.access !== 'viewer' &&
      io.current.isOnline(chat.computerId),
    [target, chat.computerId],
  )
  const tab = tabs.find((tab) => tab.id === selected) ?? tabs[0]
  const tabId = tab?.id
  const generation = tab?.generation
  const online = store.isOnline(chat.computerId)
  current.current = tab
  const controlled =
    !viewOnly &&
    !!tab &&
    tab.controller === 'human' &&
    tab.generation === owned &&
    !tab.paused &&
    active &&
    store.isOnline(chat.computerId)
  const readyGeneration = useRef('')
  const controlKey = tab ? `${tab.id}:${tab.generation}` : ''
  if (tab?.inputReady) readyGeneration.current = controlKey
  const own = controlled && readyGeneration.current === controlKey && frameReady
  const state = tab
    ? controlState(tab, { online: store.isOnline(chat.computerId), active, ownedGeneration: owned })
    : null
  const invoke = store.invoke.bind(store)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (viewOnly || !active || !chat.taskId || !online) return
    let mounted = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!allowed()) return
      try {
        const listed = await io.current.invoke(chat.computerId, 'hostBrowser.list', chat.taskId!)
        if (!mounted || !allowed()) return
        setTabs(listed)
        if (downloadsVisible.current) {
          const entries = await io.current.invoke(chat.computerId, 'hostBrowser.downloads', chat.taskId!)
          if (!mounted || !allowed()) return
          setDownloads(entries)
        }
        const tab = listed.find((tab) => tab.id === current.current?.id) ?? listed[0]
        if (tab) {
          const websiteDialog = await io.current.invoke(chat.computerId, 'hostBrowser.dialog', chat.taskId!, tab.id)
          if (!mounted || !allowed()) return
          setDialog(websiteDialog)
          if (!editing.current && !addressEdited.current) setAddress(tab.url)
        } else {
          setFrame('')
          setDialog(null)
        }
        setError('')
      } catch (error) {
        if (mounted) setError(error instanceof Error ? error.message : String(error))
      } finally {
        if (mounted && allowed()) timer = setTimeout(() => void poll(), 750)
      }
    }
    void poll()
    return () => {
      mounted = false
      clearTimeout(timer)
      if (allowed()) void io.current.invoke(chat.computerId, 'hostBrowser.disconnect').catch(() => {})
    }
  }, [chat.computerId, chat.taskId, active, viewOnly, online, allowed])
  const act = async (work: () => Promise<unknown>) => {
    if (!allowed() || busy) return
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
  useEffect(() => {
    setFrameReady(false)
    setFrame('')
    setFrameError('')
    if (viewOnly || !active || !online || !chat.taskId || !tabId || !allowed()) return
    return watchBrowserFrames({
      next: (after) => io.current.invoke(chat.computerId, 'hostBrowser.nextFrame', chat.taskId!, tabId, after),
      fallback: () => io.current.invoke(chat.computerId, 'hostBrowser.frame', chat.taskId!, tabId),
      show: (image) => {
        if (!allowed()) return
        setFrame(`data:${image.mimeType};base64,${image.data}`)
        setFrameSize({ width: image.width, height: image.height })
      },
      ready: (value) => {
        if (allowed()) setFrameReady(value)
      },
      error: (message) => {
        if (allowed()) setFrameError(message)
      },
    })
  }, [chat.computerId, chat.taskId, tabId, active, online, viewOnly, allowed])
  useEffect(() => {
    if (!controlled || !frameReady || !tabId || generation === undefined || !chat.taskId) return
    const queue = new BrowserInputQueue(async (input) => {
      if (!allowed()) throw new Error('Browser control changed.')
      await io.current.invoke(chat.computerId, 'hostBrowser.input', chat.taskId!, tabId, generation, input)
    })
    inputQueue.current = queue
    return () => {
      queue.close()
      if (inputQueue.current === queue) inputQueue.current = null
    }
  }, [chat.computerId, chat.taskId, tabId, generation, controlled, frameReady, allowed])
  const input = (input: BrowserHumanInput) => {
    if (!allowed() || !own || busy || (input.kind === 'scroll' && !input.x && !input.y)) return
    void inputQueue.current?.push(input).catch((error) => {
      if (allowed()) setError(String(error.message ?? error))
    })
  }
  const aspect = frameSize.width / frameSize.height
  const touch = useRef({ at: 0, lastTap: 0, dx: 0, dy: 0, scrolling: false })
  const gestureState = useRef({ input, width, aspect, pageWidth: frameSize.width, enabled: false })
  gestureState.current = { input, width, aspect, pageWidth: frameSize.width, enabled: own && !busy }
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => gestureState.current.enabled,
      onPanResponderGrant: () => {
        touch.current.at = Date.now()
        touch.current.dx = 0
        touch.current.dy = 0
        touch.current.scrolling = false
      },
      onPanResponderMove: (_event, gesture) => {
        const current = gestureState.current
        if (!current.enabled || (!touch.current.scrolling && Math.hypot(gesture.dx, gesture.dy) <= 8)) return
        touch.current.scrolling = true
        current.input(frameScroll(gesture.dx - touch.current.dx, gesture.dy - touch.current.dy, current))
        touch.current.dx = gesture.dx
        touch.current.dy = gesture.dy
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (event, gesture) => {
        const now = Date.now()
        const current = gestureState.current
        if (touch.current.scrolling) {
          current.input(frameScroll(gesture.dx - touch.current.dx, gesture.dy - touch.current.dy, current))
          touch.current.lastTap = 0
          return
        }
        const result = frameGesture(
          {
            x: event.nativeEvent.locationX,
            y: event.nativeEvent.locationY,
            dx: gesture.dx,
            dy: gesture.dy,
            ms: now - touch.current.at,
            afterTapMs: touch.current.lastTap ? now - touch.current.lastTap : null,
          },
          { width: current.width, aspect: current.aspect, pageWidth: current.pageWidth },
        )
        touch.current.lastTap = result.kind === 'click' && result.button === 'left' ? now : 0
        current.input(result)
      },
    }),
  ).current
  const inputStyle = {
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    padding: space.s,
    fontSize: font.body,
  }
  const Container = embedded ? View : SafeAreaView
  if (viewOnly) {
    const notice = (
      <Container style={{ flex: 1, padding: space.m, gap: space.m, backgroundColor: theme.canvas }}>
        <T tone="muted">{VIEW_ONLY_BROWSER_NOTICE[store.language]}</T>
        <Button kind="ghost" title={t('Close')} onPress={onClose} />
      </Container>
    )
    return embedded ? (
      notice
    ) : (
      <Modal visible animationType="slide" onRequestClose={onClose}>
        {notice}
      </Modal>
    )
  }
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
              addressEdited.current = false
              setAddress(entry.url)
              setOwned(null)
              setFrame('')
            }}
          />
        ))}
      </ScrollView>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.m, gap: space.s }}>
        <T tone="muted">{t('Browser runs on the selected execution host. Sign-ins stay there.')}</T>
        {error || frameError ? <T tone="muted">{t(viewerMessage(error || frameError))}</T> : null}
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
          onChangeText={(value) => {
            addressEdited.current = true
            setAddress(value)
          }}
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
              if (tab && !newTab) await invoke(chat.computerId, 'hostBrowser.navigate', chat.taskId, tab.id, url)
              else {
                const result = await invoke(chat.computerId, 'hostBrowser.open', chat.taskId, url)
                setSelected(result.tab.id)
                setOwned(result.tab.generation)
                setNewTab(false)
              }
              if (addressValue.current === address) addressEdited.current = false
            })
          }
        />
        {tab && (
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            <Button
              kind="ghost"
              title={newTab ? t('Cancel') : t('New tab')}
              disabled={busy}
              onPress={() => {
                setNewTab(!newTab)
                addressEdited.current = !newTab
                setAddress(newTab ? tab.url : '')
              }}
            />
            <Button
              kind="ghost"
              title={t('Close tab')}
              disabled={busy || !chat.taskId}
              onPress={() =>
                void act(async () => {
                  await invoke(chat.computerId, 'hostBrowser.close', chat.taskId!, tab.id)
                  setSelected('')
                  setOwned(null)
                  setFrame('')
                })
              }
            />
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
          <View
            {...pan.panHandlers}
            accessibilityRole="image"
            accessibilityLabel={t('Browser page on the execution host')}
            accessibilityHint={own ? t('Tap to click, hold to right-click, drag to scroll') : undefined}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          >
            <Image source={{ uri: frame }} resizeMode="contain" style={{ width: '100%', aspectRatio: aspect }} />
          </View>
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
                  if (!inputQueue.current) throw new Error('Take control again to continue.')
                  await inputQueue.current.push({ kind: 'text', text })
                  setText((current) => (current === text ? '' : current))
                })
              }
            />
            <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
              {['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((key) => (
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
