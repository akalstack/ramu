import { t, useLanguage } from './i18n'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { SearchInput } from './SearchInput'

declare global {
  // The CSS Custom Highlight API is in Electron's Chromium but not yet in the TypeScript DOM types.
  interface Window { Highlight?: new (...ranges: Range[]) => unknown }
}

/** Find in the conversation: highlights every match in the visible text, steps through them, and scrolls to the current one. */
export function ChatFind({ root, focusRequest = 0, initialQuery, onClose }: { root: RefObject<HTMLElement | null>; focusRequest?: number; /** Filled in when a chat is opened from Search chats. */ initialQuery?: string; onClose: () => void }) {
  useLanguage()
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const ranges = useRef<Range[]>([])
  const input = useRef<HTMLInputElement>(null)
  // ⌘F again while open goes back to the field and selects the query, as in a browser.
  useEffect(() => {
    if (initialQuery) { setQuery(initialQuery); setCurrent(0) }
    input.current?.focus(); input.current?.select()
  }, [focusRequest])

  const scan = () => {
    const el = root.current, highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    ranges.current = []
    const needle = query.trim().toLowerCase()
    if (el && needle) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (node) => node.parentElement?.closest('.chat-find-bar, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT })
      for (let node = walker.nextNode(); node && ranges.current.length < 2000; node = walker.nextNode()) {
        const text = node.textContent?.toLowerCase() ?? ''
        for (let at = text.indexOf(needle); at >= 0 && ranges.current.length < 2000; at = text.indexOf(needle, at + needle.length)) {
          const range = new Range(); range.setStart(node, at); range.setEnd(node, at + needle.length); ranges.current.push(range)
        }
      }
    }
    setCount(ranges.current.length)
    setCurrent((value) => Math.min(value, Math.max(0, ranges.current.length - 1)))
    if (highlights && window.Highlight) highlights.set('chat-find', new window.Highlight(...ranges.current))
  }
  // Re-scan when the query changes or the conversation changes underneath (new text, folded sections opening).
  useEffect(() => {
    scan()
    const el = root.current
    if (!el) return
    let timer = 0
    const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(scan, 150) })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [query])
  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const range = ranges.current[current]
    if (highlights && window.Highlight) highlights.set('chat-find-current', range ? new window.Highlight(range) : new window.Highlight())
    range?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [current, count, query])
  useEffect(() => () => { const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights; highlights?.delete('chat-find'); highlights?.delete('chat-find-current') }, [])

  const step = (delta: number) => { if (count) setCurrent((value) => (value + delta + count) % count) }
  return <div className="chat-find-bar" role="search">
    <SearchInput ref={input} aria-label={t("Find in conversation")} placeholder={t("Find in conversation")} value={query} onChange={(event) => { setQuery(event.target.value); setCurrent(0) }} onClear={() => setQuery('')}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1) } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }} />
    <span className="chat-find-count muted small" aria-live="polite">{query.trim() ? (count ? t("{0} of {1}", { "0": current + 1, "1": count }) : t("No results")) : ''}</span>
    <Button className="ghost icon small-icon" aria-label={t("Previous match")} title={t("Previous (⇧Enter)")} disabled={!count} onClick={() => step(-1)}><ChevronUp size={14} /></Button>
    <Button className="ghost icon small-icon" aria-label={t("Next match")} title={t("Next (Enter)")} disabled={!count} onClick={() => step(1)}><ChevronDown size={14} /></Button>
    <Button className="ghost icon small-icon" aria-label={t("Close find")} title={t("Close (Esc)")} onClick={onClose}><X size={14} /></Button>
  </div>
}
