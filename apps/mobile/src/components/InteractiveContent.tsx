import { InteractiveFollowupPicker } from './InteractiveFollowupPicker'
import { shareInteractive } from './interactiveShare'
import { interactiveVersions, canCopyInteractiveState } from '@ramu/shared/interactiveVersions'
import { InteractiveVisibility } from './InteractiveVisibility'
import { translate } from '@ramu/shared/i18n'
import { useTheme } from '../theme'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Image, ScrollView, TextInput, View } from 'react-native'
import { Expand, MoreHorizontal } from 'lucide-react-native'
import type { InteractiveDocument, InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveFollowup, interactiveHtml, readInteractiveState } from '@ramu/shared/interactive'
import { interactiveStorage } from '@ramu/shared/interactiveStorage'
import { interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { claimInteractive } from '@ramu/shared/interactiveLease'
import { contentStorage } from '../storage'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { Button, IconButton, Sheet, T } from './ui'
import InteractiveFrame from './InteractiveFrame'
export function InteractiveDocumentCard({
  reference,
  chat,
  onAsk,
  copyFrom,
  onVersions,
}: {
  reference: InteractiveReference
  onVersions?(): void
  copyFrom?: InteractiveReference
  chat: Chat
  onAsk(text: string): void
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
        background: c.canvas,
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
  const live = !!document && visible && foreground && !failed && !evicted && mode === 'preview'
  const [expanded, setExpanded] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [height, setHeight] = useState(400)
  // A resumed native WebView must receive the latest declared state, not the first mount's HTML.
  const activeView = visible && foreground
  const lifecycle = useRef({ active: activeView, revision: 0 })
  if (activeView !== lifecycle.current.active) {
    lifecycle.current.active = activeView
    lifecycle.current.revision++
  }
  const instance = `${reference.id}:${reference.version}:${generation}:${lifecycle.current.revision}`
  const currentInstance = useRef(instance)
  currentInstance.current = instance
  const html = useMemo(
    () => (document ? interactiveHtml(document.html, instance, state.current) : ''),
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
    const sub = AppState.addEventListener('change', (value) => setForeground(value === 'active'))
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
  const share = (raw = false) => {
    const run = () => {
      if (!document || sharing) return
      setSharing(true)
      void shareInteractive(document, state.current, raw, theme)
        .catch(() => setError(t('Could not share this content. Try again.')))
        .finally(() => setSharing(false))
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
      {mode === 'preview' && !live && document?.preview ? (
        <Image source={{ uri: document.preview }} resizeMode="contain" style={{ height: 260, width: '100%' }} />
      ) : null}
      {!expanded && content}
      <Sheet open={actionsOpen} onClose={() => setActionsOpen(false)} title={t('Content actions')}>
        <T tone="muted">{reference.checked ? t('Controls checked') : t('Rendering checked')}</T>
        <T tone="muted">{reference.summary}</T>
        {onVersions && (
          <Button
            title={t('Versions')}
            onPress={() => {
              setActionsOpen(false)
              onVersions()
            }}
          />
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button
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
          <Button
            title={t('Ask about this')}
            onPress={() =>
              capture(() => {
                setActionsOpen(false)
                onAsk(interactiveFollowup(reference, state.current))
              })
            }
          />
        </View>
        <Button
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
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button title={t('Share HTML')} disabled={!document || sharing} onPress={() => share()} />
          <Button title={t('Share source')} disabled={!document || sharing} onPress={() => share(true)} />
        </View>
        {copyFrom && canCopyInteractiveState(copyFrom, reference) && (
          <Button
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
        <T weight="600">{t('Saved scenarios')}</T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            accessibilityLabel={t('Scenario name')}
            placeholder={t('Scenario name')}
            placeholderTextColor={c.muted}
            value={scenarioName}
            maxLength={80}
            onChangeText={setScenarioName}
            style={{ flex: 1, padding: 8, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 8, color: c.text }}
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
          <View key={scenario.name} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <T style={{ flex: 1 }}>{scenario.name}</T>
            <Button
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
              title={t('Delete')}
              onPress={() => {
                if (cache.removeScenario(reference.id, reference.version, scenario.name))
                  setScenarioRevision((n) => n + 1)
                else setError(t('Could not save local changes. Storage may be full.'))
              }}
            />
          </View>
        ))}
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
}: {
  reference: InteractiveReference
  chat: Chat
  onAsk(text: string): void
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

export function InteractiveContent(props: { reference: InteractiveReference; chat: Chat; onAsk(text: string): void }) {
  return (
    <InteractiveContentBrowser
      key={`${props.chat.computerId}:${props.reference.sessionId}:${props.reference.id}:${props.reference.version}`}
      {...props}
    />
  )
}
