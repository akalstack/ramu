import { useEffect, useState } from 'react'
import { Button } from '@/components/desktop-button'
import type { RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { errorText } from '../workspace/TaskPane'
import { isModelPath, ModelViewer } from '../interactive/ModelViewer'

const MEDIA = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|pdf|mp3|wav|ogg|m4a|flac|mp4|webm|mov|glb|gltf)$/i
export const isMedia = (path: string) => MEDIA.test(path)
export const isSvg = (path: string) => /\.svg$/i.test(path)

type Media = { mimeType: string; size: number; url: string }
const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`

/** Read-only preview of non-text files opened from the explorer; it reloads when the file changes on disk. */
export function MediaFileView({
  taskId,
  view,
  binding,
  onViewSource,
}: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'file' }>
  binding: RepositoryBinding
  /** Offered for SVG, which opens as an image but stays editable as text. */
  onViewSource?: () => void
}) {
  useLanguage()
  if (isModelPath(view.path)) return <ModelFileView taskId={taskId} view={view} binding={binding} />
  return <MediaPreview taskId={taskId} view={view} binding={binding} onViewSource={onViewSource} />
}

/** A model in the project, reloaded when it changes on disk. */
function ModelFileView({
  taskId,
  view,
  binding,
}: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'file' }>
  binding: RepositoryBinding
}) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      on('fs:changed', ({ cwd, path }) => {
        if (cwd === binding.cwd && path === view.path) setRevision((value) => value + 1)
      }),
    [on, binding.cwd, view.path],
  )
  const name = view.path.split('/').at(-1) ?? view.path
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-auto p-3">
      <ModelViewer
        source={`${binding.cwd}/${view.path}#${revision}`}
        title={name}
        load={(labels) => invoke('files.modelViewer', taskId, binding.repoId, view.path, labels)}
      />
    </div>
  )
}

function MediaPreview({
  taskId,
  view,
  binding,
  onViewSource,
}: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'file' }>
  binding: RepositoryBinding
  onViewSource?: () => void
}) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [media, setMedia] = useState<Media | null>(null),
    [error, setError] = useState<string | null>(null),
    [dimensions, setDimensions] = useState('')
  useEffect(() => {
    let active = true,
      request = 0
    const load = () => {
      const current = ++request
      invoke('files.media', taskId, binding.repoId, view.path).then(
        (value) => {
          if (active && current === request) {
            setMedia(value)
            setError(null)
          }
        },
        (e) => {
          if (active && current === request) setError(errorText(e))
        },
      )
    }
    setMedia(null)
    setError(null)
    setDimensions('')
    load()
    const off = on('fs:changed', ({ cwd, path }) => {
      if (cwd === binding.cwd && path === view.path) load()
    })
    return () => {
      active = false
      off()
    }
  }, [taskId, binding.repoId, binding.cwd, view.path, invoke, on])
  const name = view.path.split('/').at(-1) ?? view.path
  if (error)
    return (
      <p className="m-4 text-bad" role="alert">
        {error}
      </p>
    )
  if (!media) return null
  const kind = media.mimeType.split('/')[0]
  return (
    <div className="media-view flex flex-col h-full min-h-0 min-w-0">
      <div className="flex items-center gap-2 p-[6px_12px] text-caption text-muted-foreground [border-bottom:1px_solid_var(--line)]">
        <span className="truncate">{name}</span>
        <span className="tabular-nums">
          {[media.mimeType, size(media.size), dimensions].filter(Boolean).join(' · ')}
        </span>
        {onViewSource && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onViewSource}>
            {t('View source')}
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto grid place-items-center p-3 bg-canvas">
        {kind === 'image' ? (
          <img
            src={media.url}
            alt={name}
            className="max-w-full max-h-full object-contain [image-rendering:auto] bg-[repeating-conic-gradient(var(--fill)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
            onLoad={(event) =>
              setDimensions(`${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`)
            }
            onError={() => setError(t('This image could not be displayed.'))}
          />
        ) : kind === 'video' ? (
          <video controls src={media.url} className="max-w-full max-h-full" aria-label={name} />
        ) : kind === 'audio' ? (
          <audio controls src={media.url} className="w-full max-w-xl" aria-label={name} />
        ) : (
          <iframe src={media.url} title={name} className="w-full h-full border-0 bg-white" />
        )}
      </div>
    </div>
  )
}
