import { terminalTheme } from '../theme/terminalTheme'
import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { VIEW_ONLY_TERMINAL_NOTICE } from '../composer/viewerAccess'
import { FitAddon } from '@xterm/addon-fit'
import { createTerminalResizeScheduler } from '../workspace/terminalResize'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppSettings } from '../settings/AppSettings'
import { invoke as invokeHere, ramu } from '../ipc'
import { errorText } from '../workspace/TaskPane'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHost } from '../workspace/HostProvider'
import { unseenOutput } from '../workspace/terminalOutput'
import { t } from '../i18n'
import { FILE_DRAG_TYPE } from '../composer/ComposerSuggestions'
import { createOutputGate } from '../workspace/terminalActivity'
import { effectiveTheme, useEffectiveTheme } from '../theme/themes'
import { resolvedAppearance, useResolvedAppearance } from '../appearance'

const shellQuote = (path: string) => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`)

export function TerminalView({
  viewId,
  taskId,
  repoId,
  label,
  active,
  onExit,
  actions,
  initialCommand,
  backgroundId,
  run,
}: {
  viewId?: string
  taskId: string
  repoId: string | null
  label: string
  active: boolean
  onExit?: () => void
  actions?: ReactNode
  initialCommand?: string
  /** An inspect-only attachment target; losing it must never create a replacement shell. */
  backgroundId?: string
  /** Typed into the task's shell once it opens (project actions). */ run?: string
}) {
  const { preferences } = useAppSettings()
  const ws = useWorkspace()
  // This host's shells: its bound invoke, its terminal registry and output, and its Terminal-button dot.
  const { id: executionHost, status: hostStatus, invoke } = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const runtime = useHostRuntime()
  const { allShells, beginOpening, forgetTerminal, shellOf, takeAdopted, trackTerminal } = runtime.terminals
  const terminal = useRef<Terminal | null>(null)
  const renderer = useRef<WebglAddon | null>(null)
  const rendererLoss = useRef<{ dispose(): void } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const connectRef = useRef<(() => void) | null>(null)
  const scheduleFitRef = useRef<(() => void) | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  // Read once: a project action runs when its terminal opens, never on a later re-render.
  const runOnce = useRef(run)

  const appearance = useResolvedAppearance()
  const theme = useEffectiveTheme()
  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = terminalTheme(appearance, theme)
  }, [appearance, theme])

  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = preferences.terminalFontSize
      scheduleFitRef.current?.()
    }
  }, [preferences.terminalFontSize])

  useEffect(() => {
    const term = new Terminal({
      fontSize: preferences.terminalFontSize,
      fontFamily: '"SF Mono", Menlo, "Geist Mono Variable", monospace',
      lineHeight: 1.25,
      theme: terminalTheme(resolvedAppearance(), effectiveTheme()),
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
      if (termId && canWrite()) void invoke('term.resize', termId, cols, rows).catch((e) => setError(errorText(e)))
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
        if (flushOnFit) {
          flushOnFit = false
          ptyResize.flush()
        }
      })
    }
    scheduleFitRef.current = scheduleFit
    const endResize = () => {
      if (fitPending || ptyResize.pending) {
        flushOnFit = true
        scheduleFit()
      }
    }
    const release = new MutationObserver(() => {
      if (!dragging()) endResize()
    })
    release.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-separator', 'data-dragging'],
    })
    window.addEventListener('pointerup', endResize)
    window.addEventListener('pointercancel', endResize)
    // Install input before opening the shell so early typing is not dropped.
    let pendingInput = ''
    let readOnly = false
    const input = term.onData((data) => {
      if (readOnly || !canWrite()) return
      if (!termId) {
        pendingInput += data
        return
      }
      void invoke('term.write', termId, data).catch((e) => setError(errorText(e)))
    })
    const resize = term.onResize(({ cols, rows }) => {
      if (termId) ptyResize.request(cols, rows)
    })
    offs.push(
      () => input.dispose(),
      () => resize.dispose(),
    )
    if (host.current?.offsetParent) fit.fit()

    // A terminal view restored after restart gets a new shell; say so instead of pretending it survived.
    const cols = Math.max(term.cols, 2),
      rows = Math.max(term.rows, 2)
    // Back in this view after a project switch: reattach to the shell that kept running, with its output replayed.
    let replayed = 0
    let connecting = false
    const connect = () => {
      if (connecting || termId || disposed || !canWrite()) return
      connecting = true
      const reattach = (async () => {
        if (!canWrite()) throw new Error(t(VIEW_ONLY_TERMINAL_NOTICE))
        let known = backgroundId ?? (viewId && !initialCommand ? (shellOf(viewId) ?? takeAdopted(taskId)) : undefined)
        // A fresh view (after a restart, or one the phone opened) takes a live shell nobody shows yet before starting another.
        if (!known && viewId && !initialCommand) {
          const live = await invoke('term.list', taskId).catch(() => [])
          const shown = new Set(allShells())
          known = live.find(
            (entry) => !entry.exited && !entry.background && !shown.has(entry.id) && entry.repoId === repoId,
          )?.id
        }
        if (!canWrite()) throw new Error(t(VIEW_ONLY_TERMINAL_NOTICE))
        if (!known || disposed) return null
        // Claimed at once, so another view (or a second pass of this effect) cannot take the same shell.
        if (viewId) trackTerminal(viewId, known)
        const shell = known
        try {
          const snap = await invoke('term.snapshot', shell)
          if (!canWrite()) throw new Error(t(VIEW_ONLY_TERMINAL_NOTICE))
          const info = (await invoke('term.list', taskId)).find((entry) => entry.id === shell)
          // An ended persistent command still shows its final output instead of being replaced by a new shell.
          if (!info || (snap.exited && !info.background)) {
            if (backgroundId)
              throw new Error(
                t('This background command is unavailable. Reconnect or check its thread. No shell was started.'),
              )
            if (viewId) forgetTerminal(viewId, shell)
            return null
          }
          if (snap.cursor > snap.output.length)
            term.write(
              `\x1b[2m[${t('Showing the most recent terminal output. Older output was truncated.')}]\x1b[0m\r\n`,
            )
          term.write(snap.output)
          replayed = snap.cursor
          return info
        } catch {
          if (backgroundId)
            throw new Error(
              t('This background command is unavailable. Reconnect or check its thread. No shell was started.'),
            )
          if (viewId) forgetTerminal(viewId, shell)
          return null
        }
      })()
      const opening = reattach.then((info) => {
        if (info) return { info, resumed: true }
        if (backgroundId)
          throw new Error(
            t('This background command is unavailable. Reconnect or check its thread. No shell was started.'),
          )
        if (!canWrite() || disposed) throw new Error(t(VIEW_ONLY_TERMINAL_NOTICE))
        const settled = beginOpening(taskId)
        return (
          initialCommand ? invoke('term.openSetup', cols, rows) : invoke('term.open', taskId, repoId, cols, rows)
        ).then(
          (created) => {
            if (viewId) trackTerminal(viewId, created.id)
            settled()
            return { info: created, resumed: false }
          },
          (error) => {
            settled()
            throw error
          },
        )
      })
      void opening
        .then(
          ({ info, resumed }) => {
            // Only a shell this view created is cleaned up here; a resumed one belongs to its tab.
            if (disposed)
              return void (resumed
                ? undefined
                : viewId
                  ? trackTerminal(viewId, info.id)
                  : canWrite()
                    ? invoke('term.close', info.id).catch(() => {})
                    : undefined)
            termId = info.id
            readOnly = info.exited
            term.options.disableStdin = readOnly
            if (readOnly && info.background)
              term.write(`\r\n\x1b[2m[${t('Saved output · no live terminal is attached.')}]\x1b[0m\r\n`)
            if (viewId) trackTerminal(viewId, info.id)
            // Geometry may have changed while the shell was opening, before its
            // ID existed and resize notifications could be delivered.
            ptyResize.request(term.cols, term.rows)
            const openedAt = Date.now()
            setCwd(info.cwd)
            // Startup output (the prompt, rc files) doesn't earn the Terminal button's dot. Keystrokes count, not xterm's own replies to the shell.
            const gate = createOutputGate()
            offs.push(
              runtime.terminals.onData(info.id, (chunk) => {
                // Skip what the snapshot already showed; output held while the host was off screen may overlap it.
                const unseen = unseenOutput(chunk, replayed)
                if (!unseen) return
                if (unseen.reset)
                  term.write(
                    `\x1bc\x1b[2m[${t('Showing the most recent terminal output. Older output was truncated.')}]\x1b[0m\r\n`,
                  )
                term.write(unseen.data)
                replayed = chunk.cursor ?? replayed + unseen.data.length
                if (gate.output()) runtime.activity.markTerminalOutput(ws.workspaceOf(taskId))
              }),
            )
            // Output produced while the event stream was down never arrives as a chunk: when it comes back, fetch just the gap.
            offs.push(
              runtime.on('background:connection', ({ connected }) => {
                if (!connected || disposed || readOnly || !canWrite()) return
                void invoke('term.snapshot', info.id, replayed).then(
                  (snap) => {
                    if (disposed) return
                    const unseen = unseenOutput({ id: info.id, data: snap.output, cursor: snap.cursor }, replayed)
                    if (!unseen) return
                    // The host says it could not replay the gap, so the view starts again from what it still holds.
                    if (unseen.reset || snap.resume === 'snapshot')
                      term.write(
                        `\x1bc\x1b[2m[${t('Showing the most recent terminal output. Older output was truncated.')}]\x1b[0m\r\n`,
                      )
                    term.write(unseen.data)
                    replayed = snap.cursor
                  },
                  () => {},
                )
              }),
            )
            const typed = term.onKey(() => gate.arm())
            offs.push(() => typed.dispose())
            offs.push(
              runtime.terminals.onExit(info.id, (code) => {
                if (info.background) {
                  readOnly = true
                  term.options.disableStdin = true
                  term.write(`\r\n\x1b[2m[${t('Exit code {0}', { 0: code })}]\x1b[0m\r\n`)
                  return
                }
                // Like other editors, a shell that exits closes its tab. A shell that fails right away stays open so its error is readable.
                if (code !== 0 && Date.now() - openedAt < 1500)
                  term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
                else exitRef.current?.()
              }),
            )
            scheduleFit()
            if (pendingInput && !readOnly && canWrite()) {
              void invoke('term.write', info.id, pendingInput).catch((e) => setError(errorText(e)))
              pendingInput = ''
            }
            const command = resumed ? undefined : (initialCommand ?? runOnce.current)
            if (command && canWrite()) {
              gate.arm()
              term.focus()
              void invoke('term.write', info.id, `${command}\r`).catch((e) => setError(errorText(e)))
            }
          },
          (e) => setError(errorText(e)),
        )
        .finally(() => {
          connecting = false
        })
    }
    connectRef.current = connect
    connect()

    const ro = new ResizeObserver(scheduleFit)
    ro.observe(host.current!)

    return () => {
      disposed = true
      connectRef.current = null
      ro.disconnect()
      release.disconnect()
      cancelAnimationFrame(fitFrame)
      ptyResize.dispose()
      window.removeEventListener('pointerup', endResize)
      window.removeEventListener('pointercancel', endResize)
      scheduleFitRef.current = null
      for (const off of offs) off()
      // Tabs with a view id keep their shell on the host (see terminalRegistry); one-off setup shells do not.
      if (termId && !viewId && canWrite()) void invoke('term.close', termId).catch(() => {})
      rendererLoss.current?.dispose()
      rendererLoss.current = null
      renderer.current?.dispose()
      renderer.current = null
      terminal.current = null
      term.dispose()
    }
  }, [taskId, repoId, initialCommand, backgroundId, executionHost, canWrite])

  useEffect(() => {
    if (!viewOnly) connectRef.current?.()
  }, [viewOnly, hostStatus])

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
  }, [active, taskId, repoId, initialCommand, backgroundId, executionHost])

  useEffect(() => {
    if (active) scheduleFitRef.current?.()
  }, [active])

  return (
    <div className="terminal-view flex flex-col flex-1 min-h-0 min-w-0">
      <div className="view-header [&_.path]:flex-1 [&_button]:text-control [&_button]:p-[2px_8px] [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground flex gap-2.5 items-center h-8 p-[0_12px] flex-none min-w-0 text-control text-soft">
        <span className="strong font-semibold" title={cwd ?? undefined}>
          {label}
        </span>
        <span className="grow flex-1 min-w-0 text-left" />
        {actions}
      </div>
      {viewOnly && (
        <p role="status" className="m-0 p-3 text-control text-muted-foreground">
          {t(VIEW_ONLY_TERMINAL_NOTICE)}
        </p>
      )}
      {error && !viewOnly && (
        <div className="error text-bad banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control">
          {error}
        </div>
      )}
      <div
        hidden={viewOnly}
        inert={viewOnly}
        style={{ display: viewOnly ? 'none' : undefined }}
        className="terminal-host [contain:layout_paint] flex flex-1 min-h-0 min-w-0 overflow-hidden p-[4px_0_0_12px]"
        onDragOver={(event) => {
          if (!canWrite()) return
          if (event.dataTransfer.types.includes(FILE_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(event) => {
          if (!canWrite()) return
          // Dropped files and Explorer entries are typed into the shell as quoted absolute paths.
          const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE),
            files = [...event.dataTransfer.files]
          const paths: string[] = []
          if (dragged) {
            try {
              const item = JSON.parse(dragged) as { repoId?: string; path?: string; items?: { path: string }[] }
              const cwd = item.repoId ? ws.binding(taskId, item.repoId)?.cwd : undefined
              if (cwd)
                for (const entry of item.items?.length ? item.items : item.path ? [{ path: item.path }] : [])
                  paths.push(`${cwd}/${entry.path}`)
            } catch {
              /* not ours */
            }
          } else
            for (const file of files) {
              const path = ramu.pathForFile(file)
              if (path) paths.push(path)
            }
          if (!paths.length) return
          event.preventDefault()
          terminal.current?.paste(`${paths.map(shellQuote).join(' ')} `)
          terminal.current?.focus()
        }}
        onPointerDown={(event) => {
          // Padding has no native input target; keep the browser from blurring xterm after focus.
          if (!(event.target as HTMLElement).closest('.xterm')) event.preventDefault()
          terminal.current?.focus()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!canWrite()) return
          const term = terminal.current
          if (!term) return
          // The menu opens on this machine, so it goes through this window's own host.
          void invokeHere('term.menu', term.getSelection(), { x: event.clientX, y: event.clientY }).then(
            (action) => {
              if (!canWrite()) return
              if (action === 'selectAll') term.selectAll()
              else if (action === 'clear') term.clear()
              else if (action && typeof action === 'object') term.paste(action.paste)
            },
            (error) => setError(errorText(error)),
          )
        }}
        onKeyDown={(event) => {
          if (initialCommand && event.key === 'Escape') {
            event.stopPropagation()
            return
          }
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          event.stopPropagation()
          if (!canWrite()) return
          const term = terminal.current,
            rect = event.currentTarget.getBoundingClientRect()
          if (!term) return
          void invokeHere('term.menu', term.getSelection(), { x: rect.left + 12, y: rect.top + 12 }).then(
            (action) => {
              if (!canWrite()) return
              if (action === 'selectAll') term.selectAll()
              else if (action === 'clear') term.clear()
              else if (action && typeof action === 'object') term.paste(action.paste)
            },
            (error) => setError(errorText(error)),
          )
        }}
      >
        <div ref={host} className="flex-1 min-h-0 min-w-0 overflow-hidden" />
      </div>
    </div>
  )
}
