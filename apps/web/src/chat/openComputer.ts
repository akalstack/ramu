// Opening the thread's computer from anywhere: the viewer when the thread has a computer, its tray when computer use
// is on but nothing is shared yet, or Settings when computer use is off on this host.
type Invoke = (method: 'computer.status' | 'computer.session', ...args: string[]) => Promise<unknown>

export const OPEN_COMPUTER_EVENT = 'ramu:open-computer'

export async function openComputer(invoke: Invoke, taskId: string) {
  const [status, session] = await Promise.all([
    invoke('computer.status').catch(() => null) as Promise<{ enabled?: boolean } | null>,
    invoke('computer.session', taskId).catch(() => null),
  ])
  if (!session && !status?.enabled)
    window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'computer' } }))
  else window.dispatchEvent(new CustomEvent(OPEN_COMPUTER_EVENT, { detail: { taskId } }))
}
