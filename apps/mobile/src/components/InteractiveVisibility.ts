import { createContext } from 'react'
/** The transcript's native viewability and screen focus; kept-mounted rows must not keep executing. */
export const InteractiveVisibility = createContext(true)
