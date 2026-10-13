import { useLayoutEffect, useRef, useState } from 'react'
import type { SearchMatch } from '../../../shared/types'
import { searchSnippet } from '../../../shared/searchSnippet'

/** Match-centered snippets adapt to sidebar resizing and the user's chosen font. */
export function SearchMatchPreview({ match, fontSize, fontFamily }: { match: SearchMatch; fontSize: number; fontFamily: string }) {
  const host = useRef<HTMLSpanElement>(null)
  const [before, setBefore] = useState('…')
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return
    let disposed = false
    const update = () => {
      if (disposed || !element.clientWidth) return
      const style = getComputedStyle(element)
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const spacing = parseFloat(style.letterSpacing) || 0
      const measure = (text: string) => context.measureText(text).width + Array.from(text).length * spacing
      setBefore(searchSnippet(match.text, match.start, match.end, element.clientWidth, measure, match.column - 1 > match.start).before)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    document.fonts.addEventListener('loadingdone', update)
    void document.fonts.ready.then(update)
    return () => { disposed = true; observer.disconnect(); document.fonts.removeEventListener('loadingdone', update) }
  }, [match.text, match.start, match.end, match.column, fontSize, fontFamily])
  return <span ref={host} className="search-match-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre text-control">{before}<mark>{match.text.slice(match.start, match.end) || ' '}</mark>{match.text.slice(match.end)}</span>
}
