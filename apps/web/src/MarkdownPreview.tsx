import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import Markdown from 'react-markdown'
import { invoke } from './ipc'
import {
  previewImagePath,
  previewRehypePlugins,
  previewRemarkPlugins,
  previewRemarkRehypeOptions,
  previewUrlTransform,
} from '@ramu/shared/markdownRendering'

type Context = { taskId: string; repoId: string; path: string }

function useImageUrl(url: string | undefined, context: Context) {
  const path = url ? previewImagePath(context.path, url) : null
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  const key = `${context.taskId}:${context.repoId}:${path}`
  useEffect(() => {
    if (!path) return
    let current = true
    void invoke('files.image', context.taskId, context.repoId, path).then(
      (url) => {
        if (current) setLoaded({ key, url })
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [key, path, context.taskId, context.repoId])
  return path ? (loaded?.key === key ? loaded.url : undefined) : url
}

function PreviewImage({ context, src, srcSet, ...props }: ComponentProps<'img'> & { context: Context }) {
  const resolved = useImageUrl(src, context)
  const resolvedSet = useImageSet(srcSet, context)
  return <img {...props} src={resolved} srcSet={resolvedSet} />
}

function useImageSet(srcSet: string | undefined, context: Context) {
  // Resolve each picture candidate independently, retaining density/width descriptors.
  const [resolved, setResolved] = useState<{ input: string; value: string } | null>(null)
  const input = `${context.taskId}:${context.repoId}:${context.path}:${srcSet}`
  useEffect(() => {
    let current = true
    void Promise.all(
      (srcSet ?? '').split(',').map(async (candidate) => {
        const [url, ...descriptor] = candidate.trim().split(/\s+/)
        const safe = previewUrlTransform(url ?? '')
        if (!safe) return ''
        const path = previewImagePath(context.path, safe)
        const resolved = path ? await invoke('files.image', context.taskId, context.repoId, path).catch(() => '') : safe
        return resolved ? [resolved, ...descriptor].join(' ') : ''
      }),
    ).then((urls) => {
      if (current) setResolved({ input, value: urls.filter(Boolean).join(', ') })
    })
    return () => {
      current = false
    }
  }, [input, srcSet, context.taskId, context.repoId, context.path])
  return resolved?.input === input ? resolved.value : undefined
}

function PreviewSource({ context, srcSet, ...props }: ComponentProps<'source'> & { context: Context }) {
  const resolved = useImageSet(srcSet, context)
  return <source {...props} srcSet={resolved} />
}

export function MarkdownPreview({
  text,
  taskId,
  repoId,
  path,
  onOpenFile,
}: Context & { text: string; onOpenFile: (path: string) => void }) {
  const components = useMemo<ComponentProps<typeof Markdown>['components']>(() => {
    const context = { taskId, repoId, path }
    return {
      img: ({ node, ...props }) => <PreviewImage {...props} context={context} />,
      source: ({ node, ...props }) => <PreviewSource {...props} context={context} />,
      a: ({ href, children }) => (
        <a
          href={href}
          target={href?.startsWith('#') ? undefined : '_blank'}
          rel="noreferrer"
          onClick={(event) => {
            if (!href) {
              event.preventDefault()
              return
            }
            const local = previewImagePath(path, href)
            if (local) {
              event.preventDefault()
              onOpenFile(local)
            }
          }}
        >
          {children}
        </a>
      ),
    }
  }, [taskId, repoId, path, onOpenFile])
  return (
    <Markdown
      remarkPlugins={previewRemarkPlugins}
      rehypePlugins={previewRehypePlugins}
      remarkRehypeOptions={previewRemarkRehypeOptions}
      urlTransform={previewUrlTransform}
      components={components}
    >
      {text}
    </Markdown>
  )
}
