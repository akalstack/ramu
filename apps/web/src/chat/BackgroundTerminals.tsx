import { useEffect, useRef, useState } from 'react'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import { Button } from '@/components/desktop-button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { canForceStop, isLiveTerminal, readBackgroundTerminals } from './backgroundTerminalState'

/** Thread-scoped entry for persistent commands; quiet until the thread has some, and still there once the agent is idle. */
export function BackgroundTerminals({ taskId }: { taskId: string }) {
  useLanguage()
  const { id: hostId, invoke, status } = useHost()
  const runtime = useHostRuntime()
  const ws = useWorkspace()
  const scope = `${hostId}:${taskId}`
  const [reading, setReading] = useState({ scope, terminals: [] as BackgroundTerminalInfo[], stale: false })
  const latest = useRef(reading)
  latest.current = reading
  const refresh = useRef<{ scope: string; run: () => Promise<void> } | null>(null)
  const terminals = reading.scope === scope ? reading.terminals : []
  const stale = reading.scope !== scope || reading.stale || status !== 'connected'
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
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

  if (!terminals.length) return null
  const live = terminals.filter(isLiveTerminal).length
  const stateLabel = (terminal: BackgroundTerminalInfo) =>
    ({
      running: t('Running'),
      stopping: t('Stopping'),
      exited: t('Exited'),
      failed: t('Failed'),
      unknown: t('Unknown'),
    })[terminal.state]
  const stop = async (terminal: BackgroundTerminalInfo, force: boolean) => {
    setError(null)
    try {
      await invoke('term.background.stop', taskId, terminal.id, force)
    } catch (e) {
      setError(errorText(e))
    }
    if (refresh.current?.scope === scope) void refresh.current.run()
  }
  // Opens the existing terminal view for this command; closing that view later leaves the command running.
  const open = (terminal: BackgroundTerminalInfo) => {
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

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="text-caption" />}>
        {t('{0} background terminals', { 0: live || terminals.length })}
      </PopoverTrigger>
      <PopoverContent className="flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 p-2">
        <PopoverHeader>
          <PopoverTitle>{t('Background terminals')}</PopoverTitle>
        </PopoverHeader>
        {stale && <p className="text-caption text-muted-foreground">{t('Offline · last-known activity')}</p>}
        {error && (
          <p role="alert" className="text-caption text-bad">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {terminals.map((terminal) => (
            <li key={terminal.id} className="flex flex-col gap-1 rounded-md border p-2">
              <code className="truncate text-caption" title={terminal.command}>
                {terminal.command}
              </code>
              <span className="text-caption text-muted-foreground">
                {stateLabel(terminal)}
                {terminal.exitCode !== null && terminal.state !== 'running'
                  ? ` · ${t('Exit code {0}', { 0: terminal.exitCode })}`
                  : ''}
                {' · '}
                {new Date(terminal.startedAt).toLocaleTimeString()}
              </span>
              {terminal.state === 'unknown' && (
                <p className="text-caption text-muted-foreground">
                  {t('Command status cannot be verified. Saved output is available.')}
                </p>
              )}
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={stale} onClick={() => open(terminal)}>
                  {t('Open output')}
                </Button>
                {isLiveTerminal(terminal) && terminal.capabilities.stop && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || terminal.state === 'stopping'}
                    aria-label={t('Stop {0}', { 0: terminal.command })}
                    onClick={() => void stop(terminal, false)}
                  >
                    {t('Stop')}
                  </Button>
                )}
                {canForceStop(terminal) && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={stale}
                    title={t('Force stop ends the command immediately without letting it clean up.')}
                    onClick={() => void stop(terminal, true)}
                  >
                    {t('Force stop')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
