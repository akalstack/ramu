import { interactiveThemeSample } from './interactiveThemeSample'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ThemeVariant } from '@ramu/shared/theme'
import { readInteractiveState, type InteractiveState } from '@ramu/shared/interactive'
import { interactivePaletteFromVariant, interactiveThemeVariables } from '@ramu/shared/interactiveTheme'
import { claimInteractive } from '@ramu/shared/interactiveLease'
import type { ResolvedAppearance } from '../appearance'
import { ContentFrame } from '../interactive/ContentFrame'
import { useContentDocument } from '../interactive/useContentDocument'
import { useNearViewport } from '../lib/useNearViewport'
import { Button } from '../components/desktop-button'
import { t, useLanguage } from '../i18n'

/** Uses the transcript's native isolated origin and palette messages; color edits preserve local controls. */
export function InteractiveThemePreview({
  variant,
  appearance,
}: {
  variant: ThemeVariant
  appearance: ResolvedAppearance
}) {
  const language = useLanguage()
  const sample = useMemo(interactiveThemeSample, [language])
  const root = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null)
  const state = useRef<InteractiveState | null>(null)
  const near = useNearViewport(root, true, false)
  const [evicted, setEvicted] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [readyUrl, setReadyUrl] = useState('')
  const [foreground, setForeground] = useState(() => !document.hidden)
  const instance = `theme-preview:${useId()}:${generation}`
  const active = near && foreground && !evicted
  const { url, error } = useContentDocument(sample, instance, active, state)
  const activeUrl = useRef(url)
  activeUrl.current = url
  const theme = useMemo(
    () => interactiveThemeVariables(interactivePaletteFromVariant(variant, appearance)),
    [variant, appearance],
  )
  const latestTheme = useRef(theme)
  latestTheme.current = theme
  useEffect(() => {
    const update = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => (active ? claimInteractive(() => setEvicted(true), 3) : undefined), [active])
  useEffect(() => {
    if (near) setEvicted(false)
  }, [near])
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'theme', value: theme }, '*')
  }, [theme, instance, readyUrl])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!activeUrl.current || event.source !== frame.current?.contentWindow) return
      const message = event.data
      if (!message || message.ramuInteractive !== 1 || message.instance !== instance) return
      if (message.type === 'ready') {
        frame.current?.contentWindow?.postMessage(
          { ramuInteractive: 1, instance, type: 'theme', value: latestTheme.current },
          '*',
        )
        setReadyUrl(activeUrl.current)
      }
      if (message.type === 'state') {
        const next = readInteractiveState(message.value)
        if (next) state.current = next
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [instance])
  return (
    <div
      ref={root}
      role="region"
      aria-label={t('Interactive theme preview')}
      className="relative h-64 overflow-hidden rounded-(--radius-s) bg-canvas"
    >
      {url && (
        <ContentFrame
          ref={frame}
          url={url}
          title={t('Interactive theme preview')}
          ready={readyUrl === url}
          onLoad={() => {}}
        />
      )}
      {error && <p role="status">{error}</p>}
      {(evicted || error) && (
        <Button
          onClick={() => {
            setEvicted(false)
            setGeneration((n) => n + 1)
          }}
        >
          {t('Run again')}
        </Button>
      )}
    </div>
  )
}
