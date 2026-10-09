import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Copy, Download, File, FolderOpen, Maximize2, Minimize2, RotateCw, Scan, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react'
import type { Attachment } from '../../shared/types'
import { invoke } from './ipc'
import { notifyError } from './Notifications'

const isImage = (file: Attachment) => file.mimeType.startsWith('image/')
const kb = (file: Attachment) => `${Math.max(1, Math.ceil(file.size / 1024))} KB`

async function attachmentMenu(file: Attachment, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, removable: boolean) {
  event.preventDefault(); event.stopPropagation()
  const rect = event.currentTarget.getBoundingClientRect()
  const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: rect.left + 12, y: rect.bottom }
  return invoke('attachments.menu', file.id, removable, point)
}

function AttachmentPreview({ files, index, onIndexChange, onClose, opener }: { files: Attachment[]; index: number; onIndexChange: (index: number) => void; onClose: () => void; opener: HTMLElement | null }) {
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
    setContent(null); setLoadError(false); setZoom('fit'); setRotation(0); setNotice(''); setNatural({ width: 1, height: 1 })
    const load = isImage(file) ? invoke('attachments.preview', file.id).then((image) => ({ image })) : invoke('attachments.text', file.id).then((text) => ({ text }))
    void load.then((value) => { if (active) setContent(value) }, () => { if (active) { setContent({}); setLoadError(true) } })
    return () => { active = false }
  }, [file.id])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() => setFrame({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [content?.image])
  const rotated = rotation % 180 !== 0
  const width = rotated ? natural.height : natural.width, height = rotated ? natural.width : natural.height
  const fit = Math.min(1, Math.max(.01, Math.min((frame.width - 24) / width, (frame.height - 24) / height)))
  const scale = zoom === 'fit' ? fit : zoom
  const zoomBy = (factor: number) => setZoom(Math.max(.1, Math.min(8, scale * factor)))
  const view = useRef({ scale, zoomAt: (_factor: number, _x?: number, _y?: number) => {} })
  const anchor = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null)
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const el = viewport.current
    const next = Math.max(.1, Math.min(8, scale * factor))
    if (el && clientX != null && clientY != null && next !== scale) {
      const rect = el.getBoundingClientRect(), px = clientX - rect.left, py = clientY - rect.top
      anchor.current = { px, py, fx: (el.scrollLeft + px) / el.scrollWidth, fy: (el.scrollTop + py) / el.scrollHeight }
    }
    setZoom(next)
  }
  view.current = { scale, zoomAt }
  useLayoutEffect(() => {
    const el = viewport.current, a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = a.fx * el.scrollWidth - a.px; el.scrollTop = a.fy * el.scrollHeight - a.py
  }, [scale])
  useEffect(() => {
    const el = viewport.current
    if (!el || !content?.image) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      view.current.zoomAt(Math.exp(-delta * (event.ctrlKey ? .01 : .0025)), event.clientX, event.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [content?.image])
  const act = async (action: () => Promise<unknown>, message = '') => {
    try { const result = await action(); if (result !== false) setNotice(message) } catch (error) { notifyError(String(error), 'Attachment') }
  }
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void attachmentMenu(file, event, false).catch((error) => notifyError(String(error), 'Attachment'))
  const tool = (label: string, action: () => void, icon: React.ReactNode, disabled = false) => <Button className="ghost icon small-icon" aria-label={label} title={label} disabled={disabled} onClick={action}>{icon}</Button>
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className={`attachment-preview${expanded ? ' expanded' : ''}`} showCloseButton finalFocus={() => opener?.isConnected ? opener : false} aria-describedby={undefined} onKeyDown={(event) => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { if (content?.text != null && window.getSelection()?.toString()) return; menu(event); return }
      if (event.target instanceof Element && event.target.closest('input, textarea')) return
      if (content?.image && ['+', '=', '-', '0', '1'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        if (event.key === '0') setZoom('fit')
        else if (event.key === '1') setZoom(1)
        else zoomBy(event.key === '-' ? 1 / 1.25 : 1.25)
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target instanceof Element && event.target.closest('.attachment-preview-body'))) {
        event.preventDefault(); onIndexChange(Math.max(0, Math.min(files.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))))
      }
    }}>
      <DialogTitle className="attachment-preview-title">{file.name}<small className="muted"> · {kb(file)}</small></DialogTitle>
      <div className="attachment-preview-toolbar" role="group" aria-label="Attachment preview actions">
        {files.length > 1 && <>{tool('Previous attachment', () => onIndexChange(index - 1), <ChevronLeft size={15} />, index === 0)}<span className="muted small">{index + 1} / {files.length}</span>{tool('Next attachment', () => onIndexChange(index + 1), <ChevronRight size={15} />, index === files.length - 1)}</>}
        {content?.image && <>{tool('Zoom out (-)', () => zoomBy(1 / 1.25), <ZoomOut size={15} />, scale <= .1)}<span className="preview-zoom" aria-live="polite">{Math.round(scale * 100)}%</span>{tool('Zoom in (+)', () => zoomBy(1.25), <ZoomIn size={15} />, scale >= 8)}{tool('Fit image (0)', () => setZoom('fit'), <Scan size={15} />)}<Button className="ghost small" aria-label="Actual size (1)" title="Actual size (1)" onClick={() => setZoom(1)}>1:1</Button>{tool('Rotate clockwise', () => setRotation((value) => (value + 90) % 360), <RotateCw size={15} />)}</>}
        <span className="grow" />
        {tool(expanded ? 'Restore preview size' : 'Expand preview', () => setExpanded((value) => !value), expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />)}
        {tool(isImage(file) ? 'Copy image' : 'Copy filename', () => void act(() => invoke('attachments.copy', file.id), 'Copied'), <Copy size={15} />)}
        {tool('Save attachment as…', () => void act(() => invoke('attachments.save', file.id), 'Saved'), <Download size={15} />)}
        {tool('Show attachment in folder', () => void act(() => invoke('attachments.reveal', file.id)), <FolderOpen size={15} />)}
      </div>
      <div ref={viewport} className={`attachment-preview-body${content?.image ? ' image' : ''}`} role="region" aria-label={content?.image ? 'Image preview. Use arrow keys to pan, plus and minus to zoom, 0 to fit, 1 for actual size.' : 'Attachment contents'} tabIndex={0} onContextMenu={(event) => { if (content?.text != null && window.getSelection()?.toString()) return; menu(event) }} onDoubleClick={(event) => { if (content?.image) { if (zoom === 'fit') zoomAt(1 / scale, event.clientX, event.clientY); else setZoom('fit') } }} onPointerDown={(event) => {
        if (!content?.image || event.button !== 0) return
        const el = event.currentTarget
        drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
        el.focus(); el.setPointerCapture(event.pointerId); event.preventDefault()
      }} onPointerMove={(event) => { if (drag.current) { event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX; event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY } }} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { drag.current = null }}>
        {content === null ? <p className="muted" role="status">Loading…</p> : content.image ? <div className="preview-image-stage" style={{ width: Math.max(frame.width, width * scale + 24), height: Math.max(frame.height, height * scale + 24) }}><img src={content.image} alt={file.name} draggable={false} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => { setContent({}); setLoadError(true) }} style={{ width: natural.width * scale, height: natural.height * scale, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} /></div> : content.text != null ? <pre>{content.text}</pre> : <p className="muted" role={loadError ? 'alert' : undefined}>{loadError ? 'Could not load this preview. You can save the attachment to inspect it.' : 'No preview for this file type. Save it to open in another app.'}</p>}
      </div>
      <div className="attachment-preview-footer"><span>{content?.image ? 'Scroll to zoom · drag to pan · double-click 1:1 · + / − zoom · 0 fit · 1 actual size' : 'Escape to close'}</span><span role="status">{notice}</span></div>
    </DialogContent>
  </Dialog>
}

function AttachmentItem({ file, onRemove, size, onPreview }: { file: Attachment; onRemove?: () => void; size: 'normal' | 'small'; onPreview: (opener: HTMLElement) => void }) {
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    if (isImage(file)) void invoke('attachments.preview', file.id).then((image) => { if (active) setThumb(image) }, () => {})
    return () => { active = false }
  }, [file.id, file.mimeType])
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const opener = event.currentTarget.querySelector<HTMLElement>('.attachment-open') ?? event.currentTarget
    void attachmentMenu(file, event, !!onRemove).then((action) => { if (action === 'preview') onPreview(opener); if (action === 'remove') onRemove?.() }, (error) => notifyError(String(error), 'Attachment'))
  }
  const remove = onRemove && <Button type="button" className="attachment-remove" aria-label={`Remove attachment ${file.name}`} title="Remove" onClick={(event) => { event.stopPropagation(); onRemove() }}><X size={13} strokeWidth={2.5} /></Button>
  return <span className={isImage(file) ? `attachment-tile ${size}` : 'attachment-chip'} onContextMenu={menu} onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') menu(event) }}>
    <Button type="button" className={`attachment-open${isImage(file) ? '' : ' file'}`} aria-label={`Preview ${file.name}`} title={`${file.name} · ${kb(file)}`} aria-haspopup="dialog" onClick={(event) => onPreview(event.currentTarget)}>
      {isImage(file) ? thumb ? <img src={thumb} alt="" /> : <File size={20} /> : <><File size={16} /><span className="attachment-name">{file.name}<small className="muted">{kb(file)}</small></span></>}
    </Button>{remove}
  </span>
}

export function Attachments({ files, onRemove, size = 'normal' }: { files: Attachment[]; onRemove?: (id: string) => void; size?: 'normal' | 'small' }) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const index = files.findIndex((file) => file.id === previewId)
  return <div className="attachment-list" role="group" aria-label="Attachments">{files.map((file) => <AttachmentItem key={file.id} file={file} size={size} onRemove={onRemove ? () => onRemove(file.id) : undefined} onPreview={(element) => { opener.current = element; setPreviewId(file.id) }} />)}
    {index >= 0 && <AttachmentPreview files={files} index={index} onIndexChange={(next) => setPreviewId(files[next]?.id ?? null)} onClose={() => setPreviewId(null)} opener={opener.current} />}
  </div>
}
