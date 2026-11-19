import { useEffect, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { useHost } from '../workspace/HostProvider'
import { t, useLanguage } from '../i18n'

const REMOTE = /^(https?:|data:image\/|blob:)/i

/**
 * What an image in agent output can be drawn from: a web or inline address as is, a workspace path fetched from the
 * host, since the page cannot read the host's files itself. `undefined` while it loads, `null` when it cannot load.
 */
export function useChatImage(source: string | undefined, taskId?: string): string | null | undefined {
  const { invoke } = useHost()
  const [resolved, setResolved] = useState<{ source?: string; src: string | null } | null>(null)
  const direct = !source || REMOTE.test(source)
  useEffect(() => {
    if (direct) return
    let active = true
    if (!taskId) {
      setResolved({ source, src: null })
      return
    }
    void invoke('files.resolveLink', taskId, source!)
      .then((file) => (file ? invoke('files.image', taskId, file.repoId, file.path) : null))
      .then(
        (image) => active && setResolved({ source, src: image || null }),
        () => active && setResolved({ source, src: null }),
      )
    return () => {
      active = false
    }
  }, [direct, source, taskId, invoke])
  if (!source) return null
  if (direct) return source
  return resolved?.source === source ? resolved.src : undefined
}

/**
 * An image in agent output that opens larger when clicked, at its own size up to the window, so a screenshot or a
 * diagram can be read without saving it first.
 */
export function ChatImage({
  src,
  alt,
  className = 'block max-w-full max-h-80 object-contain rounded-(--radius-s) bg-fill',
  onError,
}: {
  src: string
  alt?: string
  className?: string
  onError?: () => void
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const label = alt || t('Image')
  return (
    <>
      <Button
        variant="ghost"
        className="h-auto max-w-full cursor-zoom-in rounded-(--radius-s) border-0 p-0 hover:bg-transparent"
        aria-label={t('Open {0} larger', { '0': label })}
        title={t('Open larger')}
        onClick={() => setOpen(true)}
      >
        <img src={src} alt={label} className={className} onError={onError} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[min(94vw,_1400px)] sm:max-w-[none]! max-h-[92vh] gap-0 overflow-hidden p-0 [background:var(--raised)]"
          showCloseButton
          aria-describedby={undefined}
        >
          <DialogTitle className="m-0 truncate p-[12px_52px_12px_16px] text-control font-medium [border-bottom:1px_solid_var(--line)]">
            {label}
          </DialogTitle>
          <div className="flex max-h-[calc(92vh_-_48px)] items-center justify-center overflow-auto p-4">
            <img src={src} alt={label} className="max-h-[calc(92vh_-_80px)] max-w-full object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A Markdown image in a reply: the workspace file it names is fetched from the host, and it opens larger on click. */
export function ChatMarkdownImage({ src, alt, taskId }: { src?: string; alt?: string; taskId?: string }) {
  useLanguage()
  const resolved = useChatImage(src, taskId)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [resolved])
  if (resolved === undefined) return <span className="text-caption text-muted-foreground">{alt || src}</span>
  if (!resolved || failed)
    return (
      <span className="inline-flex items-center gap-2 rounded-(--radius-s) bg-fill p-2 text-caption text-muted-foreground">
        <ImageIcon size={14} />
        {alt || t('Image preview unavailable')}
      </span>
    )
  return <ChatImage src={resolved} alt={alt} onError={() => setFailed(true)} />
}
