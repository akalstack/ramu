import { t, useLanguage } from '../i18n'
import { afterLineForBefore } from '@ramu/shared/review/reviewLines'
import { Button } from '@/components/desktop-button'
import { ChevronDown, ChevronUp, MessageSquarePlus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAppSettings } from '../settings/AppSettings'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChangeFile, ReviewComment } from '@ramu/shared/types'
import { monaco } from '../editor/monaco'
import { reviewCommentMenu } from '../editor/monacoMenu'
import { useNearViewport } from '../lib/useNearViewport'
import { editorThemeName } from '../editor/editorTheme'

// Set when stepping past the last change of a file: the next file's diff takes it and lands on its first (or last) change.
const reviewEntry: { current: { fileId: string; direction: 'next' | 'previous' } | null } = { current: null }
export function enterReviewFile(fileId: string, direction: 'next' | 'previous') {
  reviewEntry.current = { fileId, direction }
  window.dispatchEvent(new CustomEvent('ramu:review-enter', { detail: { fileId } }))
}
// Last measured height per file, so an editor that is remounted after scrolling away does not jump the page.
const flowHeights = new Map<string, number>()
export interface InlineReviewBlock {
  key: string
  side: 'old' | 'new'
  line: number
  content: ReactNode
}
export function ReviewDiff({
  file,
  comments,
  onSelect,
  onComment,
  flow = false,
  inlineBlocks = [],
  sideBySide: layout,
  visible = true,
}: {
  file: ChangeFile
  comments: ReviewComment[]
  onSelect: (side: 'old' | 'new', line: number, endLine: number) => void
  onComment?: (side: 'old' | 'new', line: number, endLine: number) => void
  flow?: boolean
  inlineBlocks?: InlineReviewBlock[]
  sideBySide?: boolean
  visible?: boolean
}) {
  useLanguage()
  const { preferences } = useAppSettings()
  const [localSideBySide, setSideBySide] = useState(true),
    [hasChanges, setHasChanges] = useState(false),
    [computed, setComputed] = useState(false),
    [height, setHeight] = useState(() => flowHeights.get(file.id) ?? 300),
    [capped, setCapped] = useState(false)
  const sideBySide = layout ?? localSideBySide
  const [lineChanges, setLineChanges] = useState<monaco.editor.ILineChange[]>([])
  const changeIndex = useRef(-1)
  const viewState = useRef<monaco.editor.IDiffEditorViewState | null>(null)
  const [zoneHosts, setZoneHosts] = useState<Map<string, HTMLElement>>(new Map())
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const near = useNearViewport(host, visible)
  const [requested, setRequested] = useState(false)
  const visited = useRef(false)
  if (near || requested) visited.current = true
  // Lazily create a diff once, then retain it while this tab is visible.
  // Rebuilding it at viewport edges clears its canvas and recomputes heights.
  const mounted = visible && visited.current
  const pendingLine = useRef<{ side: 'old' | 'new'; line: number; endLine: number } | null>(null)
  const pendingNavigation = useRef<'next' | 'previous' | null>(null)
  useEffect(() => {
    if (near) setRequested(false)
  }, [near])
  const clearZones = useRef<(() => void) | null>(null)
  const activeSide = useRef<'old' | 'new'>('new')
  const navigateRef = useRef<(direction: 'next' | 'previous') => void>(() => {}),
    commentRef = useRef<(side: 'old' | 'new') => void>(() => {})
  const handlers = useRef({ onSelect, onComment, inlineBlocks })
  handlers.current = { onSelect, onComment, inlineBlocks }
  const selection = (side: 'old' | 'new') => {
    const pane = side === 'old' ? editor.current?.getOriginalEditor() : editor.current?.getModifiedEditor(),
      range = pane?.getSelection()
    if (range)
      return {
        side,
        line: range.startLineNumber,
        endLine:
          range.endColumn === 1 && range.endLineNumber > range.startLineNumber
            ? range.endLineNumber - 1
            : range.endLineNumber,
      }
    return null
  }
  const comment = (side: 'old' | 'new') => {
    const range = selection(side)
    if (range) handlers.current.onComment?.(range.side, range.line, range.endLine)
  }
  const size = () => {
    const diff = editor.current
    if (!flow || !diff) return
    // A big diff scrolls inside its own bounded box instead of stretching the page, so the layout and sticky headings stay stable.
    const content = Math.max(
        100,
        diff.getOriginalEditor().getContentHeight(),
        diff.getModifiedEditor().getContentHeight(),
      ),
      next = Math.min(content, Math.max(320, Math.round(window.innerHeight * 0.8)))
    flowHeights.set(file.id, next)
    setHeight(next)
    setCapped(content > next)
  }
  useLayoutEffect(() => {
    if (!mounted) return
    setComputed(false)
    const original = monaco.editor.createModel(
        file.oldContent,
        undefined,
        monaco.Uri.from({ scheme: 'inmemory', path: `/${crypto.randomUUID()}/${file.path}` }),
      ),
      modified = monaco.editor.createModel(file.newContent, original.getLanguageId())
    const diff = monaco.editor.createDiffEditor(host.current!, {
      theme: editorThemeName(),
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
      glyphMargin: true,
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 4,
      folding: false,
      overviewRulerLanes: 0,
      minimap: { enabled: false },
      fontSize: preferences.editorFontSize,
      lineHeight: Math.round(preferences.editorFontSize * 1.6),
      // A review is read-only: no caret, bracket boxes or current-line band competing with the changes.
      renderLineHighlight: 'none',
      matchBrackets: 'never',
      guides: { indentation: false, bracketPairs: false },
      cursorStyle: 'line-thin',
      cursorBlinking: 'solid',
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      accessibilityVerbose: true,
      scrollBeyondLastLine: false,
      ...(flow
        ? {
            hideUnchangedRegions: { enabled: true, contextLineCount: 4, minimumLineCount: 10, revealLineCount: 20 },
            scrollbar: { vertical: 'hidden', alwaysConsumeMouseWheel: false },
          }
        : {}),
    })
    const viewModel = diff.createViewModel({ original, modified })
    diff.setModel(viewModel)
    editor.current = diff
    if (viewState.current) diff.restoreViewState(viewState.current)
    const updated = diff.onDidUpdateDiff(() => {
      const changes = diff.getLineChanges() ?? []
      setHasChanges(!!changes.length)
      setComputed(true)
      setLineChanges((previous) => (JSON.stringify(previous) === JSON.stringify(changes) ? previous : changes))
      size()
    })
    const disposables = [
      ['old', diff.getOriginalEditor()] as const,
      ['new', diff.getModifiedEditor()] as const,
    ].flatMap(([side, pane]) => {
      const hover = pane.createDecorationsCollection()
      let anchor: number | null = null,
        lastAnchor: number | null = null,
        endpoint = 1
      const highlight = (start: number, end: number) =>
        pane.setSelection(
          new monaco.Selection(
            Math.min(start, end),
            1,
            Math.max(start, end),
            pane.getModel()!.getLineMaxColumn(Math.max(start, end)),
          ),
        )
      const up = () => {
        if (anchor !== null) {
          const start = anchor
          anchor = null
          handlers.current.onComment?.(side, Math.min(start, endpoint), Math.max(start, endpoint))
        }
      }
      window.addEventListener('mouseup', up)
      const unregister = onComment ? reviewCommentMenu(pane, () => comment(side)) : () => {}
      return [
        pane.onDidContentSizeChange(size),
        pane.onDidChangeCursorSelection(() => {
          const range = selection(side)
          if (range) handlers.current.onSelect(range.side, range.line, range.endLine)
        }),
        pane.onMouseDown((event) => {
          activeSide.current = side
          if (!onComment || event.event.browserEvent.button !== 0 || !event.target.position) return
          if (
            event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
            event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
          ) {
            event.event.preventDefault()
            const line = event.target.position.lineNumber
            anchor = event.event.shiftKey && lastAnchor !== null ? lastAnchor : line
            lastAnchor = anchor
            endpoint = line
            highlight(anchor, line)
          }
        }),
        pane.onMouseMove((event) => {
          if (!onComment || !event.target.position) return
          const line = event.target.position.lineNumber
          if (anchor !== null) {
            endpoint = line
            highlight(anchor, line)
          } else
            hover.set([
              {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  glyphMarginClassName: 'review-add-glyph',
                  glyphMarginHoverMessage: { value: 'Click or drag to comment on lines' },
                },
              },
            ])
        }),
        pane.onMouseLeave(() => hover.clear()),
        {
          dispose: () => {
            window.removeEventListener('mouseup', up)
            unregister()
            hover.clear()
          },
        },
      ]
    })
    size()
    return () => {
      viewState.current = diff.saveViewState()
      clearZones.current?.()
      clearZones.current = null
      updated.dispose()
      disposables.forEach((d) => d.dispose())
      // Cancel the owning view model before releasing text models. Monaco's implicit
      // model release can defer cancellation past a rapid viewport/tab teardown.
      // A Monaco disposal error must not leak the text models or leave a dead editor behind while scrolling.
      try {
        diff.setModel(null)
        viewModel.dispose()
        diff.dispose()
      } catch (error) {
        console.warn('Review diff teardown failed', (error as { errors?: unknown[] }).errors ?? error)
      } finally {
        editor.current = null
        original.dispose()
        modified.dispose()
      }
    }
  }, [file.id, flow, mounted])
  useLayoutEffect(() => {
    // Cached off-screen editors retain their models and rendered surface,
    // but need not observe every intermediate pane width while resizing.
    const diff = editor.current
    if (!diff) return
    const active = near || requested
    diff.updateOptions({ automaticLayout: active })
    if (active) diff.layout()
  }, [near, requested, mounted])
  useLayoutEffect(() => {
    editor.current?.updateOptions({
      renderSideBySide: sideBySide,
      fontSize: preferences.editorFontSize,
      lineHeight: Math.round(preferences.editorFontSize * 1.6),
    })
    size()
  }, [sideBySide, preferences.editorFontSize, mounted])
  useLayoutEffect(() => {
    if (flow)
      editor.current?.updateOptions({
        scrollbar: { vertical: capped ? 'auto' : 'hidden', alwaysConsumeMouseWheel: false },
      })
  }, [capped, flow, mounted])
  const zoneSpec = inlineBlocks.map((block) => `${block.key}:${block.side}:${block.line}`).join('|')
  useLayoutEffect(() => {
    const diff = editor.current
    if (!diff) return
    const nodes = new Map<string, HTMLElement>()
    const accessibility = new Map<HTMLElement, string | null>()
    const disposables = handlers.current.inlineBlocks.map((block) => {
      const pane = block.side === 'old' && sideBySide ? diff.getOriginalEditor() : diff.getModifiedEditor()
      const line = block.side === 'old' && !sideBySide ? afterLineForBefore(block.line, lineChanges) : block.line
      const wrapper = document.createElement('div'),
        body = document.createElement('div')
      wrapper.className = 'review-inline-zone'
      body.className = 'review-inline-body'
      wrapper.append(body)
      // Keep discussion width tied to the visible pane, not the code's scroll width.
      const resize = () => {
        body.style.width = `${pane.getLayoutInfo().contentWidth}px`
      }
      resize()
      const layoutListener = pane.onDidLayoutChange(resize)
      const zone: monaco.editor.IViewZone = {
        afterLineNumber: Math.min(line, pane.getModel()!.getLineCount()),
        heightInPx: 100,
        domNode: wrapper,
        suppressMouseDown: false,
        showInHiddenAreas: true,
      }
      let zoneId = ''
      pane.changeViewZones((accessor) => {
        zoneId = accessor.addZone(zone)
      })
      // Monaco hides view zones from assistive technology; these zones contain real forms.
      const parent = wrapper.parentElement
      if (parent) {
        if (!accessibility.has(parent)) accessibility.set(parent, parent.getAttribute('aria-hidden'))
        parent.removeAttribute('aria-hidden')
      }
      const observer = new ResizeObserver(() => {
        const next = Math.ceil(body.getBoundingClientRect().height) + 16
        if (next !== zone.heightInPx) {
          zone.heightInPx = next
          pane.changeViewZones((accessor) => accessor.layoutZone(zoneId))
          size()
        }
      })
      observer.observe(body)
      nodes.set(block.key, body)
      return () => {
        observer.disconnect()
        layoutListener.dispose()
        pane.changeViewZones((accessor) => accessor.removeZone(zoneId))
      }
    })
    setZoneHosts(nodes)
    size()
    let cleared = false
    const cleanup = () => {
      if (cleared) return
      cleared = true
      disposables.forEach((dispose) => dispose())
      accessibility.forEach((hidden, parent) => {
        if (hidden === null) parent.removeAttribute('aria-hidden')
        else parent.setAttribute('aria-hidden', hidden)
      })
    }
    clearZones.current = cleanup
    return () => {
      cleanup()
      if (clearZones.current === cleanup) clearZones.current = null
    }
  }, [file.id, zoneSpec, sideBySide, lineChanges, mounted])
  const revealLine = (target: { side: 'old' | 'new'; line: number; endLine: number }) => {
    if (!editor.current?.getLineChanges()) {
      pendingLine.current = target
      setRequested(true)
      return
    }
    const pane = target.side === 'old' ? editor.current.getOriginalEditor() : editor.current.getModifiedEditor()
    pane.setSelection(
      new monaco.Range(target.line, 1, target.endLine, pane.getModel()!.getLineMaxColumn(target.endLine)),
    )
    pane.revealLineInCenter(target.line)
    pane.focus()
    if (flow && host.current) {
      const root = host.current.closest('.changes-page')
      if (root)
        root.scrollBy({
          top:
            host.current.getBoundingClientRect().top -
            root.getBoundingClientRect().top +
            pane.getTopForLineNumber(target.line) -
            100,
          behavior: 'smooth',
        })
    }
  }
  useEffect(() => {
    const reveal = (event: Event) => {
      const target = (event as CustomEvent).detail
      if (target?.fileId === file.id) revealLine(target)
    }
    window.addEventListener('ramu:review-line', reveal)
    return () => window.removeEventListener('ramu:review-line', reveal)
  }, [file.id, flow])
  useEffect(() => {
    const diff = editor.current
    if (!diff) return
    const collections = [['old', diff.getOriginalEditor()] as const, ['new', diff.getModifiedEditor()] as const].map(
      ([side, pane]) =>
        pane.createDecorationsCollection(
          comments
            .filter((c) => c.side === side && c.scope !== 'file' && c.state !== 'resolved')
            .map((c) => ({
              range: new monaco.Range(c.line, 1, c.endLine, 1),
              options: {
                isWholeLine: true,
                className: 'review-comment-line',
                glyphMarginClassName: 'review-comment-glyph',
                glyphMarginHoverMessage: { value: `${c.author === 'ai' ? 'AI' : 'You'}: ${c.text}` },
              },
            })),
        ),
    )
    return () => collections.forEach((c) => c.clear())
  }, [comments, mounted])
  useEffect(() => {
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.fileId === file.id && !detail.handled) {
        detail.handled = true
        if (!editor.current) {
          pendingNavigation.current = detail.direction
          setRequested(true)
        } else navigateRef.current(detail.direction)
      }
    }
    const onComment = (event: Event) => {
      if ((event as CustomEvent).detail?.fileId === file.id) commentRef.current(activeSide.current)
    }
    window.addEventListener('ramu:review-nav', onNav)
    window.addEventListener('ramu:review-comment-selection', onComment)
    return () => {
      window.removeEventListener('ramu:review-nav', onNav)
      window.removeEventListener('ramu:review-comment-selection', onComment)
    }
  }, [file.id])
  const goToChange = (index: number) => {
    changeIndex.current = index
    const line = Math.max(1, lineChanges[index]!.modifiedStartLineNumber)
    window.dispatchEvent(
      new CustomEvent('ramu:review-line', { detail: { fileId: file.id, side: 'new', line, endLine: line } }),
    )
  }
  // Past the last change of a file, keep going in the next one; ReviewFileCards in Changes.tsx pick the neighbouring file.
  const leaveFile = (direction: 'next' | 'previous') =>
    window.dispatchEvent(new CustomEvent('ramu:review-nav-file', { detail: { fileId: file.id, direction } }))
  const navigate = (direction: 'next' | 'previous') => {
    if (!editor.current?.getLineChanges()) {
      pendingNavigation.current = direction
      setRequested(true)
      return
    }
    if (!flow) {
      editor.current?.goToDiff(direction)
      return
    }
    if (!lineChanges.length) {
      leaveFile(direction)
      return
    }
    const last = lineChanges.length - 1,
      next =
        changeIndex.current < 0
          ? direction === 'next'
            ? 0
            : last
          : changeIndex.current + (direction === 'next' ? 1 : -1)
    if (next < 0 || next > last) leaveFile(direction)
    else goToChange(next)
  }
  const enter = () => {
    const entry = reviewEntry.current
    if (!entry || entry.fileId !== file.id || !computed) return
    reviewEntry.current = null
    if (lineChanges.length) goToChange(entry.direction === 'next' ? 0 : lineChanges.length - 1)
  }
  const enterRef = useRef(enter)
  enterRef.current = enter
  useEffect(() => {
    if (!editor.current) return
    if (pendingLine.current) {
      const target = pendingLine.current
      pendingLine.current = null
      revealLine(target)
    }
    if (pendingNavigation.current && computed) {
      const direction = pendingNavigation.current
      pendingNavigation.current = null
      navigateRef.current(direction)
    }
  }, [mounted, computed, lineChanges])
  useEffect(() => {
    enterRef.current()
  }, [computed, lineChanges, file.id])
  useEffect(() => {
    const onEnter = (event: Event) => {
      if ((event as CustomEvent).detail?.fileId === file.id) enterRef.current()
    }
    window.addEventListener('ramu:review-enter', onEnter)
    return () => window.removeEventListener('ramu:review-enter', onEnter)
  }, [file.id])
  navigateRef.current = navigate
  commentRef.current = comment
  return (
    <div className={`review-diff-wrap${flow ? ' flowing-diff' : ''}`}>
      <div className="review-diff-controls [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground [.review-diff-wrap.flowing-diff_>_&]:hidden flex items-center gap-[5px] p-[5px_10px] [border-bottom:1px_solid_var(--line)] bg-card">
        {layout === undefined && (
          <div role="group" aria-label={t('Diff layout')}>
            <Button
              variant="ghost"
              size="sm"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
              aria-pressed={!sideBySide}
              onClick={() => setSideBySide(false)}
            >
              {t('Inline')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
              aria-pressed={sideBySide}
              onClick={() => setSideBySide(true)}
            >
              {t('Split')}
            </Button>
          </div>
        )}
        {onComment && (
          <Button
            variant="ghost"
            size="sm"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
            onClick={() => comment(activeSide.current)}
          >
            <MessageSquarePlus size={13} />
            {t('Comment on selection')}
          </Button>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        <Button
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
          aria-label={t('Previous change')}
          disabled={!hasChanges}
          onClick={() => navigate('previous')}
        >
          <ChevronUp size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
          aria-label={t('Next change')}
          disabled={!hasChanges}
          onClick={() => navigate('next')}
        >
          <ChevronDown size={14} />
        </Button>
      </div>
      <div
        ref={host}
        className="review-diff [.pair-review_&]:h-[clamp(280px,_45vh,_600px)] [.pair-review_.flowing-diff_&]:min-h-[100px] h-[410px] w-full"
        style={flow ? { height } : undefined}
        aria-label={t('Changes to {0}', { '0': file.path })}
      />
      {mounted &&
        inlineBlocks.map((block) => {
          const target = zoneHosts.get(block.key)
          return target
            ? createPortal(
                <div
                  className="review-inline-interaction min-w-0 whitespace-normal [overflow-wrap:anywhere]"
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {block.content}
                </div>,
                target,
                block.key,
              )
            : null
        })}
    </div>
  )
}
