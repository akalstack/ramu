import { FitAddon } from '@xterm/addon-fit'
import { createTerminalResizeScheduler } from '../terminalResize'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppSettings } from '../AppSettings'
import { invoke, ramu } from '../ipc'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'
import { FILE_DRAG_TYPE } from '../ComposerSuggestions'
import { trackTerminal } from '../terminalRegistry'

const shellQuote = (path: string) => /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`

export function TerminalView({ viewId, taskId, repoId, label, active, onExit, actions, initialCommand, run }: { viewId?: string; taskId: string; repoId: string | null; label: string; active: boolean; onExit?: () => void; actions?: ReactNode; initialCommand?: string; /** Typed into the task's shell once it opens (project actions). */ run?: string }) {
  const { preferences } = useAppSettings()
  const ws = useWorkspace()
  const terminal = useRef<Terminal | null>(null)
  const renderer = useRef<WebglAddon | null>(null)
  const rendererLoss = useRef<{ dispose(): void } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const scheduleFitRef = useRef<(() => void) | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  // Read once: a project action runs when its terminal opens, never on a later re-render.
  const runOnce = useRef(run)

  useEffect(() => {
    if (terminal.current) { terminal.current.options.fontSize = preferences.terminalFontSize; scheduleFitRef.current?.() }
  }, [preferences.terminalFontSize])

  useEffect(() => {
    const term = new Terminal({
      fontSize: preferences.terminalFontSize,
      fontFamily: '"SF Mono", Menlo, "Geist Mono Variable", monospace',
      lineHeight: 1.25,
      theme: { background: '#141416', cursor: '#72b4ff', selectionBackground: '#72b4ff35' },
      cursorBlink: true,
      screenReaderMode: true,
      scrollback: 5000,
    })
    terminal.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    let termId: string | null = null
    let disposed = false
    const offs: (() => void)[] = []
    const dragging = () => !!document.querySelector('[data-separator="active"], [data-workspace-split][data-dragging]')
    const ptyResize = createTerminalResizeScheduler((cols, rows) => {
      if (termId) void invoke('term.resize', termId, cols, rows).catch((e) => setError(errorText(e)))
    })
    let fitFrame = 0
    let fitPending = false
    let flushOnFit = false
    const scheduleFit = () => {
      if (disposed) return
      fitPending = true
      if (fitFrame) return
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0
        if (disposed) return
        fitPending = false
        if (host.current?.offsetParent) fit.fit()
        if (flushOnFit) { flushOnFit = false; ptyResize.flush() }
      })
    }
    scheduleFitRef.current = scheduleFit
    const endResize = () => {
      if (fitPending || ptyResize.pending) { flushOnFit = true; scheduleFit() }
    }
    const release = new MutationObserver(() => { if (!dragging()) endResize() })
    release.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-separator', 'data-dragging'] })
    window.addEventListener('pointerup', endResize)
    window.addEventListener('pointercancel', endResize)
    // Install input before opening the shell so early typing is not dropped.
    let pendingInput = ''
    const input = term.onData((data) => {
      if (!termId) { pendingInput += data; return }
      void invoke('term.write', termId, data).catch((e) => setError(errorText(e)))
    })
    const resize = term.onResize(({ cols, rows }) => {
      if (termId) ptyResize.request(cols, rows)
    })
    offs.push(() => input.dispose(), () => resize.dispose())
    if (host.current?.offsetParent) fit.fit()

    // A terminal view restored after restart gets a new shell; say so instead of pretending it survived.
    const cols = Math.max(term.cols, 2), rows = Math.max(term.rows, 2)
    const opening = initialCommand ? invoke('term.openSetup', cols, rows) : invoke('term.open', taskId, repoId, cols, rows)
    void opening.then(
      (info) => {
        if (disposed) return void invoke('term.close', info.id)
        termId = info.id
        if (viewId) offs.push(trackTerminal(viewId, info.id))
        // Geometry may have changed while the shell was opening, before its
        // ID existed and resize notifications could be delivered.
        ptyResize.request(term.cols, term.rows)
        const openedAt = Date.now()
        setCwd(info.cwd)
        offs.push(ramu.on('term:data', ({ id, data }) => id === termId && term.write(data)))
        offs.push(
          ramu.on('term:exit', ({ id, code }) => {
            if (id !== termId) return
            // Like other editors, a shell that exits closes its tab. A shell that fails right away stays open so its error is readable.
            if (code !== 0 && Date.now() - openedAt < 1500) term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
            else exitRef.current?.()
          }),
        )
        scheduleFit()
        if (pendingInput) {
          void invoke('term.write', info.id, pendingInput).catch((e) => setError(errorText(e)))
          pendingInput = ''
        }
        const command = initialCommand ?? runOnce.current
        if (command) {
          term.focus()
          void invoke('term.write', info.id, `${command}\r`).catch((e) => setError(errorText(e)))
        }
      },
      (e) => setError(errorText(e)),
    )

    const ro = new ResizeObserver(scheduleFit)
    ro.observe(host.current!)

    return () => {
      disposed = true
      ro.disconnect()
      release.disconnect()
      cancelAnimationFrame(fitFrame)
      ptyResize.dispose()
      window.removeEventListener('pointerup', endResize)
      window.removeEventListener('pointercancel', endResize)
      scheduleFitRef.current = null
      for (const off of offs) off()
      if (termId) void invoke('term.close', termId)
      rendererLoss.current?.dispose()
      rendererLoss.current = null
      renderer.current?.dispose()
      renderer.current = null
      terminal.current = null
      term.dispose()
    }
  }, [taskId, repoId, initialCommand])

  useEffect(() => {
    const term = terminal.current
    if (!active || !term || renderer.current) return
    // Attach before the shell's first output. Delaying this lets the DOM
    // renderer measure every prompt glyph before it is replaced by WebGL.
    // Keep the GPU context when hiding/docking; dispose only on teardown/loss.
    const addon = new WebglAddon()
    const loss = addon.onContextLoss(() => {
      addon.dispose()
      loss.dispose()
      if (renderer.current === addon) {
        renderer.current = null
        rendererLoss.current = null
      }
    })
    try {
      term.loadAddon(addon)
      renderer.current = addon
      rendererLoss.current = loss
    } catch {
      loss.dispose()
      addon.dispose() // GPU unavailable: retain the working DOM renderer.
    }
  }, [active, taskId, repoId, initialCommand])

  useEffect(() => {
    if (active) scheduleFitRef.current?.()
  }, [active])

  return (
    <div className="terminal-view flex flex-col flex-1 min-h-0 min-w-0">
      <div className="view-header [&_.path]:flex-1 [&_button]:text-control [&_button]:p-[2px_8px] [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground flex gap-2.5 items-center h-8 p-[0_12px] flex-none min-w-0 text-control text-soft">
        <span className="strong font-semibold" title={cwd ?? undefined}>{label}</span>
        <span className="grow flex-1 min-w-0 text-left" />{actions}
      </div>
      {error && <div className="error text-bad banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control">{error}</div>}
      <div className="terminal-host [contain:layout_paint] flex flex-1 min-h-0 min-w-0 overflow-hidden p-[4px_0_0_12px]" onDragOver={(event) => {
        if (event.dataTransfer.types.includes(FILE_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
      }} onDrop={(event) => {
        // Dropped files and Explorer entries are typed into the shell as quoted absolute paths.
        const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE), files = [...event.dataTransfer.files]
        const paths: string[] = []
        if (dragged) {
          try {
            const item = JSON.parse(dragged) as { repoId?: string; path?: string; items?: { path: string }[] }
            const cwd = item.repoId ? ws.binding(taskId, item.repoId)?.cwd : undefined
            if (cwd) for (const entry of item.items?.length ? item.items : item.path ? [{ path: item.path }] : []) paths.push(`${cwd}/${entry.path}`)
          } catch { /* not ours */ }
        } else for (const file of files) { const path = ramu.pathForFile(file); if (path) paths.push(path) }
        if (!paths.length) return
        event.preventDefault()
        terminal.current?.paste(`${paths.map(shellQuote).join(' ')} `)
        terminal.current?.focus()
      }} onPointerDown={(event) => {
        // Padding has no native input target; keep the browser from blurring xterm after focus.
        if (!(event.target as HTMLElement).closest('.xterm')) event.preventDefault()
        terminal.current?.focus()
      }} onContextMenu={(event) => {
        event.preventDefault(); event.stopPropagation()
        const term = terminal.current
        if (!term) return
        void invoke('term.menu', term.getSelection(), { x: event.clientX, y: event.clientY }).then((action) => {
          if (action === 'selectAll') term.selectAll()
          else if (action === 'clear') term.clear()
          else if (action && typeof action === 'object') term.paste(action.paste)
        }, (error) => setError(errorText(error)))
      }} onKeyDown={(event) => {
        if (initialCommand && event.key === 'Escape') { event.stopPropagation(); return }
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        event.preventDefault(); event.stopPropagation()
        const term = terminal.current, rect = event.currentTarget.getBoundingClientRect()
        if (!term) return
        void invoke('term.menu', term.getSelection(), { x: rect.left + 12, y: rect.top + 12 }).then((action) => {
          if (action === 'selectAll') term.selectAll()
          else if (action === 'clear') term.clear()
          else if (action && typeof action === 'object') term.paste(action.paste)
        }, (error) => setError(errorText(error)))
      }}><div ref={host} className="flex-1 min-h-0 min-w-0 overflow-hidden" /></div>
    </div>
  )
}
