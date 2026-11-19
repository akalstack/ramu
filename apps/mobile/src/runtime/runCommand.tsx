import { createContext, useContext, type ReactNode } from 'react'
import { useRouter } from 'expo-router'
import type { Chat } from './types'
import { useStore } from './store'
import { showToast } from './toast'
import { terminalCtx } from '../components/TerminalScreen'

const RunCommandContext = createContext<((command: string) => void) | null>(null)

/** Runs a command from a reply in the thread's terminal; null outside a thread or without terminal access. */
export const useRunCommand = () => useContext(RunCommandContext)

/**
 * Lets a thread's replies run their shell commands: the host types it into the workspace's idle shell or a new one,
 * and the terminal screen opens on that shell, as it does on the desktop.
 */
export function RunCommandProvider({ chat, enabled, children }: { chat: Chat; enabled: boolean; children: ReactNode }) {
  const store = useStore()
  const router = useRouter()
  const run =
    enabled && chat.taskId
      ? (command: string) => {
          void store.invoke(chat.computerId, 'term.run', terminalCtx(chat), command).then(
            (terminal) => router.push({ pathname: '/chat/[id]/terminal', params: { id: chat.id, focus: terminal.id } }),
            (error: unknown) => showToast(error instanceof Error ? error.message : String(error)),
          )
        }
      : null
  return <RunCommandContext.Provider value={run}>{children}</RunCommandContext.Provider>
}
