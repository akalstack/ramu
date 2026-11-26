// Runs inside the bundled terminal surface; no host credentials or network calls.
// Selecting text the way chat does: a long press picks the word under the finger, the phone draws handles at both ends
// to stretch it, and a tap anywhere else lets it go. xterm draws the text itself, so the system's own selection cannot
// reach it; this keeps the selection in xterm and tells the phone where its ends are on screen.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- injected into the terminal bundle as source text by gen-terminal.mjs
function installTerminalSelect(term, post, blocks, terminalBlockAt) {
  const LIMIT = 200000
  // Ends are buffer cells, inclusive; `start` always comes first.
  let selection = null
  let applying = false
  let frame = 0
  const buffer = () => term.buffer.active
  function grid() {
    const screen = term.element && term.element.querySelector('.xterm-screen')
    if (!screen) return null
    const rect = screen.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return { left: rect.left, top: rect.top, width: rect.width / term.cols, height: rect.height / term.rows }
  }
  /** The buffer cell under a point, clamped to the rows on screen; `shift` moves it by part of a cell. */
  function cellAt(x, y, shift = 0) {
    const size = grid()
    if (!size) return null
    const col = Math.max(0, Math.min(term.cols - 1, Math.floor((x - size.left) / size.width + shift)))
    const row = Math.max(0, Math.min(term.rows - 1, Math.floor((y - size.top) / size.height)))
    return { col, row: buffer().viewportY + row }
  }
  const before = (a, b) => a.row < b.row || (a.row === b.row && a.col <= b.col)
  function apply() {
    if (!selection) return
    const { start, end } = selection
    applying = true
    term.select(start.col, start.row, (end.row - start.row) * term.cols + end.col - start.col + 1)
    applying = false
    report()
  }
  /** Where the ends sit on screen, for the phone's handles and menu; an end scrolled out of view has no point. */
  function report() {
    if (!selection) return post({ kind: 'selection', active: false })
    const size = grid()
    if (!size) return
    const top = buffer().viewportY
    const point = (cell, after) => {
      const row = cell.row - top
      if (row < 0 || row >= term.rows) return null
      return {
        x: size.left + (cell.col + (after ? 1 : 0)) * size.width,
        y: size.top + row * size.height,
      }
    }
    const ranges = blocks.blocks()
    const block = ranges.length ? terminalBlockAt(ranges, selection.start.row) : null
    const text = term.getSelection()
    post({
      kind: 'selection',
      active: true,
      text: text.length > LIMIT ? text.slice(0, LIMIT) : text,
      start: point(selection.start, false),
      end: point(selection.end, true),
      lineHeight: size.height,
      // Offered only when picking the command would select more than what is already selected.
      block:
        !!block && (block.start !== selection.start.row || block.end !== selection.end.row || selection.start.col > 0),
    })
  }
  function clear() {
    if (!selection) return
    selection = null
    anchor = null
    term.clearSelection()
    report()
  }
  /** A long press: the run of non-blank characters under the finger, as a terminal word holds paths and links whole. */
  function selectWordAt(x, y) {
    const cell = cellAt(x, y)
    if (!cell) return
    const line = buffer().getLine(cell.row)
    const text = line ? line.translateToString(false) : ''
    const blank = (col) => !text[col] || /\s/.test(text[col])
    if (blank(cell.col)) return clear()
    let start = cell.col,
      end = cell.col
    while (start > 0 && !blank(start - 1)) start--
    while (end < term.cols - 1 && !blank(end + 1)) end++
    selection = { start: { col: start, row: cell.row }, end: { col: end, row: cell.row } }
    apply()
  }
  // The end that stays put while a handle is dragged, fixed when the drag begins: past it the two swap, as the
  // system's handles do, and the finger keeps the handle it holds.
  let anchor = null
  function grab(handle) {
    anchor = selection ? (handle === 'start' ? selection.end : selection.start) : null
  }
  function moveHandle(handle, x, y) {
    if (!selection || !anchor) return
    // The end handle sits after its last character, so it takes the character whose middle is left of the finger.
    const target = cellAt(x, y, handle === 'end' ? -0.5 : 0)
    if (!target) return
    selection = before(target, anchor) ? { start: target, end: anchor } : { start: anchor, end: target }
    apply()
  }
  function selectBlock() {
    if (!selection) return
    const ranges = blocks.blocks()
    const block = ranges.length ? terminalBlockAt(ranges, selection.start.row) : null
    if (!block) return
    selection = { start: { col: 0, row: block.start }, end: { col: term.cols - 1, row: block.end } }
    apply()
  }
  function selectAll() {
    const last = buffer().length - 1
    if (last < 0) return
    selection = { start: { col: 0, row: 0 }, end: { col: term.cols - 1, row: last } }
    apply()
  }
  // Output, scrolling and resizing move the text under the handles.
  const follow = () => {
    if (!selection || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      report()
    })
  }
  term.onRender(follow)
  term.onScroll(follow)
  term.onResize(() => clear())
  term.onSelectionChange(() => {
    // xterm let it go itself (a click, the cursor gesture taking over), so the handles go too.
    if (!applying && selection && !term.hasSelection()) {
      selection = null
      report()
    }
  })
  // A touch anywhere on the terminal lets the selection go; a long press there then picks a new word.
  document.addEventListener('pointerdown', () => clear(), true)
  function receive(event) {
    let value
    try {
      value = JSON.parse(event.data)
    } catch {
      return
    }
    if (value.kind === 'selection-grab' && (value.handle === 'start' || value.handle === 'end')) grab(value.handle)
    if (value.kind === 'selection-move' && (value.handle === 'start' || value.handle === 'end')) {
      if (Number.isFinite(value.x) && Number.isFinite(value.y)) moveHandle(value.handle, value.x, value.y)
    }
    if (value.kind === 'selection-clear') clear()
    if (value.kind === 'selection-all') selectAll()
    if (value.kind === 'selection-block') selectBlock()
  }
  window.addEventListener('message', receive)
  document.addEventListener('message', receive)
  return { selectWordAt }
}
