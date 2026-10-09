import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppSettings } from '../AppSettings'
import { invoke, ramu } from '../ipc'
import { errorText } from '../TaskPane'

export function TerminalView({ taskId, repoId, label, active, onExit, actions, initialCommand }: { taskId: string; repoId: string | null; label: string; active: boolean; onExit?: () => void; actions?: ReactNode; initialCommand?: string }) {
  const { preferences } = useAppSettings()
  const terminal = useRef<Terminal | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  useEffect(() => {
    if (terminal.current) { terminal.current.options.fontSize = preferences.terminalFontSize; fitRef.current?.fit() }
  }, [preferences.terminalFontSize])

  useEffect(() => {
    const term = new Terminal({
      fontSize: preferences.terminalFontSize,
      fontFamily: '"SF Mono", Menlo, "Geist Mono Variable", monospace',
      lineHeight: 1.25,
      theme: { background: '#1c1c1e', cursor: '#72b4ff', selectionBackground: '#72b4ff35' },
      cursorBlink: true,
      screenReaderMode: true,
      scrollback: 5000,
    })
    terminal.current = term
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(host.current!)
    let termId: string | null = null
    let disposed = false
    const offs: (() => void)[] = []

    // A terminal view restored after restart gets a new shell; say so instead of pretending it survived.
    const cols = Math.max(term.cols, 2), rows = Math.max(term.rows, 2)
    const opening = initialCommand ? invoke('term.openSetup', cols, rows) : invoke('term.open', taskId, repoId, cols, rows)
    void opening.then(
      (info) => {
        if (disposed) return void invoke('term.close', info.id)
        termId = info.id
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
        const input = term.onData((d) => termId && void invoke('term.write', termId, d).catch((e) => setError(errorText(e))))
        const resize = term.onResize(({ cols, rows }) => termId && void invoke('term.resize', termId, Math.max(2, cols), Math.max(2, rows)).catch((e) => setError(errorText(e))))
        offs.push(() => input.dispose(), () => resize.dispose())
        fit.fit()
        if (initialCommand) {
          term.focus()
          void invoke('term.write', info.id, `${initialCommand}\r`).catch((e) => setError(errorText(e)))
        }
      },
      (e) => setError(errorText(e)),
    )

    const ro = new ResizeObserver(() => {
      if (host.current?.offsetParent) fit.fit()
    })
    ro.observe(host.current!)

    return () => {
      disposed = true
      ro.disconnect()
      for (const off of offs) off()
      if (termId) void invoke('term.close', termId)
      term.dispose()
    }
  }, [taskId, repoId, initialCommand])

  useEffect(() => {
    if (active) requestAnimationFrame(() => {
      fitRef.current?.fit()
    })
  }, [active])

  return (
    <div className="terminal-view">
      <div className="view-header">
        <span className="strong" title={cwd ?? undefined}>{label}</span>
        <span className="grow" />{actions}
      </div>
      {error && <div className="error banner">{error}</div>}
      <div ref={host} className="terminal-host" onContextMenu={(event) => {
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
      }} />
    </div>
  )
}
