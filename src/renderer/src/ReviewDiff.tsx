import { afterLineForBefore } from '../../shared/reviewLines'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, MessageSquarePlus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAppSettings } from './AppSettings'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChangeFile, ReviewComment } from '../../shared/types'
import { monaco } from './monaco'
import { reviewCommentMenu } from './monacoMenu'

// Set when stepping past the last change of a file: the next file's diff takes it and lands on its first (or last) change.
const reviewEntry: { current: { fileId: string; direction: 'next' | 'previous' } | null } = { current: null }
export function enterReviewFile(fileId: string, direction: 'next' | 'previous') { reviewEntry.current = { fileId, direction }; window.dispatchEvent(new CustomEvent('ramu:review-enter', { detail: { fileId } })) }
export interface InlineReviewBlock { key: string; side: 'old' | 'new'; line: number; content: ReactNode }
export function ReviewDiff({ file, comments, onSelect, onComment, flow = false, inlineBlocks = [], sideBySide: layout }: { file: ChangeFile; comments: ReviewComment[]; onSelect: (side: 'old' | 'new', line: number, endLine: number) => void; onComment?: (side: 'old' | 'new', line: number, endLine: number) => void; flow?: boolean; inlineBlocks?: InlineReviewBlock[]; sideBySide?: boolean }) {
  const { preferences } = useAppSettings()
  const [localSideBySide, setSideBySide] = useState(true), [hasChanges, setHasChanges] = useState(false), [computed, setComputed] = useState(false), [height, setHeight] = useState(300)
  const sideBySide = layout ?? localSideBySide
  const [lineChanges, setLineChanges] = useState<monaco.editor.ILineChange[]>([])
  const changeIndex = useRef(-1)
  const [zoneHosts, setZoneHosts] = useState<Map<string, HTMLElement>>(new Map())
  const host = useRef<HTMLDivElement>(null), editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const clearZones = useRef<(() => void) | null>(null)
  const activeSide = useRef<'old' | 'new'>('new')
  const navigateRef = useRef<(direction: 'next' | 'previous') => void>(() => {}), commentRef = useRef<(side: 'old' | 'new') => void>(() => {})
  const handlers = useRef({ onSelect, onComment, inlineBlocks }); handlers.current = { onSelect, onComment, inlineBlocks }
  const selection = (side: 'old' | 'new') => {
    const pane = side === 'old' ? editor.current?.getOriginalEditor() : editor.current?.getModifiedEditor(), range = pane?.getSelection()
    if (range) return { side, line: range.startLineNumber, endLine: range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber }
    return null
  }
  const comment = (side: 'old' | 'new') => { const range = selection(side); if (range) handlers.current.onComment?.(range.side, range.line, range.endLine) }
  const size = () => {
    const diff = editor.current
    if (flow && diff) setHeight(Math.max(100, diff.getOriginalEditor().getContentHeight(), diff.getModifiedEditor().getContentHeight()))
  }
  useLayoutEffect(() => {
    const original = monaco.editor.createModel(file.oldContent, undefined, monaco.Uri.from({ scheme: 'inmemory', path: `/${crypto.randomUUID()}/${file.path}` })), modified = monaco.editor.createModel(file.newContent, original.getLanguageId())
    const diff = monaco.editor.createDiffEditor(host.current!, { theme: 'ramu', readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: sideBySide, useInlineViewWhenSpaceIsLimited: false, glyphMargin: true, minimap: { enabled: false }, fontSize: preferences.editorFontSize, accessibilityVerbose: true, scrollBeyondLastLine: false, ...(flow ? { hideUnchangedRegions: { enabled: true, contextLineCount: 4, minimumLineCount: 10, revealLineCount: 20 }, scrollbar: { vertical: 'hidden', alwaysConsumeMouseWheel: false } } : {}) })
    diff.setModel({ original, modified }); editor.current = diff
    const updated = diff.onDidUpdateDiff(() => { const changes = diff.getLineChanges() ?? []; setHasChanges(!!changes.length); setComputed(true); setLineChanges((previous) => JSON.stringify(previous) === JSON.stringify(changes) ? previous : changes); size() })
    const disposables = [(['old', diff.getOriginalEditor()] as const), (['new', diff.getModifiedEditor()] as const)].flatMap(([side, pane]) => {
      const hover = pane.createDecorationsCollection()
      let anchor: number | null = null, lastAnchor: number | null = null, endpoint = 1
      const highlight = (start: number, end: number) => pane.setSelection(new monaco.Selection(Math.min(start, end), 1, Math.max(start, end), pane.getModel()!.getLineMaxColumn(Math.max(start, end))))
      const up = () => { if (anchor !== null) { const start = anchor; anchor = null; handlers.current.onComment?.(side, Math.min(start, endpoint), Math.max(start, endpoint)) } }
      window.addEventListener('mouseup', up)
      const unregister = onComment ? reviewCommentMenu(pane, () => comment(side)) : () => {}
      return [pane.onDidContentSizeChange(size), pane.onDidChangeCursorSelection(() => { const range = selection(side); if (range) handlers.current.onSelect(range.side, range.line, range.endLine) }), pane.onMouseDown((event) => {
        activeSide.current = side
        if (!onComment || event.event.browserEvent.button !== 0 || !event.target.position) return
        if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
          event.event.preventDefault(); const line = event.target.position.lineNumber
          anchor = event.event.shiftKey && lastAnchor !== null ? lastAnchor : line; lastAnchor = anchor; endpoint = line
          highlight(anchor, line)
        }
      }), pane.onMouseMove((event) => {
        if (!onComment || !event.target.position) return
        const line = event.target.position.lineNumber
        if (anchor !== null) { endpoint = line; highlight(anchor, line) }
        else hover.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'review-add-glyph', glyphMarginHoverMessage: { value: 'Click or drag to comment on lines' } } }])
      }), pane.onMouseLeave(() => hover.clear()), { dispose: () => { window.removeEventListener('mouseup', up); unregister(); hover.clear() } }]
    })
    size()
    return () => { clearZones.current?.(); clearZones.current = null; updated.dispose(); disposables.forEach((d) => d.dispose()); diff.setModel(null); diff.dispose(); original.dispose(); modified.dispose(); editor.current = null }
  }, [file.id, flow])
  useLayoutEffect(() => { editor.current?.updateOptions({ renderSideBySide: sideBySide, fontSize: preferences.editorFontSize }); size() }, [sideBySide, preferences.editorFontSize])
  const zoneSpec = inlineBlocks.map((block) => `${block.key}:${block.side}:${block.line}`).join('|')
  useLayoutEffect(() => {
    const diff = editor.current; if (!diff) return
    const nodes = new Map<string, HTMLElement>()
    const accessibility = new Map<HTMLElement, string | null>()
    const disposables = handlers.current.inlineBlocks.map((block) => {
      const pane = block.side === 'old' && sideBySide ? diff.getOriginalEditor() : diff.getModifiedEditor()
      const line = block.side === 'old' && !sideBySide ? afterLineForBefore(block.line, lineChanges) : block.line
      const wrapper = document.createElement('div'), body = document.createElement('div'); wrapper.className = 'review-inline-zone'; body.className = 'review-inline-body'; wrapper.append(body)
      // Keep discussion width tied to the visible pane, not the code's scroll width.
      const resize = () => { body.style.width = `${pane.getLayoutInfo().contentWidth}px` }
      resize(); const layoutListener = pane.onDidLayoutChange(resize)
      const zone: monaco.editor.IViewZone = { afterLineNumber: Math.min(line, pane.getModel()!.getLineCount()), heightInPx: 100, domNode: wrapper, suppressMouseDown: false, showInHiddenAreas: true }
      let zoneId = ''; pane.changeViewZones((accessor) => { zoneId = accessor.addZone(zone) })
      // Monaco hides view zones from assistive technology; these zones contain real forms.
      const parent = wrapper.parentElement
      if (parent) { if (!accessibility.has(parent)) accessibility.set(parent, parent.getAttribute('aria-hidden')); parent.removeAttribute('aria-hidden') }
      const observer = new ResizeObserver(() => { const next = Math.ceil(body.getBoundingClientRect().height) + 16; if (next !== zone.heightInPx) { zone.heightInPx = next; pane.changeViewZones((accessor) => accessor.layoutZone(zoneId)); size() } })
      observer.observe(body); nodes.set(block.key, body)
      return () => { observer.disconnect(); layoutListener.dispose(); pane.changeViewZones((accessor) => accessor.removeZone(zoneId)) }
    })
    setZoneHosts(nodes); size()
    let cleared = false
    const cleanup = () => { if (cleared) return; cleared = true; disposables.forEach((dispose) => dispose()); accessibility.forEach((hidden, parent) => { if (hidden === null) parent.removeAttribute('aria-hidden'); else parent.setAttribute('aria-hidden', hidden) }) }
    clearZones.current = cleanup
    return () => { cleanup(); if (clearZones.current === cleanup) clearZones.current = null }
  }, [file.id, zoneSpec, sideBySide, lineChanges])
  useEffect(() => {
    const reveal = (event: Event) => {
      const target = (event as CustomEvent).detail; if (target?.fileId !== file.id || !editor.current) return
      const pane = target.side === 'old' ? editor.current.getOriginalEditor() : editor.current.getModifiedEditor(); pane.setSelection(new monaco.Range(target.line, 1, target.endLine, pane.getModel()!.getLineMaxColumn(target.endLine))); pane.revealLineInCenter(target.line); pane.focus()
      if (flow && host.current) { const root = host.current.closest('.changes-page'); if (root) root.scrollBy({ top: host.current.getBoundingClientRect().top - root.getBoundingClientRect().top + pane.getTopForLineNumber(target.line) - 100, behavior: 'smooth' }) }
    }
    window.addEventListener('ramu:review-line', reveal); return () => window.removeEventListener('ramu:review-line', reveal)
  }, [file.id, flow])
  useEffect(() => {
    const diff = editor.current; if (!diff) return
    const collections = [(['old', diff.getOriginalEditor()] as const), (['new', diff.getModifiedEditor()] as const)].map(([side, pane]) => pane.createDecorationsCollection(comments.filter((c) => c.side === side && c.scope !== 'file' && c.state !== 'resolved').map((c) => ({ range: new monaco.Range(c.line, 1, c.endLine, 1), options: { isWholeLine: true, className: 'review-comment-line', glyphMarginClassName: 'review-comment-glyph', glyphMarginHoverMessage: { value: `${c.author === 'ai' ? 'AI' : 'You'}: ${c.text}` } } }))))
    return () => collections.forEach((c) => c.clear())
  }, [comments])
  useEffect(() => {
    const onNav = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.fileId === file.id && !detail.handled) { detail.handled = true; navigateRef.current(detail.direction) } }
    const onComment = (event: Event) => { if ((event as CustomEvent).detail?.fileId === file.id) commentRef.current(activeSide.current) }
    window.addEventListener('ramu:review-nav', onNav); window.addEventListener('ramu:review-comment-selection', onComment)
    return () => { window.removeEventListener('ramu:review-nav', onNav); window.removeEventListener('ramu:review-comment-selection', onComment) }
  }, [file.id])
  const goToChange = (index: number) => {
    changeIndex.current = index
    const line = Math.max(1, lineChanges[index]!.modifiedStartLineNumber)
    window.dispatchEvent(new CustomEvent('ramu:review-line', { detail: { fileId: file.id, side: 'new', line, endLine: line } }))
  }
  // Past the last change of a file, keep going in the next one; ReviewFileCards in Changes.tsx pick the neighbouring file.
  const leaveFile = (direction: 'next' | 'previous') => window.dispatchEvent(new CustomEvent('ramu:review-nav-file', { detail: { fileId: file.id, direction } }))
  const navigate = (direction: 'next' | 'previous') => {
    if (!flow) { editor.current?.goToDiff(direction); return }
    if (!lineChanges.length) { leaveFile(direction); return }
    const last = lineChanges.length - 1, next = changeIndex.current < 0 ? (direction === 'next' ? 0 : last) : changeIndex.current + (direction === 'next' ? 1 : -1)
    if (next < 0 || next > last) leaveFile(direction); else goToChange(next)
  }
  const enter = () => {
    const entry = reviewEntry.current
    if (!entry || entry.fileId !== file.id || !computed) return
    reviewEntry.current = null
    if (lineChanges.length) goToChange(entry.direction === 'next' ? 0 : lineChanges.length - 1)
  }
  const enterRef = useRef(enter); enterRef.current = enter
  useEffect(() => { enterRef.current() }, [computed, lineChanges, file.id])
  useEffect(() => {
    const onEnter = (event: Event) => { if ((event as CustomEvent).detail?.fileId === file.id) enterRef.current() }
    window.addEventListener('ramu:review-enter', onEnter); return () => window.removeEventListener('ramu:review-enter', onEnter)
  }, [file.id])
  navigateRef.current = navigate; commentRef.current = comment
  return <div className={`review-diff-wrap${flow ? ' flowing-diff' : ''}`}><div className="review-diff-controls">{layout === undefined && <div role="group" aria-label="Diff layout"><Button className="ghost small" aria-pressed={!sideBySide} onClick={() => setSideBySide(false)}>Inline</Button><Button className="ghost small" aria-pressed={sideBySide} onClick={() => setSideBySide(true)}>Split</Button></div>}{onComment && <Button className="ghost small" onClick={() => comment(activeSide.current)}><MessageSquarePlus size={13} />Comment on selection</Button>}<span className="grow" /><Button className="ghost icon small-icon" aria-label="Previous change" disabled={!hasChanges} onClick={() => navigate('previous')}><ChevronUp size={14} /></Button><Button className="ghost icon small-icon" aria-label="Next change" disabled={!hasChanges} onClick={() => navigate('next')}><ChevronDown size={14} /></Button></div><div ref={host} className="review-diff" style={flow ? { height } : undefined} aria-label={`Changes to ${file.path}`} />{inlineBlocks.map((block) => { const target = zoneHosts.get(block.key); return target ? createPortal(<div className="review-inline-interaction" onKeyDown={(event) => event.stopPropagation()}>{block.content}</div>, target, block.key) : null })}</div>
}
