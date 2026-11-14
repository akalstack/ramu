import { createContext, useContext } from 'react'

/** Kept apart from its provider, so code blocks can read it without loading the host and workspace modules. */
export const RunCommandContext = createContext<((command: string) => void) | null>(null)

/** Runs a command from a reply in the thread's terminal; null outside a thread or where this device cannot write. */
export const useRunCommand = () => useContext(RunCommandContext)
