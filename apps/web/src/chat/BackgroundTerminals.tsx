import { keepReading, lastReading } from '../lib/lastReading'
import { RowButton } from '@/components/row-button'
import { useEffect, useRef, useState } from 'react'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import type { AgentTask } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { SquareTerminal } from 'lucide-react'
import { ComposerTraySection, TRAY_LIST_CLASS } from '../composer/ComposerTraySection'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { ConfirmStopDialog } from './ConfirmStopDialog'
import { canForceStop, readBackgroundTerminals } from './backgroundTerminalState'

/** A thread's persistent commands, kept current from the host; the thread's tray shows them once there are some. */
export function useBackgroundTerminals(taskId: string | undefined) {
  useLanguage()
  const { id: hostId, invoke, status } = useHost()
  const runtime = useHostRuntime()
  const ws = useWorkspace()
  const scope = `${hostId}:${taskId ?? ''}`
  const [reading, setReading] = useState({ scope, terminals: [] as BackgroundTerminalInfo[], stale: false })
  const latest = useRef(reading)
  latest.current = reading
  const refresh = useRef<{ scope: string; run: () => Promise<void> } | null>(null)
  const terminals =
    reading.scope === scope ? reading.terminals : (lastReading<BackgroundTerminalInfo[]>('terminals', scope) ?? [])
  const stale = reading.scope !== scope || reading.stale || status !== 'connected'
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ terminal: BackgroundTerminalInfo; force: boolean } | null>(null)

  useEffect(() => {
    setError(null)
    if (!taskId) return
    let active = true
    let revision = 0
    let previous = latest.current.scope === scope ? latest.current.terminals : []
    const load = async () => {
      const mine = ++revision
      const next = await readBackgroundTerminals(invoke as never, taskId, previous)
      if (!active || mine !== revision) return
      previous = next.terminals
      keepReading('terminals', scope, next.terminals)
      setReading({ scope, ...next })
    }
    refresh.current = { scope, run: load }
    void load()
    const off = runtime.on('term:changed', (event) => {
      if (event.taskId === taskId) void load()
    })
    return () => {
      active = false
      off()
    }
  }, [scope, taskId, runtime, invoke, status])

  const stop = async (terminal: BackgroundTerminalInfo, force: boolean) => {
    setError(null)
    try {
      await invoke('term.background.stop', taskId!, terminal.id, force)
    } catch (e) {
      setError(errorText(e))
    }
    if (refresh.current?.scope === scope) void refresh.current.run()
  }
  // Opens the existing terminal view for this command; closing that view later leaves the command running.
  const open = (terminal: BackgroundTerminalInfo) => {
    if (!taskId) return
    const shown = ws.taskUi[taskId]?.views.find(
      (view) =>
        view.kind === 'terminal' &&
        (view.backgroundId === terminal.id || runtime.terminals.shellOf(view.id) === terminal.id),
    )
    if (shown) ws.activateView(taskId, shown.id)
    else
      ws.openView(taskId, {
        kind: 'terminal',
        backgroundId: terminal.id,
        ...(terminal.repoId ? { repoId: terminal.repoId } : {}),
      })
  }
  return { terminals, stale, error, confirming, setConfirming, stop, open }
}

/**
 * The thread's running commands as a tray section, shown while there are some, even once the agent is idle: Ramu's
 * background terminals, and the commands the provider itself moved to the background (`commands`), which the provider
 * runs, so they open with their output and stop through the agent.
 */
export function BackgroundTerminalsSection({
  state,
  commands = [],
  readOnly = false,
  onOpenCommand,
  onStopCommand,
}: {
  state: ReturnType<typeof useBackgroundTerminals>
  commands?: AgentTask[]
  readOnly?: boolean
  onOpenCommand?: (task: AgentTask) => void
  onStopCommand?: (task: AgentTask) => void
}) {
  useLanguage()
  const { terminals, stale, error, confirming, setConfirming, stop, open } = state
  const stateLabel = (terminal: BackgroundTerminalInfo) => t(terminal.state === 'stopping' ? 'Stopping' : 'Running')
  return (
    <>
      <ConfirmStopDialog
        command={confirming?.terminal.command ?? null}
        force={confirming?.force}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void stop(confirming.terminal, confirming.force)
          setConfirming(null)
        }}
      />
      <ComposerTraySection
        aria-label={t('Background terminals')}
        title={t('Background terminals')}
        chip={t('Terminals')}
        count={terminals.length + commands.length}
        icon={<SquareTerminal />}
        actions={
          stale && <span className="text-muted-foreground text-caption">{t('Offline · last-known activity')}</span>
        }
      >
        {error && (
          <p role="alert" className="m-0 px-2 pb-1 text-caption text-bad">
            {error}
          </p>
        )}
        <ul className={TRAY_LIST_CLASS}>
          {terminals.map((terminal) => (
            <li key={terminal.id} className="flex min-h-8 items-center gap-2 text-control">
              <RowButton
                size="sm"
                stacked
                className="w-auto flex-1 min-w-0 px-1.5 py-1"
                disabled={stale}
                title={t('Open output')}
                onClick={() => open(terminal)}
              >
                <code className="w-full truncate text-foreground" title={terminal.command}>
                  {terminal.command}
                </code>
                <span className="text-caption text-muted-foreground">
                  {terminal.agentWaiting && <span className="text-foreground">{t('Agent is waiting')} · </span>}
                  {stateLabel(terminal)}
                  {terminal.startedBy ? ` · ${t('Started by a sub-agent')}` : ''}
                  {terminal.stoppedBy
                    ? ` · ${t(terminal.stoppedBy === 'user' ? 'Stop requested by you' : 'Stop requested by agent')}`
                    : ''}
                </span>
              </RowButton>
              {terminal.capabilities.stop && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-6 px-2 py-0 text-caption"
                  disabled={stale || terminal.state === 'stopping'}
                  aria-label={t('Stop {0}', { 0: terminal.command })}
                  onClick={() => setConfirming({ terminal, force: false })}
                >
                  {t('Stop')}
                </Button>
              )}
              {canForceStop(terminal) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-6 px-2 py-0 text-caption text-bad"
                  disabled={stale}
                  title={t('Force stop ends the command immediately without letting it clean up.')}
                  onClick={() => setConfirming({ terminal, force: true })}
                >
                  {t('Force stop')}
                </Button>
              )}
            </li>
          ))}
          {commands.map((task) => (
            <li key={task.agentId} className="flex min-h-8 items-center gap-2 text-control">
              <RowButton
                size="sm"
                stacked
                className="w-auto flex-1 min-w-0 px-1.5 py-1"
                title={t('Open output')}
                onClick={() => onOpenCommand?.(task)}
              >
                <code className="w-full truncate text-foreground" title={task.name}>
                  {task.name}
                </code>
                <span className="text-caption text-muted-foreground">
                  {task.awaited && <span className="text-foreground">{t('Agent is waiting')} · </span>}
                  {t('Running')} · {t('Moved to the background')}
                </span>
              </RowButton>
              {onStopCommand && !readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-6 px-2 py-0 text-caption"
                  aria-label={t('Stop {0}', { 0: task.name })}
                  onClick={() => onStopCommand(task)}
                >
                  {t('Stop')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </ComposerTraySection>
    </>
  )
}
