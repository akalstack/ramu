import { useCallback, useEffect, useState } from 'react'
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
  const { invoke } = useHost()
  const runtime = useHostRuntime()
  const ws = useWorkspace()
  const [terminals, setTerminals] = useState<BackgroundTerminalInfo[]>([])
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await readBackgroundTerminals(invoke as never, taskId, terminals)
    setTerminals(next.terminals)
    setStale(next.stale)
  }, [invoke, taskId, terminals])
  useEffect(() => {
    void refresh()
    const off = runtime.on('term:changed', (event) => {
      if (event.taskId === taskId) void refresh()
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, runtime])

  if (!terminals.length) return null
  const live = terminals.filter(isLiveTerminal).length
  const stateLabel = (terminal: BackgroundTerminalInfo) =>
    ({
      running: t('Running'),
      stopping: t('Stopping'),
      exited: t('Exited'),
      failed: t('Failed'),
    })[terminal.state]
  const stop = async (terminal: BackgroundTerminalInfo, force: boolean) => {
    setError(null)
    try {
      await invoke('term.background.stop', taskId, terminal.id, force)
    } catch (e) {
      setError(errorText(e))
    }
    void refresh()
  }
  // Opens the existing terminal view for this command; closing that view later leaves the command running.
  const open = (terminal: BackgroundTerminalInfo) => {
    if (!runtime.terminals.allShells().includes(terminal.id)) runtime.terminals.queueAdopt(taskId, terminal.id)
    const shown = ws.taskUi[taskId]?.views.find(
      (view) => view.kind === 'terminal' && runtime.terminals.shellOf(view.id) === terminal.id,
    )
    if (shown) ws.activateView(taskId, shown.id)
    else ws.openView(taskId, { kind: 'terminal', ...(terminal.repoId ? { repoId: terminal.repoId } : {}) })
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
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={stale} onClick={() => open(terminal)}>
                  {t('Open output')}
                </Button>
                {isLiveTerminal(terminal) && (
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
