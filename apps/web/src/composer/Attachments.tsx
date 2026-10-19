import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { cn } from 'cn'
import {
  Attachment as AttachmentCard,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  File,
  FolderOpen,
  Maximize2,
  Minimize2,
  RotateCw,
  Scan,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react'
import type { Attachment } from '@ramu/shared/types'
// Menus, copy, save and reveal run on this machine's attachment store (main process); previews come from the host.
import { invoke } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { notifyError } from '../chat/Notifications'

const isImage = (file: Attachment) => file.mimeType.startsWith('image/')
const kb = (file: Attachment) => `${Math.max(1, Math.ceil(file.size / 1024))} KB`

async function attachmentMenu(
  file: Attachment,
  event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  removable: boolean,
  isLocal: boolean,
) {
  event.preventDefault()
  event.stopPropagation()
  if (!isLocal) return null
  const rect = event.currentTarget.getBoundingClientRect()
  const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: rect.left + 12, y: rect.bottom }
  return invoke('attachments.menu', file.id, removable, point)
}

function AttachmentPreview({
  files,
  index,
  onIndexChange,
  onClose,
  opener,
}: {
  files: Attachment[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  opener: HTMLElement | null
}) {
  useLanguage()
  const host = useHost()
  const file = files[index]!
  const [content, setContent] = useState<{ image?: string | null; text?: string | null } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState('')
  const [natural, setNatural] = useState({ width: 1, height: 1 })
  const [frame, setFrame] = useState({ width: 800, height: 500 })
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  useEffect(() => {
    let active = true
    setContent(null)
    setLoadError(false)
    setZoom('fit')
    setRotation(0)
    setNotice('')
    setNatural({ width: 1, height: 1 })
    const load = isImage(file)
      ? host.invoke('attachments.preview', file.id).then((image) => ({ image }))
      : host.invoke('attachments.text', file.id).then((text) => ({ text }))
    void load.then(
      (value) => {
        if (active) setContent(value)
      },
      () => {
        if (active) {
          setContent({})
          setLoadError(true)
        }
      },
    )
    return () => {
      active = false
    }
  }, [file.id, host.invoke])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() => setFrame({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [content?.image])
  const rotated = rotation % 180 !== 0
  const width = rotated ? natural.height : natural.width,
    height = rotated ? natural.width : natural.height
  const fit = Math.min(1, Math.max(0.01, Math.min((frame.width - 24) / width, (frame.height - 24) / height)))
  const scale = zoom === 'fit' ? fit : zoom
  const zoomBy = (factor: number) => setZoom(Math.max(0.1, Math.min(8, scale * factor)))
  const view = useRef({ scale, zoomAt: (_factor: number, _x?: number, _y?: number) => {} })
  const anchor = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null)
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const el = viewport.current
    const next = Math.max(0.1, Math.min(8, scale * factor))
    if (el && clientX != null && clientY != null && next !== scale) {
      const rect = el.getBoundingClientRect(),
        px = clientX - rect.left,
        py = clientY - rect.top
      anchor.current = { px, py, fx: (el.scrollLeft + px) / el.scrollWidth, fy: (el.scrollTop + py) / el.scrollHeight }
    }
    setZoom(next)
  }
  view.current = { scale, zoomAt }
  useLayoutEffect(() => {
    const el = viewport.current,
      a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = a.fx * el.scrollWidth - a.px
    el.scrollTop = a.fy * el.scrollHeight - a.py
  }, [scale])
  useEffect(() => {
    const el = viewport.current
    if (!el || !content?.image) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      view.current.zoomAt(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0025)), event.clientX, event.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [content?.image])
  const act = async (action: () => Promise<unknown>, message = '') => {
    try {
      const result = await action()
      if (result !== false) setNotice(message)
    } catch (error) {
      notifyError(errorText(error), 'Attachment')
    }
  }
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) =>
    void attachmentMenu(file, event, false, host.isLocal).catch((error) => notifyError(errorText(error), 'Attachment'))
  const tool = (label: string, action: () => void, icon: React.ReactNode, disabled = false) => (
    <Button
      variant="ghost"
      size="icon-xs"
      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
      aria-label={t(label)}
      title={t(label)}
      disabled={disabled}
      onClick={action}
    >
      {icon}
    </Button>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={`attachment-preview [&.expanded]:w-[96vw] [&.expanded]:max-h-[94vh] [&.expanded_.attachment-preview-body.image]:h-[74vh] [&.expanded_.attachment-preview-body.image]:max-h-[74vh] w-[min(92vw,_1100px)] max-w-[none]! max-h-[88vh] p-0 gap-0 overflow-hidden [background:var(--raised)] [backdrop-filter:none] ${expanded ? ' expanded' : ''}`}
        showCloseButton
        finalFocus={() => (opener?.isConnected ? opener : false)}
        aria-describedby={undefined}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            if (content?.text != null && window.getSelection()?.toString()) return
            menu(event)
            return
          }
          if (event.target instanceof Element && event.target.closest('input, textarea')) return
          if (content?.image && ['+', '=', '-', '0', '1'].includes(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            if (event.key === '0') setZoom('fit')
            else if (event.key === '1') setZoom(1)
            else zoomBy(event.key === '-' ? 1 / 1.25 : 1.25)
          }
          if (
            (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
            !(event.target instanceof Element && event.target.closest('.attachment-preview-body'))
          ) {
            event.preventDefault()
            onIndexChange(Math.max(0, Math.min(files.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))))
          }
        }}
      >
        <DialogTitle className="attachment-preview-title m-0 p-[12px_52px_12px_16px] text-control font-medium [border-bottom:1px_solid_var(--line)]">
          {file.name}
          <small className="muted text-muted-foreground"> · {kb(file)}</small>
        </DialogTitle>
        <div
          className="attachment-preview-toolbar flex items-center flex-wrap gap-1 p-[6px_12px] [border-bottom:1px_solid_var(--line)]"
          role="group"
          aria-label={t('Attachment preview actions')}
        >
          {files.length > 1 && (
            <>
              {tool('Previous attachment', () => onIndexChange(index - 1), <ChevronLeft size={15} />, index === 0)}
              <span className="muted text-muted-foreground small text-caption">
                {index + 1} / {files.length}
              </span>
              {tool(
                'Next attachment',
                () => onIndexChange(index + 1),
                <ChevronRight size={15} />,
                index === files.length - 1,
              )}
            </>
          )}
          {content?.image && (
            <>
              {tool('Zoom out (-)', () => zoomBy(1 / 1.25), <ZoomOut size={15} />, scale <= 0.1)}
              <span
                className="preview-zoom min-w-[42px] text-center text-caption text-soft tabular-nums"
                aria-live="polite"
              >
                {Math.round(scale * 100)}%
              </span>
              {tool('Zoom in (+)', () => zoomBy(1.25), <ZoomIn size={15} />, scale >= 8)}
              {tool('Fit image (0)', () => setZoom('fit'), <Scan size={15} />)}
              <Button
                variant="ghost"
                size="sm"
                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                aria-label={t('Actual size (1)')}
                title={t('Actual size (1)')}
                onClick={() => setZoom(1)}
              >
                1:1
              </Button>
              {tool('Rotate clockwise', () => setRotation((value) => (value + 90) % 360), <RotateCw size={15} />)}
            </>
          )}
          <span className="grow flex-1 min-w-0 text-left" />
          {tool(
            expanded ? 'Restore preview size' : 'Expand preview',
            () => setExpanded((value) => !value),
            expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />,
          )}
          {tool(
            isImage(file) ? 'Copy image' : 'Copy filename',
            () => void act(() => invoke('attachments.copy', file.id), 'Copied'),
            <Copy size={15} />,
            !host.isLocal,
          )}
          {tool(
            'Save attachment as…',
            () => void act(() => invoke('attachments.save', file.id), 'Saved'),
            <Download size={15} />,
            !host.isLocal,
          )}
          {tool(
            'Show attachment in folder',
            () => void act(() => invoke('attachments.reveal', file.id)),
            <FolderOpen size={15} />,
            !host.isLocal,
          )}
        </div>
        <div
          ref={viewport}
          className={`attachment-preview-body [&_img]:max-w-full [&_img]:max-h-[calc(88vh_-_72px)] [&_img]:object-contain [&_img]:rounded-(--radius-s) [&_pre]:m-0 [&_pre]:w-full [&_pre]:p-4 [&_pre]:rounded-(--radius-m) [&_pre]:bg-(--field) [&_pre]:border [&_pre]:border-(--line) [&_pre]:font-mono [&_pre]:text-caption [&_pre]:leading-[1.65] [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre]:text-foreground [&_pre]:select-text [&.image]:h-[min(65vh,_650px)] [&.image]:p-0 [&.image]:cursor-grab [&.image:active]:[cursor:grabbing] [&_.preview-image-stage_img]:absolute [&_.preview-image-stage_img]:left-[50%] [&_.preview-image-stage_img]:top-[50%] [&_.preview-image-stage_img]:max-w-[none] [&_.preview-image-stage_img]:max-h-[none] [&_.preview-image-stage_img]:object-contain [&_.preview-image-stage_img]:[border-radius:0] [&:focus-visible]:[outline:2px_solid_var(--line-strong)] [&:focus-visible]:[outline-offset:-2px] overflow-auto justify-center p-4 block max-h-[65vh] min-h-[100px] ${content?.image ? ' image' : ''}`}
          role="region"
          aria-label={
            content?.image
              ? t('Image preview. Use arrow keys to pan, plus and minus to zoom, 0 to fit, 1 for actual size.')
              : t('Attachment contents')
          }
          tabIndex={0}
          onContextMenu={(event) => {
            if (content?.text != null && window.getSelection()?.toString()) return
            menu(event)
          }}
          onDoubleClick={(event) => {
            if (content?.image) {
              if (zoom === 'fit') zoomAt(1 / scale, event.clientX, event.clientY)
              else setZoom('fit')
            }
          }}
          onPointerDown={(event) => {
            if (!content?.image || event.button !== 0) return
            const el = event.currentTarget
            drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
            el.focus()
            el.setPointerCapture(event.pointerId)
            event.preventDefault()
          }}
          onPointerMove={(event) => {
            if (drag.current) {
              event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX
              event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY
            }
          }}
          onPointerUp={(event) => {
            drag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          {content === null ? (
            <p className="muted text-muted-foreground" role="status">
              {t('Loading…')}
            </p>
          ) : content.image ? (
            <div
              className="preview-image-stage relative"
              style={{
                width: Math.max(frame.width, width * scale + 24),
                height: Math.max(frame.height, height * scale + 24),
              }}
            >
              <img
                src={content.image}
                alt={file.name}
                draggable={false}
                onLoad={(event) =>
                  setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
                }
                onError={() => {
                  setContent({})
                  setLoadError(true)
                }}
                style={{
                  width: natural.width * scale,
                  height: natural.height * scale,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }}
              />
            </div>
          ) : content.text != null ? (
            <pre>{content.text}</pre>
          ) : (
            <p className="muted text-muted-foreground" role={loadError ? 'alert' : undefined}>
              {loadError
                ? t('Could not load this preview. You can save the attachment to inspect it.')
                : t('No preview for this file type. Save it to open in another app.')}
            </p>
          )}
        </div>
        <div className="attachment-preview-footer flex justify-between gap-3 p-[8px_16px] text-muted-foreground text-caption [border-top:1px_solid_var(--line)]">
          <span>
            {content?.image
              ? t('Scroll to zoom · drag to pan · double-click 1:1 · + / − zoom · 0 fit · 1 actual size')
              : t('Escape to close')}
            {content?.text != null && (
              <span className="tabular-nums">
                {' '}
                ·{' '}
                {t('{0} lines · {1} characters', {
                  '0': content.text.split('\n').length.toLocaleString(),
                  '1': content.text.length.toLocaleString(),
                })}
              </span>
            )}
          </span>
          <span role="status">{notice}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AttachmentItem({
  file,
  onRemove,
  size,
  names,
  onPreview,
}: {
  file: Attachment
  onRemove?: () => void
  size: 'normal' | 'small'
  /** Show the file name under an image (files always show it). */
  names: boolean
  onPreview: (opener: HTMLElement) => void
}) {
  useLanguage()
  const host = useHost()
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    if (isImage(file))
      void host.invoke('attachments.preview', file.id).then(
        (image) => {
          if (active) setThumb(image)
        },
        () => {},
      )
    return () => {
      active = false
    }
  }, [file.id, file.mimeType, host.invoke])
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const opener =
      event.currentTarget.querySelector<HTMLElement>('[data-slot=attachment-trigger]') ?? event.currentTarget
    void attachmentMenu(file, event, !!onRemove, host.isLocal).then(
      (action) => {
        if (action === 'preview') onPreview(opener)
        if (action === 'remove') onRemove?.()
      },
      (error) => notifyError(errorText(error), 'Attachment'),
    )
  }
  const image = isImage(file)
  const tile = image && size === 'normal'
  return (
    <AttachmentCard
      size={size === 'small' ? 'xs' : 'default'}
      orientation={tile ? 'vertical' : 'horizontal'}
      className={tile ? 'w-24 gap-0 overflow-hidden has-data-[slot=attachment-content]:w-30' : 'max-w-60 flex-nowrap'}
      style={tile ? { padding: 0 } : undefined}
      onContextMenu={menu}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) menu(event)
      }}
    >
      <AttachmentMedia variant={image ? 'image' : 'icon'} className={tile ? 'rounded-[inherit]' : undefined}>
        {image && thumb ? <img src={thumb} alt="" /> : <File />}
      </AttachmentMedia>
      {(!image || size === 'small' || names) && (
        <AttachmentContent className={tile ? 'px-2 py-1.5' : undefined}>
          <AttachmentTitle>{file.name}</AttachmentTitle>
          {size === 'normal' && <AttachmentDescription>{kb(file)}</AttachmentDescription>}
        </AttachmentContent>
      )}
      <AttachmentTrigger
        aria-label={t('Preview {0}', { '0': file.name })}
        title={`${file.name} · ${kb(file)}`}
        aria-haspopup="dialog"
        className="rounded-[inherit] focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={(event) => onPreview(event.currentTarget)}
      />
      {onRemove && (
        <AttachmentActions style={tile ? { top: 4, right: 4 } : undefined}>
          <AttachmentAction
            variant="secondary"
            size="icon-xs"
            aria-label={t('Remove attachment {0}', { '0': file.name })}
            title={t('Remove')}
            className="rounded-full border border-(--line-strong) p-0 opacity-0 transition-opacity group-focus-within/attachment:opacity-100 group-hover/attachment:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <X />
          </AttachmentAction>
        </AttachmentActions>
      )}
    </AttachmentCard>
  )
}

export function Attachments({
  files,
  onRemove,
  size = 'normal',
  names = false,
  className,
}: {
  files: Attachment[]
  onRemove?: (id: string) => void
  size?: 'normal' | 'small'
  names?: boolean
  className?: string
}) {
  useLanguage()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const index = files.findIndex((file) => file.id === previewId)
  return (
    <AttachmentGroup
      className={cn('flex-wrap items-start gap-2 overflow-visible py-0 pt-1 [mask-image:none]', className)}
      role="group"
      aria-label={t('Attachments')}
    >
      {files.map((file) => (
        <AttachmentItem
          key={file.id}
          file={file}
          size={size}
          names={names}
          onRemove={onRemove ? () => onRemove(file.id) : undefined}
          onPreview={(element) => {
            opener.current = element
            setPreviewId(file.id)
          }}
        />
      ))}
      {index >= 0 && (
        <AttachmentPreview
          files={files}
          index={index}
          onIndexChange={(next) => setPreviewId(files[next]?.id ?? null)}
          onClose={() => setPreviewId(null)}
          opener={opener.current}
        />
      )}
    </AttachmentGroup>
  )
}
