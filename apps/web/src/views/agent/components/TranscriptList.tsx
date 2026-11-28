import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { LegendList, type LegendListRef, type MaintainScrollAtEndOptions } from '@legendapp/list/react'
import { t as translate, useLanguage } from '../../../i18n'
import { scrollMotion } from '../../../workspace/panelMotion'
import { NEAR_BOTTOM_PX } from '../constants'
import { awayFromEnd, gestured, newFollowIntent, pressed, scrolled } from '../lib/followIntent'
import { transcriptOpening, type TranscriptAnchor, type TranscriptRow } from '../lib/transcriptRows'
import { TRANSCRIPT_COLUMN_CLASS, TRANSCRIPT_VIEWPORT_CLASS } from '../styles'
import { ScrollToLatestButton } from './ScrollToLatestButton'

/** Every way the end can move: new rows, rows growing as a reply streams or folding, and the viewport resizing. */
const FOLLOW_END = {
  animated: false,
  on: { dataChange: true, itemLayout: true, footerLayout: true, layout: true },
} as const satisfies MaintainScrollAtEndOptions
/** Rows added above, and rows above taking their real height as they are drawn, leave the view where it is. */
const KEEP_IN_VIEW = { data: true, size: true }
/** Rows start at about this height until drawn; a turn is often taller. */
const ESTIMATED_ROW_PX = 160
/** The padding the reading column had at its top and bottom, drawn as the list's own header and footer. */
const FOOTER = <div aria-hidden className="h-7" />

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
const rowKeyOf = (node: Node | null) =>
  (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-transcript-row]')?.dataset
    .transcriptRow
const keyOf = (row: TranscriptRow) => row.key
/** Rows of one kind (turns, pending messages) share a size estimate. */
const typeOf = (row: TranscriptRow) => row.key.split(':')[0]

/**
 * The thread's transcript, drawn as a virtualized list: only the rows near the view are in the page. It opens at the
 * end, or where the reader left it, and stays hidden until it has landed there. It keeps the latest output in view
 * while the reader is at the end and lets go only when they move away themselves (see followIntent), and rows added
 * above, such as earlier turns, leave what is being read where it is.
 *
 * Rows that are kept in the page while off screen: every row while `everything` is set (Find searches the page),
 * `pinned`, rows the reader has touched (what they opened or typed into stays as they left it) and rows a text
 * selection spans.
 */
export function TranscriptList({
  rows,
  header,
  initial,
  stick,
  anchor,
  everything,
  pinned,
  working,
  scrollToEnd,
  onViewport,
}: {
  rows: TranscriptRow[]
  header: ReactNode
  /** Where the reader left this thread, if they did. */
  initial: { stick: boolean; anchor?: TranscriptAnchor } | undefined
  /** Kept current for the chat view: whether the reader is near the end, and the row they are reading. */
  stick: RefObject<boolean>
  anchor: RefObject<TranscriptAnchor | undefined>
  everything: boolean
  pinned: string | null
  working: boolean
  /** Receives the action that scrolls to the end and follows from there. */
  scrollToEnd: Ref<() => void>
  onViewport: (element: HTMLDivElement | null) => void
}) {
  useLanguage()
  const list = useRef<LegendListRef | null>(null)
  const [opening] = useState(() => transcriptOpening(rows, initial))
  const intent = useRef({ ...newFollowIntent(), released: !opening.end })
  const [following, setFollowing] = useState(opening.end)
  const [away, setAway] = useState(false)
  const [ready, setReady] = useState(false)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [touched, setTouched] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])

  // Heard on the way down from the document, so the reader's part is known before the list hears the scroll.
  useLayoutEffect(() => {
    if (!viewport) return
    const state = intent.current
    state.lastTop = viewport.scrollTop
    const gap = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const sync = () => {
      setFollowing(!state.released)
      setAway(awayFromEnd(state, gap()))
    }
    const inside = (event: Event) => event.target instanceof Node && viewport.contains(event.target)
    const onWheel = (event: WheelEvent) => {
      if (!inside(event) || event.ctrlKey) return
      gestured(state, { kind: 'wheel', deltaY: event.deltaY })
      sync()
    }
    const onTouch = (event: Event) => {
      if (!inside(event)) return
      gestured(state, { kind: 'touch' })
      sync()
    }
    const onScroll = (event: Event) => {
      if (event.target !== viewport) return
      const left = gap()
      scrolled(state, viewport.scrollTop, left, performance.now())
      stick.current = left < NEAR_BOTTOM_PX
      const reading = list.current?.anchorVisibleContent({ hold: false })
      if (reading) anchor.current = reading
      sync()
    }
    const onDown = () => pressed(state, performance.now(), 'down')
    const onUp = () => pressed(state, performance.now(), 'up')
    const onKey = (event: KeyboardEvent) => {
      if (!editable(event.target)) pressed(state, performance.now())
    }
    const listen = { capture: true, passive: true }
    document.addEventListener('wheel', onWheel, listen)
    document.addEventListener('touchmove', onTouch, listen)
    document.addEventListener('scroll', onScroll, listen)
    window.addEventListener('pointerdown', onDown, listen)
    window.addEventListener('pointerup', onUp, listen)
    window.addEventListener('pointercancel', onUp, listen)
    document.addEventListener('keydown', onKey, listen)
    // Growth while the reader is away shows the button even though nothing scrolled.
    const stopSizes = list.current?.getState().listen('totalSize', sync)
    // The list lets go of the end by itself on a move it took for the reader's (the browser clamping the scroll as
    // rows fold); only the reader lets go here, so it goes back.
    const stopFollow = list.current?.getState().listen('isFollowingEnd', (value) => {
      if (!value && !state.released) void list.current?.scrollToEnd({ animated: false })
    })
    return () => {
      document.removeEventListener('wheel', onWheel, listen)
      document.removeEventListener('touchmove', onTouch, listen)
      document.removeEventListener('scroll', onScroll, listen)
      window.removeEventListener('pointerdown', onDown, listen)
      window.removeEventListener('pointerup', onUp, listen)
      window.removeEventListener('pointercancel', onUp, listen)
      document.removeEventListener('keydown', onKey, listen)
      stopSizes?.()
      stopFollow?.()
    }
  }, [viewport, stick, anchor])

  // Back at the end after the list stopped following (content shrank to meet the view, say): it follows again.
  useLayoutEffect(() => {
    if (following && list.current && !list.current.getState().isFollowingEnd)
      void list.current.scrollToEnd({ animated: false })
  }, [following])

  const toEnd = () => {
    intent.current.released = false
    setFollowing(true)
    setAway(false)
    void list.current?.scrollToEnd({ animated: scrollMotion() === 'smooth' })
  }
  useImperativeHandle(scrollToEnd, () => toEnd)

  // Whatever the reader opened, typed into or pressed in a row lives in that row, so the row stays in the page.
  useEffect(() => {
    if (!viewport) return
    const touch = (event: Event) => {
      const key = rowKeyOf(event.target as Node | null)
      if (key) setTouched((keys) => (keys.includes(key) ? keys : [...keys, key]))
    }
    viewport.addEventListener('pointerdown', touch, true)
    viewport.addEventListener('focusin', touch, true)
    return () => {
      viewport.removeEventListener('pointerdown', touch, true)
      viewport.removeEventListener('focusin', touch, true)
    }
  }, [viewport])

  // A row leaving the page would take a selection's end with it.
  useEffect(() => {
    if (!viewport) return
    const update = () => {
      const selection = document.getSelection()
      const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null
      const keys =
        range && range.intersectsNode(viewport)
          ? [rowKeyOf(range.startContainer), rowKeyOf(range.endContainer)].filter((key) => key !== undefined)
          : []
      setSelected((current) =>
        current.length === keys.length && current.every((key, i) => key === keys[i]) ? current : keys,
      )
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [viewport])

  // Stable, so the list hands over its scroller once rather than on every render.
  const attach = useCallback(
    (handle: LegendListRef | null) => {
      list.current = handle
      const element = (handle?.getScrollableNode() ?? null) as HTMLDivElement | null
      setViewport(element)
      onViewport(element)
    },
    [onViewport],
  )
  const indexOf = new Map(rows.map((row, index) => [row.key, index]))
  const spanned = selected.map((key) => indexOf.get(key)).filter((index) => index !== undefined)
  const keep = [
    ...touched,
    ...(pinned ? [pinned] : []),
    ...(spanned.length ? rows.slice(Math.min(...spanned), Math.max(...spanned) + 1).map(keyOf) : []),
  ]

  return (
    <>
      <LegendList<TranscriptRow>
        ref={attach}
        data={rows}
        keyExtractor={keyOf}
        getItemType={typeOf}
        // The reading column's 14px between rows: the list places rows itself, so a CSS gap would not reach them, and
        // its own gap leaves one more below the last row.
        renderItem={({ item, index }) => (
          <div data-transcript-row={item.key} className={index ? 'min-w-0 pt-3.5' : 'min-w-0'}>
            {item.render()}
          </div>
        )}
        estimatedItemSize={ESTIMATED_ROW_PX}
        initialScrollAtEnd={opening.end}
        {...(opening.end ? {} : { initialScrollIndex: { index: opening.index, viewOffset: opening.viewOffset } })}
        alwaysRender={everything ? { top: rows.length } : { keys: keep }}
        maintainScrollAtEnd={following ? FOLLOW_END : false}
        maintainScrollAtEndThreshold={1}
        maintainVisibleContentPosition={KEEP_IN_VIEW}
        onReady={() => setReady(true)}
        ListHeaderComponent={<div className="pt-3">{header}</div>}
        ListFooterComponent={FOOTER}
        contentContainerClassName={TRANSCRIPT_COLUMN_CLASS}
        role="region"
        tabIndex={0}
        aria-label={translate('Conversation')}
        // Hidden until it has landed where it opens, so the jump there is never seen.
        className={`size-full min-h-0 min-w-0 scroll-fade-b overscroll-contain contain-content ${TRANSCRIPT_VIEWPORT_CLASS} ${ready ? '' : 'invisible'}`}
      />
      <ScrollToLatestButton working={working} active={away} onClick={toEnd} />
    </>
  )
}
