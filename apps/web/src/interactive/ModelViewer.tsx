import { useEffect, useId, useRef, useState } from 'react'
import type { InteractiveState, ModelViewerLabels } from '@ramu/shared/interactive'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { ContentFrame } from './ContentFrame'
import { useContentDocument } from './useContentDocument'
import { appThemeVariables } from './appTheme'

export const isModelFile = (file: { mimeType: string }) => file.mimeType.startsWith('model/')

export const modelViewerLabels = (): ModelViewerLabels => ({
  triangles: t('{0} triangles'),
  // glTF measures in meters.
  size: t('{0} m'),
  animation: t('Animation {0}'),
  still: t('No animation'),
  failed: t('This model could not be read.'),
})

export const isModelPath = (path: string) => /\.(glb|gltf)$/i.test(path)

/**
 * A `.glb` or `.gltf` file in the host's 3D viewer, on the same isolated origin as interactive documents. `source`
 * names the file so the viewer reloads only when it changes; `load` asks the host for the viewer with that file.
 */
export function ModelViewer({
  source,
  title,
  load,
}: {
  source: string
  title: string
  load: (labels: ModelViewerLabels) => Promise<string>
}) {
  useLanguage()
  const frame = useRef<HTMLIFrameElement>(null)
  const state = useRef<InteractiveState | null>(null)
  const instance = `model:${useId()}:${source}`
  const [html, setHtml] = useState<string>()
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [height, setHeight] = useState(460)
  useEffect(() => {
    let active = true
    setHtml(undefined)
    setError('')
    load(modelViewerLabels()).then(
      (value) => {
        if (active) setHtml(value)
      },
      (reason: unknown) => {
        if (active) setError(errorText(reason))
      },
    )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the file; a new load function each render must not refetch it
  }, [source])
  const { url, error: mountError } = useContentDocument(html, instance, !!html, state)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const message = event.data
      if (!message || message.ramuInteractive !== 1 || message.instance !== instance) return
      if (message.type === 'ready') {
        frame.current?.contentWindow?.postMessage(
          { ramuInteractive: 1, instance, type: 'theme', value: appThemeVariables() },
          '*',
        )
        setReady(true)
      }
      if (message.type === 'height' && Number.isFinite(message.value))
        setHeight(Math.max(120, Math.min(900, message.value)))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [instance])
  const problem = error || mountError
  if (problem)
    return (
      <p className="m-0 text-caption text-muted-foreground" role="alert">
        {t('Could not open the 3D viewer: {0}', { '0': problem })}
      </p>
    )
  return (
    <div className="relative w-full" style={{ height }}>
      {!ready && (
        <p className="m-0 text-caption text-muted-foreground" role="status">
          {t('Loading model…')}
        </p>
      )}
      {url && <ContentFrame ref={frame} url={url} title={title} ready={ready} onLoad={() => {}} />}
    </div>
  )
}
