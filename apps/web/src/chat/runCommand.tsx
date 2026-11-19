import type { ReactNode } from 'react'
import { workspaceOfTask } from '../workspace/workspaceModel'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { errorText } from '../lib/errors'
import { t } from '../i18n'
import { notifyError } from './Notifications'
import { RunCommandContext } from './runCommandContext'

/**
 * Lets a thread's replies run their shell commands: the host types it into the workspace's idle shell or a new one,
 * and the terminal panel shows that shell, as a tab already open or a new one adopting it.
 */
export function RunCommandProvider({ taskId, children }: { taskId: string | undefined; children: ReactNode }) {
  const ws = useWorkspace()
  const { invoke } = useHost()
  const runtime = useHostRuntime()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const task = taskId ? ws.task(taskId) : undefined
  const run =
    task && !viewOnly
      ? (command: string) => {
          if (!canWrite()) return
          const ctx = workspaceOfTask(task)
          void invoke('term.run', ctx, command).then(
            (terminal) => {
              const shown = ws.taskUi[ctx]?.views.find(
                (view) => view.kind === 'terminal' && runtime.terminals.shellOf(view.id) === terminal.id,
              )
              if (shown) ws.activateView(ctx, shown.id)
              else {
                runtime.terminals.queueAdopt(ctx, terminal.id)
                ws.openView(ctx, { kind: 'terminal' })
              }
              ws.setTerminalPanel(ctx, { terminalOpen: true })
            },
            (error) => notifyError(errorText(error), t('Run in terminal')),
          )
        }
      : null
  return <RunCommandContext.Provider value={run}>{children}</RunCommandContext.Provider>
}
