/** Coalesce resize bursts; explicitly flush final geometry when a drag ends. */
export function createTerminalResizeScheduler(send: (cols: number, rows: number) => void) {
  let size: { cols: number; rows: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!size || disposed) return
    const latest = size
    size = undefined
    send(latest.cols, latest.rows)
  }
  return {
    get pending() { return !!size },
    request(cols: number, rows: number) {
      if (disposed) return
      size = { cols: Math.max(2, cols), rows: Math.max(2, rows) }
      clearTimeout(timer)
      // Window resizing and other layout changes should not flood the PTY either.
      timer = setTimeout(flush, 100)
    },
    flush,
    dispose() { disposed = true; size = undefined; clearTimeout(timer) },
  }
}
