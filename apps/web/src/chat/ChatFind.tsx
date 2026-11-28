import { t, useLanguage } from '../i18n'
import { Button } from '@/components/desktop-button'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { SearchInput } from '../SearchInput'
import { scrollMotion } from '../workspace/panelMotion'
import { releaseFollow } from '../views/agent/hooks/useTranscriptScroll'

declare global {
  // The CSS Custom Highlight API is in Electron's Chromium but not yet in the TypeScript DOM types.
  interface Window {
    Highlight?: new (...ranges: Range[]) => unknown
  }
}

/**
 * Find in the conversation: highlights every match in the text of `root`, steps through them, and scrolls to the
 * current one. The transcript draws every loaded row while this is open, so matches off screen are found too.
 */
export function ChatFind({
  root,
  focusRequest = 0,
  initialQuery,
  onClose,
}: {
  root: RefObject<HTMLElement | null>
  focusRequest?: number
  /** Filled in when a chat is opened from Search chats. */ initialQuery?: string
  onClose: () => void
}) {
  useLanguage()
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const ranges = useRef<Range[]>([])
  const input = useRef<HTMLInputElement>(null)
  // ⌘F again while open goes back to the field and selects the query, as in a browser.
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery)
      setCurrent(0)
    }
    input.current?.focus()
    input.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [focusRequest] by design; the values it reads beyond these are current as of that run
  }, [focusRequest])

  const scan = () => {
    const el = root.current,
      highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    ranges.current = []
    const needle = query.trim().toLowerCase()
    if (el && needle) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest('.chat-find-bar, script, style')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      })
      for (let node = walker.nextNode(); node && ranges.current.length < 2000; node = walker.nextNode()) {
        const text = node.textContent?.toLowerCase() ?? ''
        for (
          let at = text.indexOf(needle);
          at >= 0 && ranges.current.length < 2000;
          at = text.indexOf(needle, at + needle.length)
        ) {
          const range = new Range()
          range.setStart(node, at)
          range.setEnd(node, at + needle.length)
          ranges.current.push(range)
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
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(scan, 150)
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [query] by design; the values it reads beyond these are current as of that run
  }, [query])
  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const range = ranges.current[current]
    if (highlights && window.Highlight)
      highlights.set('chat-find-current', range ? new window.Highlight(range) : new window.Highlight())
    const match = range?.startContainer.parentElement
    // A match found while the agent writes stays in view instead of the chat returning to the latest output.
    if (match) releaseFollow(root.current)
    match?.scrollIntoView({ block: 'center', behavior: scrollMotion() })
  }, [current, count, query, root])
  useEffect(
    () => () => {
      const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
      highlights?.delete('chat-find')
      highlights?.delete('chat-find-current')
    },
    [],
  )

  const step = (delta: number) => {
    if (count) setCurrent((value) => (value + delta + count) % count)
  }
  return (
    <div
      className="chat-find-bar absolute top-2 right-3 z-5 flex items-center gap-1 w-[420px] max-w-[calc(100%_-_24px)] m-0 p-1 [border:1px_solid_var(--edge)] rounded-(--radius-m) bg-raised [box-shadow:var(--shadow-float)] [animation:fade-only_120ms_var(--ease)] [&_.search-input]:flex-1 [&_.search-input]:min-w-0 [&_.search-input]:bg-transparent! [&_.search-input]:border-transparent! [&_.search-input]:ring-0! [&_.search-input]:shadow-none"
      role="search"
    >
      <SearchInput
        ref={input}
        aria-label={t('Find in conversation')}
        placeholder={t('Find in conversation')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setCurrent(0)
        }}
        onClear={() => setQuery('')}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      />
      <span
        className="chat-find-count min-w-[44px] text-right whitespace-nowrap muted text-muted-foreground small text-caption"
        aria-live="polite"
      >
        {query.trim() ? (count ? t('{0} of {1}', { '0': current + 1, '1': count }) : t('No results')) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
        aria-label={t('Previous match')}
        title={t('Previous (⇧Enter)')}
        disabled={!count}
        onClick={() => step(-1)}
      >
        <ChevronUp size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
        aria-label={t('Next match')}
        title={t('Next (Enter)')}
        disabled={!count}
        onClick={() => step(1)}
      >
        <ChevronDown size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
        aria-label={t('Close find')}
        title={t('Close (Esc)')}
        onClick={onClose}
      >
        <X size={14} />
      </Button>
    </div>
  )
}
