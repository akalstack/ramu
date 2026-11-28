import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { SquarePen, MessageCircle, Quote } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatKeys } from '../../../commands'
import { createPortal } from 'react-dom'
import { SELECTION_ACTION_CLASS } from '../styles'

/** Selected chat text gets a split button: Quote into the message box, or Ask aside without touching the chat. */
export function SelectionActions({
  scroller,
  onQuote,
  onQuoteNew,
  onAside,
  readOnly = false,
}: {
  readOnly?: boolean
  scroller: React.RefObject<HTMLDivElement | null>
  onQuote: (text: string) => void
  onQuoteNew: (text: string) => void
  onAside: (text: string, from: 'assistant' | 'user') => void
}) {
  useLanguage()
  const [pick, setPick] = useState<{ text: string; from: 'assistant' | 'user'; top: number; left: number } | null>(null)
  useEffect(() => {
    let pressing = false
    const read = () => {
      const selection = document.getSelection(),
        el = scroller.current
      if (!selection || selection.isCollapsed || !selection.rangeCount || !el?.checkVisibility()) return setPick(null)
      const range = selection.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return setPick(null)
      const text = selection.toString().trim()
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      if (!text || !start?.closest('.msg')) return setPick(null)
      const rect = range.getBoundingClientRect(),
        frame = el.getBoundingClientRect()
      // Above the selection, or below it when there is no room under the header.
      const top = rect.top - 40 < frame.top ? rect.bottom + 8 : rect.top - 40
      const left = Math.min(Math.max(rect.left + rect.width / 2, frame.left + 110), frame.right - 110)
      setPick({ text: text.slice(0, 20_000), from: start.closest('.msg.user') ? 'user' : 'assistant', top, left })
    }
    const change = () => {
      if (!pressing) read()
    }
    const down = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.('.selection-actions')) {
        pressing = true
        setPick(null)
      }
    }
    const up = () => {
      if (pressing) {
        pressing = false
        requestAnimationFrame(read)
      }
    }
    const hide = () => setPick(null)
    // Heard from the document: the transcript draws a new scroller for each thread it shows.
    const scrolled = (event: Event) => {
      if (event.target === scroller.current) hide()
    }
    document.addEventListener('selectionchange', change)
    document.addEventListener('mousedown', down)
    document.addEventListener('mouseup', up)
    document.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('selectionchange', change)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', hide)
    }
  }, [scroller])
  const quote = () => {
    if (pick) {
      onQuote(pick.text)
      document.getSelection()?.removeAllRanges()
      setPick(null)
    }
  }
  const quoteNew = () => {
    if (pick) {
      onQuoteNew(pick.text)
      document.getSelection()?.removeAllRanges()
      setPick(null)
    }
  }
  const aside = () => {
    if (readOnly) return
    if (pick) {
      onAside(pick.text, pick.from)
      document.getSelection()?.removeAllRanges()
      setPick(null)
    }
  }
  useEffect(() => {
    if (!pick) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPick(null)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      if (event.code === 'KeyQ') {
        event.preventDefault()
        event.stopPropagation()
        quote()
      }
      if (event.code === 'KeyA') {
        event.preventDefault()
        event.stopPropagation()
        aside()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [pick, readOnly] by design; the values it reads beyond these are current as of that run
  }, [pick, readOnly])
  if (!pick) return null
  // Pressing a half must not clear the selection it acts on.
  return createPortal(
    <div
      className="selection-actions fixed z-1150 [translate:-50%_0] inline-flex items-center h-[30px] p-[0_2px] [border:1px_solid_var(--edge)] rounded-full [background:color-mix(in_srgb,_var(--raised-2)_92%,_transparent)] [-webkit-backdrop-filter:blur(16px)] [backdrop-filter:blur(16px)] [box-shadow:0_8px_24px_rgba(0,_0,_0,_0.4)] [animation:pop_0.1s_var(--ease)]"
      role="toolbar"
      aria-label={translate('Selected text')}
      style={{ top: pick.top, left: pick.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="secondary"
        type="button"
        className={SELECTION_ACTION_CLASS}
        title={translate('Quote in your message ({0})', { '0': formatKeys('mod+shift+q') })}
        onClick={quote}
      >
        <Quote size={13} />
        {translate('Quote')}
      </Button>
      <Button
        variant="secondary"
        type="button"
        className={SELECTION_ACTION_CLASS}
        title={translate('Start a new thread with this quoted')}
        onClick={quoteNew}
      >
        <SquarePen size={13} />
        {translate('Quote in new thread')}
      </Button>
      <span className="selection-divider w-px h-4 [background:var(--line-strong)] flex-none" aria-hidden="true" />
      <Button
        variant="secondary"
        type="button"
        className={SELECTION_ACTION_CLASS}
        title={translate('Ask a side question without interrupting the thread ({0})', {
          '0': formatKeys('mod+shift+a'),
        })}
        disabled={readOnly}
        onClick={aside}
      >
        <MessageCircle size={13} />
        {translate('Ask aside')}
      </Button>
    </div>,
    document.body,
  )
}
