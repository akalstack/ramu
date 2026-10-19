import { InteractiveFollowupPicker } from './InteractiveFollowupPicker'
import { interactiveExport } from '@ramu/shared/interactiveExport'
import { Input } from '../components/desktop-input'
import { interactiveVersions, canCopyInteractiveState } from '@ramu/shared/interactiveVersions'
import { ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { claimInteractive } from '@ramu/shared/interactiveLease'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InteractiveDocument, InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveHtml, interactiveFollowup, readInteractiveState } from '@ramu/shared/interactive'
import { interactiveStorage } from '@ramu/shared/interactiveStorage'
import { useHost } from '../workspace/HostProvider'
import { hostStorageFor } from '../hostStorage'
import { Button } from '../components/desktop-button'

/** A document is never inserted in the application DOM and never receives a privileged bridge. */
function InteractiveDocumentCard({
  reference,
  copyFrom,
}: {
  reference: InteractiveReference
  copyFrom?: InteractiveReference
}) {
  useLanguage()
  const host = useHost()
  const { invoke } = host
  const cache = useMemo(() => interactiveStorage(hostStorageFor(host.id), 'content'), [host.id])
  const [document, setDocument] = useState<InteractiveDocument | null>(() =>
    cache.document(reference.id, reference.version),
  )
  const [selectionId, setSelectionId] = useState(0)
  const [selection, setSelection] = useState<InteractiveState | null>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [, setScenarioRevision] = useState(0)
  const scenarios = cache.scenarios(reference.id, reference.version)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [live, setLive] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [height, setHeight] = useState(400)
  const pending = useRef<{ id: string; run: () => void; timer: ReturnType<typeof setTimeout> } | null>(null)
  const requestSequence = useRef(0)
  const loaded = useRef('')
  const frame = useRef<HTMLIFrameElement>(null)
  const root = useRef<HTMLElement>(null)
  const state = useRef(cache.state(reference.id, reference.version))
  const instance = `${reference.id}:${reference.version}:${generation}`
  const source = useMemo(
    () => (document ? interactiveHtml(document.html, instance, state.current) : ''),
    [document, instance],
  )
  useEffect(() => {
    if (!live || !source) return
    let cancelled = false,
      mounted = ''
    setUrl('')
    void ramu
      .invoke('app.content.mount', source)
      .then((value) => {
        mounted = value
        if (cancelled) void ramu.invoke('app.content.release', value)
        else setUrl(value)
      })
      .catch((error) => {
        if (!cancelled) {
          setError(String(error))
          setLive(false)
        }
      })
    return () => {
      cancelled = true
      if (mounted) void ramu.invoke('app.content.release', mounted)
    }
  }, [live, source])
  useEffect(() => {
    let cancelled = false
    void invoke('interactive.get', reference.sessionId, reference.id, reference.version)
      .then((value) => {
        if (cancelled) return
        cache.saveDocument(value)
        setDocument(value)
        setError('')
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [invoke, cache, reference, host.status])
  useEffect(() => {
    const sendTheme = () => {
      const style = getComputedStyle(window.document.documentElement)
      frame.current?.contentWindow?.postMessage(
        {
          ramuInteractive: 1,
          instance,
          type: 'theme',
          value: {
            '--scheme': style.colorScheme === 'light' ? 'light' : 'dark',
            '--background': style.getPropertyValue('--canvas').trim() || '#131315',
            '--foreground': style.getPropertyValue('--text').trim() || '#eeeef0',
            '--primary': style.getPropertyValue('--accent').trim() || '#a78bfa',
            '--muted': style.getPropertyValue('--muted').trim() || '#a1a1aa',
          },
        },
        '*',
      )
    }
    const observer = new MutationObserver(sendTheme)
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const m = event.data
      if (!m || m.ramuInteractive !== 1 || m.instance !== instance) return
      if (m.type === 'ready') sendTheme()
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
      if (m.type === 'height' && Number.isFinite(m.value)) setHeight(Math.max(120, Math.min(2000, m.value)))
      if (m.type === 'error') {
        setError(t('An interaction failed. Reset or ask the agent to revise this version.'))
        setLive(false)
      }
    }
    window.addEventListener('message', receive)
    return () => {
      observer.disconnect()
      window.removeEventListener('message', receive)
    }
  }, [instance, cache, reference])
  useEffect(() => {
    if (!live || !root.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'active', value: false }, '*')
      timer = setTimeout(() => setLive(false), 150)
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) stop()
        else clearTimeout(timer)
      },
      { rootMargin: '500px' },
    )
    observer.observe(root.current)
    const visibility = () => {
      if (window.document.hidden) stop()
    }
    window.document.addEventListener('visibilitychange', visibility)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
      window.document.removeEventListener('visibilitychange', visibility)
    }
  }, [live, instance])
  useEffect(() => (live ? claimInteractive(() => setLive(false)) : undefined), [live])
  const open = () => {
    setError('')
    setGeneration((n) => n + 1)
    setLive(true)
  }
  const capture = (run: () => void) => {
    if (!live) {
      run()
      return
    }
    if (pending.current) clearTimeout(pending.current.timer)
    const id = `${instance}:${++requestSequence.current}`
    const timer = setTimeout(() => {
      pending.current = null
      setError(t('Could not capture the current scenario. Reopen the saved version and try again.'))
    }, 1500)
    pending.current = { id, run, timer }
    frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'snapshot', requestId: id }, '*')
  }
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer)
    },
    [instance],
  )
  const download = (raw = false) => {
    const run = () => {
      if (!document) return
      const exported = interactiveExport(document, state.current, raw)
      const url = URL.createObjectURL(new Blob([exported.html], { type: exported.mimeType }))
      const link = window.document.createElement('a')
      link.href = url
      link.download = exported.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    if (raw) run()
    else capture(run)
  }
  const pause = () => capture(() => setLive(false))
  const stage = (text: string) =>
    window.dispatchEvent(
      new CustomEvent('ramu:interactive-followup', {
        detail: { host: host.id, session: reference.sessionId, text },
      }),
    )
  const ask = () => capture(() => stage(interactiveFollowup(reference, state.current)))
  return (
    <section ref={root} className="my-3 overflow-hidden rounded-xl border border-border" aria-label={reference.title}>
      <div className="flex flex-wrap items-center gap-2 bg-fill p-3">
        <strong className="mr-auto">{reference.title}</strong>
        <span className="text-muted-foreground text-xs">
          v{reference.version} · {reference.checked ? t('Controls checked') : t('Rendering checked')}
        </span>
        <Button onClick={() => (live ? pause() : open())} disabled={!document}>
          {live ? t('Pause') : t('Open interactive')}
        </Button>
        <Button
          disabled={!live}
          onClick={() => void frame.current?.requestFullscreen().catch(() => setError(t('Fullscreen unavailable.')))}
        >
          {t('Expand')}
        </Button>
        <Button
          onClick={() => {
            state.current = null
            cache.saveState(reference.id, reference.version, null)
            setGeneration((n) => n + 1)
            setError('')
          }}
        >
          {t('Reset')}
        </Button>
        <Button onClick={ask}>{t('Ask about this')}</Button>
        <Button
          disabled={!document}
          onClick={() =>
            capture(() => {
              if (state.current) {
                setSelection(state.current)
                setSelectionId((n) => n + 1)
              } else setError(t('Open the content before choosing values.'))
            })
          }
        >
          {t('Choose values')}
        </Button>
        <Button disabled={!document} onClick={() => download()}>
          {t('Export HTML')}
        </Button>
        <Button disabled={!document} onClick={() => download(true)}>
          {t('Export source')}
        </Button>
      </div>
      {selection && (
        <InteractiveFollowupPicker
          key={selectionId}
          reference={reference}
          state={selection}
          onStage={stage}
          onClose={() => setSelection(null)}
        />
      )}
      {copyFrom && canCopyInteractiveState(copyFrom, reference) && (
        <Button
          onClick={() =>
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
        >
          {t('Copy saved scenario from v{version}', { version: copyFrom.version })}
        </Button>
      )}
      <details className="border-t border-border p-3">
        <summary className="cursor-pointer">{t('Saved scenarios')}</summary>
        <div className="mt-2 flex items-center gap-2">
          <Input
            aria-label={t('Scenario name')}
            placeholder={t('Scenario name')}
            value={scenarioName}
            maxLength={80}
            onChange={(e) => setScenarioName(e.target.value)}
          />
          <Button
            disabled={!scenarioName.trim() || !document}
            onClick={() =>
              capture(() => {
                if (!cache.saveScenario(reference.id, reference.version, scenarioName, state.current)) {
                  setError(t('Open the content first. Save up to six scenarios per version and 20 per host.'))
                  return
                }
                setScenarioName('')
                setScenarioRevision((n) => n + 1)
              })
            }
          >
            {t('Save scenario')}
          </Button>
        </div>
        {scenarios.map((scenario) => (
          <div key={scenario.name} className="mt-2 flex items-center gap-2">
            <span className="mr-auto">{scenario.name}</span>
            <Button
              onClick={() =>
                capture(() => {
                  state.current = scenario.state
                  cache.saveState(reference.id, reference.version, scenario.state)
                  setGeneration((n) => n + 1)
                })
              }
            >
              {t('Restore')}
            </Button>
            <Button
              aria-label={t('Delete scenario {name}', { name: scenario.name })}
              onClick={() => {
                if (cache.removeScenario(reference.id, reference.version, scenario.name))
                  setScenarioRevision((n) => n + 1)
                else setError(t('Could not save local changes. Storage may be full.'))
              }}
            >
              {t('Delete')}
            </Button>
          </div>
        ))}
      </details>
      {error && (
        <p role="status" className="p-3 text-muted-foreground">
          {error}
          {document ? t(' Saved content is available on this device.') : ''}
        </p>
      )}
      {live && document ? (
        <iframe
          ref={frame}
          key={url}
          title={reference.title}
          onLoad={() => {
            if (!url) return
            if (loaded.current === url) {
              setError(t('Document navigation is unavailable. Reopen the saved version.'))
              setLive(false)
            }
            loaded.current = url
          }}
          sandbox="allow-scripts"
          allow="fullscreen"
          src={url || undefined}
          style={{ height, width: '100%', border: 0 }}
        />
      ) : (
        <button
          className="block w-full text-left"
          onClick={open}
          disabled={!document}
          aria-label={t('Open {title}', { title: reference.title })}
        >
          {document?.preview && (
            <img
              src={document.preview}
              alt={t('Preview of {title}', { title: reference.title })}
              className="max-h-80 w-full object-contain"
            />
          )}
          <p className="p-3 text-muted-foreground">
            {reference.summary}
            {!document && !error ? t(' · Loading…') : ''}
          </p>
        </button>
      )}
    </section>
  )
}

/** Another version opens in a separate viewer; the historical card is never rewritten. */
function InteractiveContentBrowser({ reference }: { reference: InteractiveReference }) {
  useLanguage()
  const { id: hostId, invoke } = useHost()
  const [versions, setVersions] = useState<InteractiveReference[] | null>(null)
  const [selected, setSelected] = useState<InteractiveReference | null>(null)
  const [error, setError] = useState('')
  const browse = async () => {
    try {
      setVersions(interactiveVersions(reference, await invoke('interactive.list', reference.sessionId)))
      setError('')
    } catch {
      setVersions(interactiveVersions(reference, interactiveStorage(hostStorageFor(hostId), 'content').references()))
      setError(t('Host unavailable. Showing cached versions.'))
    }
  }
  return (
    <div>
      <InteractiveDocumentCard key={`${reference.id}:${reference.version}`} reference={reference} />
      <Button onClick={() => void browse()}>{t('Versions')}</Button>
      {versions && (
        <section aria-label={t('Content versions')} className="mt-2 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            {versions.map((version) => (
              <Button
                key={version.version}
                aria-pressed={selected?.version === version.version}
                onClick={() => setSelected(version)}
              >
                v{version.version}
                {version.version === reference.version ? ` · ${t('This turn')}` : ''}
              </Button>
            ))}
            <Button
              onClick={() => {
                setVersions(null)
                setSelected(null)
              }}
            >
              {t('Close')}
            </Button>
          </div>
          {error && <p role="status">{error}</p>}
          {selected && selected.version !== reference.version && (
            <InteractiveDocumentCard
              key={`${selected.id}:${selected.version}`}
              reference={selected}
              copyFrom={reference}
            />
          )}
        </section>
      )}
    </div>
  )
}

export function InteractiveContent({ reference }: { reference: InteractiveReference }) {
  const { id } = useHost()
  return (
    <InteractiveContentBrowser
      key={`${id}:${reference.sessionId}:${reference.id}:${reference.version}`}
      reference={reference}
    />
  )
}
