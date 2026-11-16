import { createContext, use } from 'react'

/** Rows in the list beside an open thread open threads in place, and the open one is marked. */
export const ThreadPicker = createContext<{ openId: string; open(id: string): void } | null>(null)
/** A screen drawn in the pane beside the list draws its own header, since the native bar would span both panes. */
export const DetailPane = createContext(false)

export const useThreadPicker = () => use(ThreadPicker)
export const useInDetailPane = () => use(DetailPane)
