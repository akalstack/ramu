import { t, useLanguage } from './i18n'
import { errorText } from './errors'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
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
import { invoke } from './ipc'
import { notifyError } from './Notifications'

const isImage = (file: Attachment) => file.mimeType.startsWith('image/')
const kb = (file: Attachment) => `${Math.max(1, Math.ceil(file.size / 1024))} KB`

async function attachmentMenu(
  file: Attachment,
  event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  removable: boolean,
) {
  event.preventDefault()
  event.stopPropagation()
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
      ? invoke('attachments.preview', file.id).then((image) => ({ image }))
      : invoke('attachments.text', file.id).then((text) => ({ text }))
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
  }, [file.id])
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
    void attachmentMenu(file, event, false).catch((error) => notifyError(errorText(error), 'Attachment'))
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
          )}
          {tool(
            'Save attachment as…',
            () => void act(() => invoke('attachments.save', file.id), 'Saved'),
            <Download size={15} />,
          )}
          {tool(
            'Show attachment in folder',
            () => void act(() => invoke('attachments.reveal', file.id)),
            <FolderOpen size={15} />,
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
  onPreview,
}: {
  file: Attachment
  onRemove?: () => void
  size: 'normal' | 'small'
  onPreview: (opener: HTMLElement) => void
}) {
  useLanguage()
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    if (isImage(file))
      void invoke('attachments.preview', file.id).then(
        (image) => {
          if (active) setThumb(image)
        },
        () => {},
      )
    return () => {
      active = false
    }
  }, [file.id, file.mimeType])
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const opener = event.currentTarget.querySelector<HTMLElement>('.attachment-open') ?? event.currentTarget
    void attachmentMenu(file, event, !!onRemove).then(
      (action) => {
        if (action === 'preview') onPreview(opener)
        if (action === 'remove') onRemove?.()
      },
      (error) => notifyError(errorText(error), 'Attachment'),
    )
  }
  const remove = onRemove && (
    <Button
      variant="secondary"
      type="button"
      className={`bg-fill hover:bg-fill-hover attachment-remove [&:focus-visible]:opacity-100 [&:hover]:[background:linear-gradient(var(--hover),_var(--hover)),_linear-gradient(var(--pressed),_var(--pressed)),_var(--canvas)] absolute grid place-items-center min-h-0 p-0 [border:0] rounded-full cursor-pointer w-[22px] h-[22px] opacity-0 [transition:opacity_0.12s_var(--ease)] [box-shadow:inset_0_0_0_1px_var(--line-strong),_0_1px_4px_rgba(0,_0,_0,_0.4)] text-foreground [background:linear-gradient(var(--pressed),_var(--pressed)),_var(--canvas)] top-1 right-1`}
      aria-label={t('Remove attachment {0}', { '0': file.name })}
      title={t('Remove')}
      onClick={(event) => {
        event.stopPropagation()
        onRemove()
      }}
    >
      <X size={13} />
    </Button>
  )
  return (
    <span
      className={
        isImage(file)
          ? `attachment-tile [&.small]:w-10 [&.small]:h-10 [&_.attachment-open]:w-full [&_.attachment-open]:h-full [&_.attachment-open]:p-0 [&_.attachment-open]:overflow-hidden [&_.attachment-open]:[border:1px_solid_var(--edge)] [&_.attachment-open]:rounded-(--radius-m) [&_.attachment-open]:bg-canvas [&_.attachment-open]:justify-center [&_.attachment-open]:[cursor:zoom-in] [&.small_.attachment-open]:rounded-(--radius-s) [&_.attachment-open:hover:not(:disabled)]:[border-color:rgba(255,_255,_255,_0.3)] [&_.attachment-open:hover:not(:disabled)]:bg-canvas [&_img]:w-full [&_img]:h-full [&_img]:object-cover [&_img]:[border-radius:0] [&.small_.attachment-remove]:w-[18px] [&.small_.attachment-remove]:h-[18px] [.msg-wrap.user_&]:w-[112px] [.msg-wrap.user_&]:h-[112px] [&_.attachment-remove]:[transition:none] [&:hover_.attachment-remove]:opacity-100 [&:hover_.attachment-remove]:[transition:opacity_0.12s_var(--ease)] relative inline-flex w-[96px] h-[96px] flex-none ${size}`
          : 'attachment-chip [&_img]:w-[36px] [&_img]:h-[36px] [&_img]:object-cover [&_img]:rounded-(--radius-xs) [&_button]:flex-none [&_svg]:flex-none [&_.attachment-open.file]:inline-flex [&_.attachment-open.file]:items-center [&_.attachment-open.file]:gap-[7px] [&_.attachment-open.file]:p-[5px_9px] [&_.attachment-open.file]:max-w-[240px] [&_.attachment-open.file]:bg-transparent [&_.attachment-open.file]:[border:0] [&_.attachment-open.file]:text-left [&_.attachment-open.file]:justify-start [&_.attachment-open.file]:cursor-pointer [&:not(.comments-chip)_.attachment-remove]:[transition:none] [&:hover_.attachment-remove]:opacity-100 [&:hover_.attachment-remove]:[transition:opacity_0.12s_var(--ease)] [&_button.comments-chip-x]:absolute [&_button.comments-chip-x]:top-[50%] [&_button.comments-chip-x]:right-1 [&_button.comments-chip-x]:bottom-auto [&_button.comments-chip-x]:left-auto [&_button.comments-chip-x]:w-5 [&_button.comments-chip-x]:h-5 [&_button.comments-chip-x]:min-w-0 [&_button.comments-chip-x]:min-h-0 [&_button.comments-chip-x]:m-0 [&_button.comments-chip-x]:p-0 [&_button.comments-chip-x]:grid [&_button.comments-chip-x]:place-items-center [&_button.comments-chip-x]:[border:0] [&_button.comments-chip-x]:rounded-full [&_button.comments-chip-x]:[transform:translateY(-50%)] [&_button.comments-chip-x]:opacity-0 [&_button.comments-chip-x]:[transition:none] [&:hover_button.comments-chip-x]:opacity-100 [&:hover_button.comments-chip-x]:[transition:opacity_0.12s_var(--ease)] [&_button.comments-chip-x:focus-visible]:opacity-100 [&_button.comments-chip-x:focus-visible]:[transition:opacity_0.12s_var(--ease)] inline-flex items-center gap-[7px] max-w-[240px] min-w-0 [border:1px_solid_transparent] rounded-(--radius-s) text-control whitespace-normal relative p-0 bg-hover'
      }
      onContextMenu={menu}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) menu(event)
      }}
    >
      <Button
        variant="secondary"
        type="button"
        className={`attachment-open${isImage(file) ? '' : ' file'}`}
        aria-label={t('Preview {0}', { '0': file.name })}
        title={`${file.name} · ${kb(file)}`}
        aria-haspopup="dialog"
        onClick={(event) => onPreview(event.currentTarget)}
      >
        {isImage(file) ? (
          thumb ? (
            <img src={thumb} alt="" />
          ) : (
            <File size={20} />
          )
        ) : (
          <>
            <File size={16} />
            <span className="attachment-name [&_small]:block [&_small]:text-caption min-w-0 [overflow-wrap:anywhere]">
              {file.name}
              <small className="muted text-muted-foreground">{kb(file)}</small>
            </span>
          </>
        )}
      </Button>
      {remove}
    </span>
  )
}

export function Attachments({
  files,
  onRemove,
  size = 'normal',
}: {
  files: Attachment[]
  onRemove?: (id: string) => void
  size?: 'normal' | 'small'
}) {
  useLanguage()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const index = files.findIndex((file) => file.id === previewId)
  return (
    <div
      className="attachment-list [.msg-wrap.user_&]:justify-end [.msg-wrap.user_&]:m-[18px_0_2px] [.msg-wrap.user_&_+_.msg.user]:mt-2 flex flex-wrap gap-2.5 mb-2.5 pt-1.5"
      role="group"
      aria-label={t('Attachments')}
    >
      {files.map((file) => (
        <AttachmentItem
          key={file.id}
          file={file}
          size={size}
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
    </div>
  )
}
