import { animateThreadListChange } from '../workspace/threadListMotion'
import { useEffect, useRef, useState } from 'react'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import type { Task } from '@ramu/shared/types'
import { readRemovalCommands, removalReview, removalError } from '@ramu/shared/chat/taskRemoval'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useHost } from '../workspace/HostProvider'

/** Deletion approval belongs to the displayed host/thread and the exact commands the host reported. */
export function DeleteThreadDialog({
  task,
  hostName,
  sharedWorktree,
  onDeleted,
  onCancel,
}: {
  task: Task
  hostName?: string
  sharedWorktree: boolean
  onDeleted: () => Promise<void>
  onCancel: () => void
}) {
  useLanguage()
  const host = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const scope = `${host.id}:${task.id}`
  const lastScope = useRef(scope)
  const latest = useRef(scope)
  latest.current = scope
  const [attempt, setAttempt] = useState(0)
  const [reading, setReading] = useState<{
    scope: string
    status: 'loading' | 'ready' | 'error'
    commands: BackgroundTerminalInfo[]
  }>({ scope, status: 'loading', commands: [] })
  const [removeWorktrees, setRemoveWorktrees] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (lastScope.current !== scope) {
      lastScope.current = scope
      setBusy(false)
      setError(null)
    }
    let active = true
    setReading({ scope, status: 'loading', commands: [] })
    if (viewOnly) return
    void readRemovalCommands(host.invoke, task.id)
      .then((commands) => {
        if (active) setReading({ scope, status: 'ready', commands })
      })
      .catch((reason) => {
        if (!active) return
        setReading({ scope, status: 'error', commands: [] })
        setError(errorText(reason))
      })
    return () => {
      active = false
    }
  }, [host.invoke, scope, task.id, attempt, viewOnly])
  const commands = reading.scope === scope ? reading.commands : []
  const unknown = commands.some((command) => command.state === 'unknown')
  const live = commands.some((command) => command.state !== 'unknown')
  const worktree = task.mode === 'worktree' && !sharedWorktree
  const removeFiles = worktree && removeWorktrees && !unknown
  return (
    <Dialog
      title={t('Delete “{0}”?', { 0: task.title })}
      confirmLabel={t(
        live
          ? unknown
            ? 'Stop known commands and delete thread'
            : 'Stop commands and delete thread'
          : unknown
            ? 'Delete thread and forget records'
            : 'Delete thread',
      )}
      confirmDisabled={viewOnly || reading.scope !== scope || reading.status !== 'ready' || host.status !== 'connected'}
      danger
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={() =>
        animateThreadListChange(async () => {
          if (!canWrite() || latest.current !== scope || reading.scope !== scope || reading.status !== 'ready') return
          const approvedScope = scope
          setBusy(true)
          setError(null)
          try {
            if (commands.length) await host.invoke('tasks.delete', task.id, removeFiles, removalReview(commands))
            else await host.invoke('tasks.delete', task.id, removeFiles)
            if (latest.current === approvedScope) await onDeleted()
          } catch (reason) {
            if (latest.current !== approvedScope) return
            setError(t(removalError(reason)))
            // Refresh the visible commands, but deletion always needs another explicit click.
            setAttempt((value) => value + 1)
          } finally {
            if (latest.current === approvedScope) setBusy(false)
          }
        })
      }
    >
      <p>{t('This removes the thread and its agent transcripts. Its running agents are stopped.')}</p>
      <p className="text-caption text-muted-foreground">{t('Host: {0}', { 0: hostName ?? host.id })}</p>
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      {host.status !== 'connected' && <p role="status">{t('Reconnect to this host before deleting the thread.')}</p>}
      {reading.status === 'loading' && <p role="status">{t('Checking background commands…')}</p>}
      {reading.status === 'error' && (
        <Button
          variant="outline"
          onClick={() => {
            setError(null)
            setAttempt((value) => value + 1)
          }}
        >
          {t('Try again')}
        </Button>
      )}
      {!!commands.length && (
        <>
          <ul className="my-2 max-h-48 overflow-auto space-y-1">
            {commands.map((command) => (
              <li key={command.id}>
                <code className="break-all text-caption">{command.command}</code>
                <span className="ml-2 text-muted-foreground">
                  {t(command.state === 'unknown' ? 'Unknown' : command.state === 'stopping' ? 'Stopping' : 'Running')}
                </span>
              </li>
            ))}
          </ul>
          {live && (
            <p>
              {t(
                'Background commands must stop before the thread is deleted. If one keeps running, the thread stays so you can inspect or force stop it.',
              )}
            </p>
          )}
          {unknown && (
            <p role="status">
              {t(
                'Commands with unknown status cannot be stopped from here. Deleting forgets their saved output and keeps the checkout files. Check those commands on the host.',
              )}
            </p>
          )}
        </>
      )}
      {worktree ? (
        <label className="flex items-start gap-2">
          <Checkbox
            checked={removeFiles}
            disabled={busy || unknown}
            onCheckedChange={(checked) => setRemoveWorktrees(checked === true)}
          />
          <span>
            {t('Also remove its worktrees')}
            <span className="block text-muted-foreground">
              {t(
                unknown
                  ? 'Worktrees are kept while a command has unknown status.'
                  : 'Only if they have no uncommitted changes. Branches are kept.',
              )}
            </span>
          </span>
        </label>
      ) : (
        <p className="text-muted-foreground">{t('Shared files, terminals, worktrees, and other threads stay open.')}</p>
      )}
    </Dialog>
  )
}
