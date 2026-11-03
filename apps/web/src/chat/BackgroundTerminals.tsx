import { RowButton } from '@/components/row-button'
import { useEffect, useRef, useState } from 'react'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import { Button } from '@/components/desktop-button'
import { SquareTerminal } from 'lucide-react'
import { ComposerTraySection } from '../composer/ComposerTraySection'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { ConfirmStopDialog } from './ConfirmStopDialog'
import { canForceStop, isLiveTerminal, readBackgroundTerminals } from './backgroundTerminalState'

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
  const terminals = reading.scope === scope ? reading.terminals : []
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

/** The thread's persistent commands as a tray section, quiet until it has some and still there once the agent is idle. */
export function BackgroundTerminalsSection({ state }: { state: ReturnType<typeof useBackgroundTerminals> }) {
  useLanguage()
  const { terminals, stale, error, confirming, setConfirming, stop, open } = state
  const live = terminals.filter(isLiveTerminal).length
  const stateLabel = (terminal: BackgroundTerminalInfo) =>
    ({
      running: t('Running'),
      stopping: t('Stopping'),
      exited: t('Exited'),
      failed: t('Failed'),
      unknown: t('Unknown'),
    })[terminal.state]
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
        title={
          <>
            {t('Background terminals')}{' '}
            <span className="text-muted-foreground tabular-nums">{live || terminals.length}</span>
          </>
        }
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
        <ul className="m-0 flex max-h-40 list-none flex-col overflow-y-auto overscroll-contain p-0">
          {terminals.map((terminal) => (
            <li key={terminal.id} className="flex min-h-8 items-center gap-2 text-control">
              <RowButton
                size="sm"
                stacked
                className="w-auto flex-1 min-w-0 -ml-2 px-2 py-1"
                disabled={stale}
                title={t('Open output')}
                onClick={() => open(terminal)}
              >
                <code className="w-full truncate text-foreground" title={terminal.command}>
                  {terminal.command}
                </code>
                <span className="text-caption text-muted-foreground">
                  {stateLabel(terminal)}
                  {terminal.startedBy ? ` · ${t('Started by a sub-agent')}` : ''}
                  {terminal.stoppedBy
                    ? ` · ${t(terminal.stoppedBy === 'user' ? 'Stop requested by you' : 'Stop requested by agent')}`
                    : ''}
                  {terminal.exitCode !== null && terminal.state !== 'running'
                    ? ` · ${t('Exit code {0}', { 0: terminal.exitCode })}`
                    : ''}
                  {terminal.state === 'unknown'
                    ? ` · ${t('Command status cannot be verified. Saved output is available.')}`
                    : ''}
                </span>
              </RowButton>
              {isLiveTerminal(terminal) && terminal.capabilities.stop && (
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
        </ul>
      </ComposerTraySection>
    </>
  )
}
