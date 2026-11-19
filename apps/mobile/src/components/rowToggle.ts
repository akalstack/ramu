import { createContext } from 'react'

/** Called before a row expands or collapses by hand; the screen keeps its scroll position instead of following the end. */
export const RowToggle = createContext<() => void>(() => {})
