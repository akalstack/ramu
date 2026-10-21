import { InteractiveFollowupPicker } from './InteractiveFollowupPicker'
import { shareInteractive } from './interactiveShare'
import { interactiveVersions, canCopyInteractiveState } from '@ramu/shared/interactiveVersions'
import { InteractiveVisibility } from './InteractiveVisibility'
import { translate } from '@ramu/shared/i18n'
import { useTheme } from '../theme'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Modal, ScrollView, TextInput, View } from 'react-native'
import type { InteractiveDocument, InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveFollowup, interactiveHtml, readInteractiveState } from '@ramu/shared/interactive'
import { interactiveStorage } from '@ramu/shared/interactiveStorage'
import { interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { claimInteractive } from '@ramu/shared/interactiveLease'
import { contentStorage } from '../storage'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { Button, T } from './ui'
import InteractiveFrame from './InteractiveFrame'
function InteractiveDocumentCard({
  reference,
  chat,
  onAsk,
  copyFrom,
}: {
  reference: InteractiveReference
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
  const [live, setLive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [height, setHeight] = useState(400)
  const instance = `${reference.id}:${reference.version}:${generation}`
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
  useEffect(() => (live ? claimInteractive(() => setLive(false)) : undefined), [live])
  useEffect(() => {
    if (!visible) setLive(false)
  }, [visible])
  const stop = useCallback(() => setLive(false), [])
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
      if (m.ramuInteractive !== 1 || m.instance !== instance) return
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
        setLive(false)
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
      setError(t('Could not capture the current scenario. Reopen and try again.'))
    }, 1500)
    pending.current = { id, run, timer }
    setSnapshot(id)
  }
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer)
    },
    [instance],
  )
  const open = () => {
    setError('')
    setGeneration((n) => n + 1)
    setLive(true)
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
  return (
    <View style={{ marginVertical: 12, gap: 8 }}>
      <T weight="600">
        {reference.title} · v{reference.version}
      </T>
      <T tone="muted">{reference.checked ? t('Controls checked') : t('Rendering checked')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          title={live ? t('Pause') : t('Open interactive')}
          onPress={() => (live ? capture(() => setLive(false)) : open())}
          disabled={!document}
        />
        <Button
          title={t('Expand')}
          disabled={!document}
          onPress={() => {
            capture(() => {
              setExpanded(true)
              open()
            })
          }}
        />
        <Button
          title={t('Reset')}
          onPress={() => {
            state.current = null
            cache.saveState(reference.id, reference.version, null)
            setGeneration((n) => n + 1)
            setError('')
          }}
        />
        <Button
          title={t('Ask about this')}
          onPress={() => capture(() => onAsk(interactiveFollowup(reference, state.current)))}
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
            } else setError(t('Open the content before choosing values.'))
          })
        }
      />
      {selection && (
        <InteractiveFollowupPicker
          key={selectionId}
          reference={reference}
          state={selection}
          onStage={onAsk}
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
                setError(t('Open and pause the source version before copying its saved scenario.'))
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
                setError(t('Open the content first. Save up to six scenarios per version and 20 per host.'))
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
      {error ? (
        <T tone="muted">
          {error}
          {document ? t(' Saved content is available.') : ''}
        </T>
      ) : null}
      {!live && document?.preview ? (
        <Image source={{ uri: document.preview }} resizeMode="contain" style={{ height: 260, width: '100%' }} />
      ) : null}
      {!expanded && frame}
      <T tone="muted">{reference.summary}</T>
      <Modal
        visible={expanded}
        onRequestClose={() => {
          capture(() => {
            setExpanded(false)
            setGeneration((n) => n + 1)
          })
        }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 12 }}>
          <Button
            title={t('Close')}
            onPress={() => {
              capture(() => {
                setExpanded(false)
                setGeneration((n) => n + 1)
              })
            }}
          />
          {expanded && frame}
        </ScrollView>
      </Modal>
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
      />
      <Button title={t('Versions')} onPress={() => void browse()} />
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
