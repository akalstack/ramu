import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { AgentTask, Aside } from '@ramu/shared/types'
import { invoke, ramu } from '../../../ipc'
import { paneFadeIn } from '../../../workspace/paneMotion'
import { animatePanelChange } from '../../../workspace/panelMotion'
import type { AsideTarget } from '../types'

/**
 * The sub-agent panel and the aside panel beside a chat: which one is open (never both), the asides of the
 * chat, and the commands that open them (the Aside button, ⌘⇧A and `ramu:chat-panel`).
 */
export function useSidePanels({
  sessionId,
  root,
  tasks,
}: {
  sessionId: string
  root: RefObject<HTMLDivElement | null>
  tasks: AgentTask[]
}) {
  // The sub-agent panel: one agent's transcript, or '*' for the list of all of them.
  const [openAgent, setOpenAgentState] = useState<string | null>(null)
  // The aside panel: one aside (a new one carries its quote), or '*' for the list.
  const [openAside, setOpenAsideState] = useState<AsideTarget | '*' | null>(null)
  // The aside and sub-agent dock land in one step and fade in, like the terminal: they hold whole transcripts that would otherwise
  // reflow on every frame of a width animation.
  const dock = useRef<HTMLDivElement>(null)
  const dockOpen = !!(openAside || openAgent)
  const dockWasOpen = useRef(dockOpen)
  useLayoutEffect(() => {
    if (dockWasOpen.current === dockOpen) return
    dockWasOpen.current = dockOpen
    return dockOpen ? paneFadeIn(dock.current) : undefined
  }, [dockOpen])
  // One side panel at a time.
  const setOpenAgent = (value: string | null | ((current: string | null) => string | null)) =>
    animatePanelChange(
      () => {
        setOpenAsideState(null)
        setOpenAgentState(value)
      },
      'chat',
      typeof value === 'function' ? () => value(openAgent) !== null : value !== null,
    )
  const setOpenAside = (value: typeof openAside) =>
    animatePanelChange(
      () => {
        setOpenAgentState(null)
        setOpenAsideState(value)
      },
      'chat',
      value !== null,
    )
  const [asides, setAsides] = useState<Aside[]>([])
  const panelOpen = openAside !== null || openAgent !== null
  useEffect(() => {
    let cancelled = false
    setAsides([])
    void invoke('aside.list', sessionId).then(
      (list) => {
        if (!cancelled) setAsides(list)
      },
      () => {},
    )
    const off = ramu.on('aside:changed', ({ sessionId: changedSessionId, aside, asideId }) => {
      if (changedSessionId !== sessionId) return
      setAsides((current) =>
        aside
          ? [...current.filter((entry) => entry.id !== aside.id), aside].sort((a, b) => a.createdAt - b.createdAt)
          : current.filter((entry) => entry.id !== asideId),
      )
    })
    return () => {
      cancelled = true
      off()
    }
  }, [sessionId])

  /** With nothing to quote, the aside is about the whole chat: type the question straight away. Existing asides stay listed. */
  const newAside: AsideTarget = { id: null, quote: '', from: 'assistant' }
  const toggleAside = () =>
    setOpenAside(
      openAside
        ? null
        : asides.length === 0
          ? newAside
          : asides.length === 1
            ? { id: asides[0]!.id, quote: '', from: 'assistant' }
            : '*',
    )
  const toggleAsideRef = useRef(toggleAside)
  toggleAsideRef.current = toggleAside
  useEffect(() => {
    const openPanel = (event: Event) => {
      if (!root.current?.checkVisibility()) return
      const panel = (event as CustomEvent<{ panel: string }>).detail.panel
      if (panel === 'aside') toggleAside()
      else if (panel === 'agents' && tasks.length) setOpenAgent('*')
    }
    window.addEventListener('ramu:chat-panel', openPanel)
    return () => window.removeEventListener('ramu:chat-panel', openPanel)
  }, [openAside, openAgent, asides, tasks])
  // ⌘⇧A with no text selected opens an aside on the whole chat (a selection is handled by SelectionActions).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'KeyA' || event.defaultPrevented)
        return
      if (!root.current?.checkVisibility() || document.getSelection()?.toString().trim()) return
      event.preventDefault()
      toggleAsideRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { dock, openAgent, openAside, asides, panelOpen, setOpenAgent, setOpenAside, toggleAside }
}
