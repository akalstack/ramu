import { Alert } from 'react-native'
import { combinedImpact, doneStopsWork, type ThreadDoneImpact } from '@ramu/shared/chat/threadDone'
import type { RamuMethods } from '@ramu/shared/api'

type Invoke = <M extends keyof RamuMethods>(
  computerId: string,
  method: M,
  ...args: Parameters<RamuMethods[M]>
) => Promise<Awaited<ReturnType<RamuMethods[M]>>>

const NOTHING_RUNNING: ThreadDoneImpact = { commands: 0, helpers: 0, computer: false, browserTabs: 0 }

/**
 * Asks before marking threads done when that would stop running work, as the desktop does: done stops a thread's
 * background commands (and the servers they run), its working helpers, computer use and browser tabs. Resolves true
 * when there is nothing to stop or the person agrees; false keeps everything running and the threads open.
 */
export async function confirmDone(
  invoke: Invoke,
  say: (text: string, values?: Record<string, string | number>) => string,
  threads: { computerId: string; taskId: string }[],
): Promise<boolean> {
  const impact = combinedImpact(
    await Promise.all(
      threads.map(({ computerId, taskId }) =>
        // A host that cannot say (an older one) is marked done as before, without asking.
        invoke(computerId, 'tasks.doneImpact', taskId).then(
          (result) => result ?? NOTHING_RUNNING,
          () => NOTHING_RUNNING,
        ),
      ),
    ),
  )
  if (!doneStopsWork(impact)) return true
  const lines = [
    impact.commands ? `• ${say('{0} background commands, with any servers they run', { 0: impact.commands })}` : '',
    impact.helpers ? `• ${say('{0} helper agents still working', { 0: impact.helpers })}` : '',
    impact.computer ? `• ${say('Using the computer')}` : '',
    impact.browserTabs ? `• ${say('{0} browser tabs', { 0: impact.browserTabs })}` : '',
  ].filter(Boolean)
  return new Promise((resolve) =>
    Alert.alert(
      say('Stop running work and mark done?'),
      [
        say('Marking this done stops:'),
        ...lines,
        '',
        say('Reopening the thread later starts the work again as it needs.'),
      ].join('\n'),
      [
        { text: say('Cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: say('Stop and mark done'), style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  )
}
