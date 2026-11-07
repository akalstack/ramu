import { InteractiveFollowupPicker } from './InteractiveFollowupPicker'
import { shareFile } from './interactiveShare'
import { ArtifactKindMark, HOST_SHARE_LABELS, SHARE_LABELS } from './ArtifactKindMark'
import {
  hostExportFormats,
  interactiveExport,
  kindExports,
  type ExportedFile,
  type HostExportFormat,
} from '@ramu/shared/interactiveExport'
import { artifactKind } from '@ramu/shared/artifacts'
import { interactiveVersions, canCopyInteractiveState } from '@ramu/shared/interactiveVersions'
import { InteractiveVisibility } from './InteractiveVisibility'
import { translate } from '@ramu/shared/i18n'
import { space, useTheme } from '../theme'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Image, Platform, ScrollView, TextInput, View } from 'react-native'
import { Expand, MoreHorizontal } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { InteractiveDocument, InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveFollowup, interactiveHtml, readInteractiveState } from '@ramu/shared/interactive'
import { interactiveStorage } from '@ramu/shared/interactiveStorage'
import type { InteractiveUpdate } from '@ramu/shared/interactiveRevisions'
import { interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { claimInteractive } from '@ramu/shared/interactiveLease'
import { contentStorage } from '../storage'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { Button, Card, IconButton, Row, Sheet, T } from './ui'
import InteractiveFrame from './InteractiveFrame'
/** Secondary content actions share the settings row treatment; saving a scenario is the primary action. */
function ContentAction({ title, disabled, onPress }: Parameters<typeof Button>[0]) {
  return (
    <Row
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
    >
      <T tone={disabled ? 'muted' : 'text'} style={{ flex: 1 }}>
        {title}
      </T>
    </Row>
  )
}

export function InteractiveDocumentCard({
  reference,
  chat,
  onAsk,
  copyFrom,
  onVersions,
  previous,
  update,
}: {
  reference: InteractiveReference
  onVersions?(): void
  copyFrom?: InteractiveReference
  chat: Chat
  onAsk(text: string): void
  previous?: InteractiveReference
  update?: InteractiveUpdate
}) {
  const visible = useContext(InteractiveVisibility)
  const store = useStore()
  const { invoke } = store
  const online = store.isOnline(chat.computerId)
  const t = useCallback((text: string) => translate(store.language, text), [store.language])
  const { c, scheme } = useTheme()
  const theme = useMemo(
    () =>
      interactiveThemeVariables({
        scheme,
        background: c.window,
        foreground: c.text,
        muted: c.muted,
        primary: c.accent,
        surface: c.raised2,
        surfaceRaised: c.bubble,
        codeBackground: c.code,
        button: c.primary,
        buttonForeground: c.primaryInk,
        success: c.ok,
        warning: c.warn,
        danger: c.bad,
      }),
    [c, scheme],
  )
  const cache = useMemo(() => interactiveStorage(contentStorage, chat.computerId), [chat.computerId])
  const [document, setDocument] = useState<InteractiveDocument | null>(() =>
    cache.document(reference.id, reference.version),
  )
  const pending = useRef<{ id: string; run: () => void; timer: ReturnType<typeof setTimeout> } | null>(null)
  const sequence = useRef(0)
  const [snapshot, setSnapshot] = useState('')
  const state = useRef(cache.state(reference.id, reference.version))
  const [carried, setCarried] = useState<{ moved: boolean; from: number } | null>(null)
  // A new version takes the values entered in the one it replaced once, when their meaning is declared the same.
  useEffect(() => {
    if (!previous || state.current) return
    const flag = `ramu.interactive.carried.${chat.computerId}.${reference.id}:${reference.version}`
    try {
      if (contentStorage.getItem(flag)) return
      contentStorage.setItem(flag, '1')
    } catch {
      return
    }
    const saved = cache.state(previous.id, previous.version)
    if (!saved) return
    if (canCopyInteractiveState(previous, reference)) {
      state.current = saved
      cache.saveState(reference.id, reference.version, saved)
      setCarried({ moved: true, from: previous.version })
      setGeneration((n) => n + 1)
    } else setCarried({ moved: false, from: previous.version })
  }, [previous, reference, cache, chat.computerId])
  const [selectionId, setSelectionId] = useState(0)
  const [selection, setSelection] = useState<InteractiveState | null>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [, setScenarioRevision] = useState(0)
  const scenarios = cache.scenarios(reference.id, reference.version)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)
  const [evicted, setEvicted] = useState(false)
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  )
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [file, setFile] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  const router = useRouter()
  // Whether this document is kept as a page, asked when the actions open rather than for every card.
  const [kept, setKept] = useState<boolean | null>(null)
  useEffect(() => {
    if (!actionsOpen || kept !== null) return
    void invoke(chat.computerId, 'artifacts.exists', reference.id).then(setKept, () => setKept(false))
  }, [actionsOpen, kept, invoke, chat.computerId, reference.id])
  const openPage = () => {
    setActionsOpen(false)
    router.push({ pathname: '/artifact/[computer]/[id]', params: { computer: chat.computerId, id: reference.id } })
  }
  const [expanded, setExpanded] = useState(false)
  const live = !!document && (visible || expanded) && foreground && !failed && !evicted && mode === 'preview'
  const [generation, setGeneration] = useState(0)
  const [height, setHeight] = useState(400)
  // A resumed native WebView must receive the latest declared state, not the first mount's HTML.
  const activeView = (visible || expanded) && foreground
  const lifecycle = useRef({ active: activeView, revision: 0 })
  if (activeView !== lifecycle.current.active) {
    lifecycle.current.active = activeView
    lifecycle.current.revision++
  }
  const instance = `${reference.id}:${reference.version}:${generation}:${lifecycle.current.revision}`
  const currentInstance = useRef(instance)
  currentInstance.current = instance
  const currentTheme = useRef(theme)
  currentTheme.current = theme
  const html = useMemo(
    () =>
      document
        ? interactiveHtml(document.html, instance, state.current, currentTheme.current, document.reference.network)
        : '',
    [document, instance],
  )
  useEffect(() => {
    let cancelled = false
    void invoke(chat.computerId, 'interactive.get', reference.sessionId, reference.id, reference.version)
      .then((value) => {
        if (!cancelled) {
          cache.saveDocument(value)
          setDocument(value)
          setError('')
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('Host unavailable. Reconnect to load content.'))
      })
    return () => {
      cancelled = true
    }
  }, [invoke, chat.computerId, reference, cache, online, t])
  useEffect(() => (live ? claimInteractive(() => setEvicted(true), 3) : undefined), [live])
  useEffect(() => {
    if (visible) setEvicted(false)
  }, [visible])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (value) => {
      if (value !== 'inactive') setForeground(value === 'active')
    })
    return () => sub.remove()
  }, [])
  const stop = useCallback(() => {
    if (currentInstance.current === instance) setFailed(true)
  }, [instance])
  const receive = useCallback(
    (value: unknown) => {
      if (!value || typeof value !== 'object') return
      const m = value as {
        ramuInteractive?: number
        instance?: string
        type?: string
        value?: unknown
        requestId?: string
      }
      if (m.ramuInteractive !== 1 || m.instance !== instance || currentInstance.current !== instance) return
      if (m.type === 'state') {
        const next = readInteractiveState(m.value)
        if (next) {
          state.current = next
          cache.saveState(reference.id, reference.version, next)
          if (pending.current && m.requestId === pending.current.id) {
            const action = pending.current
            pending.current = null
            clearTimeout(action.timer)
            action.run()
          }
        }
      }
      if (m.type === 'height' && typeof m.value === 'number' && Number.isFinite(m.value))
        setHeight(Math.max(120, Math.min(2000, m.value)))
      if (m.type === 'error') {
        setError(t('An interaction failed. Ask the agent to revise this version.'))
        setFailed(true)
      }
    },
    [instance, reference, cache, t],
  )
  const capture = (run: () => void) => {
    if (!live) {
      run()
      return
    }
    if (pending.current) clearTimeout(pending.current.timer)
    const id = `${instance}:${++sequence.current}`
    const timer = setTimeout(() => {
      pending.current = null
      setError(t('Could not capture the current scenario. Reload and try again.'))
    }, 1500)
    pending.current = { id, run, timer }
    setSnapshot(id)
  }
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = null
    },
    [instance],
  )
  const open = () => {
    setError('')
    setGeneration((n) => n + 1)
    setFailed(false)
    setEvicted(false)
  }
  const send = (file: ExportedFile) => {
    setSharing(true)
    void shareFile(file)
      .catch(() => setError(t('Could not share this content. Try again.')))
      .finally(() => setSharing(false))
  }
  // The host makes these (and keeps them with the version), so the share sheet opens once the file arrives.
  const shareMade = (format: HostExportFormat) => {
    setSharing(true)
    void invoke(chat.computerId, 'interactive.export', reference.sessionId, reference.id, reference.version, format)
      .then(shareFile)
      .catch(() => setError(t('Could not share this content. Try again.')))
      .finally(() => setSharing(false))
  }
  const share = (raw = false) => {
    const run = () => {
      if (!document || sharing) return
      const exported = interactiveExport(document, state.current, raw, theme)
      send({ name: exported.name, content: exported.html, mimeType: exported.mimeType })
    }
    if (raw) run()
    else capture(run)
  }
  const frame =
    live && document ? (
      <InteractiveFrame
        html={html}
        snapshot={snapshot}
        title={reference.title}
        instance={instance}
        height={height}
        theme={theme}
        onMessage={receive}
        onStop={stop}
      />
    ) : null
  const files = document?.files?.length ? document.files : [{ path: 'index.html', content: document?.html ?? '' }]
  const source = files[file] ?? files[0]!
  const content =
    mode === 'code' ? (
      <View style={{ gap: 8 }}>
        {files.length > 1 && (
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {files.map((entry, index) => (
              <Button
                key={entry.path}
                title={entry.path}
                kind={source.path === entry.path ? 'secondary' : 'ghost'}
                accessibilityLabel={source.path === entry.path ? `${entry.path} · ${t('Current file')}` : entry.path}
                onPress={() => setFile(index)}
              />
            ))}
          </ScrollView>
        )}
        <T tone="muted">{source.path}</T>
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 500, backgroundColor: c.code }}
          contentContainerStyle={{ padding: 12 }}
        >
          <T mono copyable={source.encoding === 'base64' ? undefined : source.content}>
            {source.encoding === 'base64' ? t('Binary file') : source.content}
          </T>
        </ScrollView>
      </View>
    ) : (
      frame
    )
  return (
    <View style={{ marginVertical: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ArtifactKindMark kind={reference.kind ?? 'app'} color={c.muted} />
        <T weight="600" style={{ flex: 1 }}>
          {reference.title} · v{reference.version}
        </T>
        <Button
          title={mode === 'preview' ? t('Code') : t('Preview')}
          kind="ghost"
          disabled={!document}
          onPress={() =>
            capture(() => {
              setMode(mode === 'preview' ? 'code' : 'preview')
              setGeneration((n) => n + 1)
            })
          }
        />
        <IconButton
          icon={Expand}
          label={t('Expand')}
          disabled={!document}
          onPress={() =>
            capture(() => {
              setExpanded(true)
              setGeneration((n) => n + 1)
            })
          }
        />
        <IconButton icon={MoreHorizontal} label={t('Content actions')} onPress={() => setActionsOpen(true)} />
      </View>
      {update?.state === 'updating' ? <T tone="muted">{t('Updating…')}</T> : null}
      {reference.changes ? (
        <T tone="muted">
          {translate(store.language, 'Updated · v{version}', { version: reference.version })} · {reference.changes}
        </T>
      ) : null}
      {update?.state === 'failed' ? (
        <T tone="muted">
          {translate(store.language, 'The latest revision did not publish, so this version is unchanged: {detail}', {
            detail: update.detail,
          })}
        </T>
      ) : null}
      {carried ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T tone="muted" style={{ flex: 1 }}>
            {carried.moved
              ? translate(store.language, 'Your values from v{version} carried over.', { version: carried.from })
              : translate(
                  store.language,
                  'Values from v{version} could not carry over because this version changed what they mean.',
                  { version: carried.from },
                )}
          </T>
          {carried.moved ? (
            <Button
              kind="ghost"
              title={t('Undo')}
              onPress={() => {
                setCarried(null)
                state.current = null
                cache.saveState(reference.id, reference.version, null)
                setGeneration((n) => n + 1)
              }}
            />
          ) : (
            <Button kind="ghost" title={t('Dismiss')} onPress={() => setCarried(null)} />
          )}
        </View>
      ) : null}
      {!document && !error ? <T tone="muted">{t('Loading content…')}</T> : null}
      {error ? (
        <T tone="muted">
          {error}
          {document ? t(' Saved content is available.') : ''}
        </T>
      ) : null}
      {mode === 'preview' && (failed || evicted) && document ? (
        <View style={{ gap: 8 }}>
          <T tone="muted">
            {failed
              ? t('Content stopped. Reload to try again.')
              : t('Other content is running. Reload to use this card.')}
          </T>
          <Button title={t('Reload')} onPress={open} />
        </View>
      ) : null}
      {mode === 'preview' && document?.preview && (failed || evicted || (Platform.OS === 'web' && !live)) ? (
        <Image source={{ uri: document.preview }} resizeMode="contain" style={{ height: 260, width: '100%' }} />
      ) : null}
      {!expanded && mode === 'preview' && !live && !failed && !evicted && document ? (
        <View style={{ height, backgroundColor: c.window }} />
      ) : null}
      {!expanded && content}
      <Sheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        presentation="screen"
        title={t('Content actions')}
      >
        <View style={{ padding: space.l, gap: space.m }}>
          <T tone="muted">{reference.checked ? t('Controls checked') : t('Rendering checked')}</T>
          <T tone="muted">{reference.summary}</T>
          <Card>
            {kept ? (
              <ContentAction title={t('Open')} onPress={openPage} />
            ) : kept === false && !copyFrom ? (
              <ContentAction
                title={t('Keep as artifact')}
                onPress={() =>
                  void invoke(chat.computerId, 'artifacts.keep', reference.sessionId, reference.id).then(
                    () => openPage(),
                    (e) => setError(e instanceof Error ? e.message : String(e)),
                  )
                }
              />
            ) : null}
            {onVersions && (
              <ContentAction
                title={t('Versions')}
                onPress={() => {
                  setActionsOpen(false)
                  onVersions()
                }}
              />
            )}
            <View style={{ gap: 0 }}>
              <ContentAction
                title={t('Reset')}
                onPress={() => {
                  state.current = null
                  cache.saveState(reference.id, reference.version, null)
                  setGeneration((n) => n + 1)
                  setError('')
                  setFailed(false)
                  setEvicted(false)
                }}
              />
              <ContentAction
                title={t('Ask about this')}
                onPress={() =>
                  capture(() => {
                    setActionsOpen(false)
                    onAsk(interactiveFollowup(reference, state.current))
                  })
                }
              />
            </View>
            <ContentAction
              title={t('Choose values')}
              disabled={!document}
              onPress={() =>
                capture(() => {
                  if (state.current) {
                    setSelection(state.current)
                    setSelectionId((n) => n + 1)
                  } else setError(t('Use the preview before choosing values.'))
                })
              }
            />
            {selection && (
              <InteractiveFollowupPicker
                key={selectionId}
                reference={reference}
                state={selection}
                onStage={(text) => {
                  setActionsOpen(false)
                  onAsk(text)
                }}
                onClose={() => setSelection(null)}
              />
            )}
            {reference.kind ? (
              <View style={{ gap: 0 }}>
                {(document ? kindExports(document, theme) : []).map(({ format, file }) => (
                  <ContentAction
                    key={format}
                    title={t(SHARE_LABELS[format])}
                    disabled={sharing}
                    onPress={() => send(file)}
                  />
                ))}
              </View>
            ) : (
              <View style={{ gap: 0 }}>
                <ContentAction title={t('Share HTML')} disabled={!document || sharing} onPress={() => share()} />
                <ContentAction title={t('Share source')} disabled={!document || sharing} onPress={() => share(true)} />
              </View>
            )}
            {online && (
              <View style={{ gap: 0 }}>
                {hostExportFormats(artifactKind(reference.kind)).map((format) => (
                  <ContentAction
                    key={format}
                    title={t(HOST_SHARE_LABELS[format])}
                    disabled={sharing}
                    onPress={() => shareMade(format)}
                  />
                ))}
              </View>
            )}
            {copyFrom && canCopyInteractiveState(copyFrom, reference) && (
              <ContentAction
                title={translate(store.language, 'Copy saved scenario from v{version}', { version: copyFrom.version })}
                onPress={() =>
                  capture(() => {
                    const saved = cache.state(copyFrom.id, copyFrom.version)
                    if (!saved) {
                      setError(t('Use the source version before copying its saved scenario.'))
                      return
                    }
                    state.current = saved
                    cache.saveState(reference.id, reference.version, saved)
                    setGeneration((n) => n + 1)
                  })
                }
              />
            )}
          </Card>
          <T weight="600">{t('Saved scenarios')}</T>
          <View style={{ gap: space.s }}>
            <TextInput
              accessibilityLabel={t('Scenario name')}
              placeholder={t('Scenario name')}
              placeholderTextColor={c.muted}
              value={scenarioName}
              maxLength={80}
              onChangeText={setScenarioName}
              style={{ minHeight: 44, padding: space.m, backgroundColor: c.fill, borderRadius: 8, color: c.text }}
            />
            <Button
              title={t('Save scenario')}
              disabled={!scenarioName.trim() || !document}
              onPress={() =>
                capture(() => {
                  if (!cache.saveScenario(reference.id, reference.version, scenarioName, state.current)) {
                    setError(t('Use the preview first. Save up to six scenarios per version and 20 per host.'))
                    return
                  }
                  setScenarioName('')
                  setScenarioRevision((n) => n + 1)
                })
              }
            />
          </View>
          {scenarios.map((scenario) => (
            <Card key={scenario.name} style={{ padding: space.m, gap: space.s }}>
              <T style={{ flex: 1 }}>{scenario.name}</T>
              <Button
                kind="secondary"
                title={t('Restore')}
                onPress={() =>
                  capture(() => {
                    state.current = scenario.state
                    cache.saveState(reference.id, reference.version, scenario.state)
                    setGeneration((n) => n + 1)
                  })
                }
              />
              <Button
                kind="danger"
                title={t('Delete')}
                onPress={() => {
                  if (cache.removeScenario(reference.id, reference.version, scenario.name))
                    setScenarioRevision((n) => n + 1)
                  else setError(t('Could not save local changes. Storage may be full.'))
                }}
              />
            </Card>
          ))}
        </View>
      </Sheet>
      <Sheet
        presentation="screen"
        open={expanded}
        title={reference.title}
        onClose={() => {
          capture(() => {
            setExpanded(false)
            setGeneration((n) => n + 1)
          })
        }}
      >
        {expanded && content}
      </Sheet>
    </View>
  )
}

/** A revision viewer is separate from the immutable card in the original turn. */
function InteractiveContentBrowser({
  reference,
  chat,
  onAsk,
  previous,
  update,
}: {
  reference: InteractiveReference
  chat: Chat
  onAsk(text: string): void
  previous?: InteractiveReference
  update?: InteractiveUpdate
}) {
  const store = useStore(),
    { invoke } = store
  const t = (text: string) => translate(store.language, text)
  const [versions, setVersions] = useState<InteractiveReference[] | null>(null)
  const [selected, setSelected] = useState<InteractiveReference | null>(null)
  const [error, setError] = useState('')
  const browse = async () => {
    try {
      setVersions(
        interactiveVersions(reference, await invoke(chat.computerId, 'interactive.list', reference.sessionId)),
      )
      setError('')
    } catch {
      setVersions(interactiveVersions(reference, interactiveStorage(contentStorage, chat.computerId).references()))
      setError(t('Host unavailable. Showing cached versions.'))
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <InteractiveDocumentCard
        key={`${reference.id}:${reference.version}`}
        reference={reference}
        chat={chat}
        onAsk={onAsk}
        onVersions={() => void browse()}
        previous={previous}
        update={update}
      />
      {versions && (
        <View style={{ gap: 8 }}>
          <T weight="600">{t('Content versions')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {versions.map((version) => (
              <Button
                key={version.version}
                title={`v${version.version}${version.version === reference.version ? ' · ' + t('This turn') : ''}`}
                onPress={() => setSelected(version)}
              />
            ))}
            <Button
              title={t('Close')}
              onPress={() => {
                setVersions(null)
                setSelected(null)
              }}
            />
          </View>
          {error ? <T tone="muted">{error}</T> : null}
          {selected && selected.version !== reference.version && (
            <InteractiveDocumentCard
              key={`${selected.id}:${selected.version}`}
              reference={selected}
              copyFrom={reference}
              chat={chat}
              onAsk={onAsk}
            />
          )}
        </View>
      )}
    </View>
  )
}

/** An older version, collapsed in its place: what replaced it, Go to latest, and a read-only look with Restore. */
export function InteractiveOlderVersion({
  reference,
  replacedBy,
  chat,
  readOnly,
  onLatest,
}: {
  reference: InteractiveReference
  replacedBy: { version: number; changes?: string }
  chat: Chat
  readOnly?: boolean
  onLatest(): void
}) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || preview) return
    let cancelled = false
    void store
      .invoke(chat.computerId, 'interactive.get', reference.sessionId, reference.id, reference.version)
      .then((value) => !cancelled && setPreview(value.preview))
      .catch(() => !cancelled && setError(translate(store.language, 'Host unavailable. Reconnect to load content.')))
    return () => {
      cancelled = true
    }
  }, [open, preview, store, chat.computerId, reference])
  return (
    <View style={{ marginVertical: 6, padding: space.m, gap: 6, borderRadius: 10, backgroundColor: c.fill }}>
      <T weight="600" numberOfLines={1}>
        {reference.title}
      </T>
      <T tone="muted" numberOfLines={2}>
        {translate(store.language, 'v{version} · replaced by v{latest}', {
          version: reference.version,
          latest: replacedBy.version,
        })}
        {replacedBy.changes ? ` · ${replacedBy.changes}` : ''}
      </T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button kind="secondary" title={t('Go to latest')} onPress={onLatest} />
        <Button
          kind="ghost"
          title={open ? t('Hide this version') : t('Show this version')}
          onPress={() => setOpen((value) => !value)}
        />
      </View>
      {open ? (
        <View style={{ gap: 8 }}>
          {preview ? (
            <Image source={{ uri: preview }} resizeMode="contain" style={{ height: 260, width: '100%' }} />
          ) : null}
          {error ? <T tone="muted">{error}</T> : null}
          {readOnly ? null : (
            <Button
              title={translate(store.language, 'Restore v{version}', { version: reference.version })}
              disabled={busy}
              onPress={() => {
                setBusy(true)
                void store
                  .invoke(chat.computerId, 'interactive.restore', reference.sessionId, reference.id, reference.version)
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false))
              }}
            />
          )}
        </View>
      ) : null}
    </View>
  )
}

export function InteractiveContent(props: {
  reference: InteractiveReference
  chat: Chat
  onAsk(text: string): void
  previous?: InteractiveReference
  update?: InteractiveUpdate
}) {
  return (
    <InteractiveContentBrowser
      key={`${props.chat.computerId}:${props.reference.sessionId}:${props.reference.id}:${props.reference.version}`}
      {...props}
    />
  )
}
