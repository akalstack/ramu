import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ThemeVariant } from '@ramu/shared/theme'
import { THEME_EDITOR_PREVIEW_URL, parseThemeEditorUpdate } from '@ramu/shared/themePreview'
import type { ResolvedAppearance } from '../appearance'
import { Button } from '../components/desktop-button'
import { DiffLayoutToggle } from '../git/diffLayout'
import { useNearViewport } from '../lib/useNearViewport'
import { t } from '../i18n'

/** A separate app-owned origin keeps Monaco's global theme and token registry away from workspace editors. */
export function EditorThemePreview({ variant, appearance }: { variant: ThemeVariant; appearance: ResolvedAppearance }) {
  const root = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null)
  const near = useNearViewport(root, true, false)
  const id = useId()
  const [generation, setGeneration] = useState(0)
  const instance = `${id}:${generation}`
  const [view, setView] = useState<'code' | 'diff'>('code')
  const [split, setSplit] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [foreground, setForeground] = useState(() => !document.hidden)
  const active = near && foreground
  const sequence = useRef(0)
  const current = useRef({ variant, appearance, view, split })
  current.current = { variant, appearance, view, split }
  const send = useCallback(() => {
    if (!frame.current?.contentWindow) return
    const update = parseThemeEditorUpdate({
      ramuThemePreview: 1,
      type: 'update',
      instance,
      request: ++sequence.current,
      ...current.current,
    })
    if (!update) {
      setError(t('Complete each color before previewing.'))
      return
    }
    setError('')
    frame.current.contentWindow.postMessage(update, '*')
  }, [instance])
  useEffect(() => {
    send()
  }, [variant, appearance, view, split, send])
  useEffect(() => {
    const update = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    setReady(false)
  }, [active, instance])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return
      const m = event.data
      if (!m || m.ramuThemePreview !== 1 || m.instance !== instance) return
      if (m.type === 'ready') send()
      if (m.request !== sequence.current) return
      if (m.type === 'applied') {
        setReady(true)
        setError('')
      }
      if (m.type === 'error') setError(t('Could not preview code. Try again.'))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [instance, send])
  return (
    <div ref={root} className="flex min-w-0 flex-col gap-2">
      <div role="group" aria-label={t('Code and diff preview')} className="flex items-center gap-1">
        <Button size="xs" aria-pressed={view === 'code'} onClick={() => setView('code')}>
          {t('Code')}
        </Button>
        <Button size="xs" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>
          {t('Diff')}
        </Button>
        {view === 'diff' && <DiffLayoutToggle split={split} onChange={setSplit} />}
      </div>
      <div className="relative h-56 overflow-hidden rounded-(--radius-s) bg-canvas">
        {active && (
          <iframe
            ref={frame}
            key={instance}
            src={`${THEME_EDITOR_PREVIEW_URL}#${encodeURIComponent(instance)}`}
            title={t('Code and diff preview')}
            sandbox="allow-scripts allow-same-origin"
            onLoad={send}
            className="absolute inset-0 size-full border-0"
            style={{ opacity: ready ? 1 : 0 }}
          />
        )}
        {active && !ready && !error && (
          <p role="status" className="m-0 p-2 text-muted-foreground">
            {t('Loading previews…')}
          </p>
        )}
      </div>
      {error && (
        <p role="status" className="m-0 text-muted-foreground">
          {error}
        </p>
      )}
      {error && (
        <Button
          size="xs"
          onClick={() => {
            setError('')
            setGeneration((n) => n + 1)
          }}
        >
          {t('Run again')}
        </Button>
      )}
    </div>
  )
}
