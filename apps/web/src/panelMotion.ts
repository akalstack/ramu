import { flushSync } from 'react-dom'

export type PanelMotionScope = 'tools' | 'workspace' | 'terminal' | 'editor' | 'sidebar' | 'right' | 'chat'

let applying = false
let active: { transition: ViewTransition; apply: () => void } | undefined
let entryFrame = 0
const entries = new Set<Animation>()
const workspaceSurfaces = '.task-pane[data-panel-visible] [data-workspace-split][data-open] > [data-panel-surface]'
const surfaces: Record<PanelMotionScope, string> = {
  chat: '.task-pane[data-panel-visible] .agent-view[data-chat-visible] .agent-dock.open > .agent-panel',
  tools: '.workspace-tools:not([hidden])',
  workspace: workspaceSurfaces,
  terminal: '.task-pane[data-panel-visible] [data-workspace-split][data-open]:is([data-workspace-split$=".terminal-bottom"], [data-workspace-split$=".terminal-right"]) > [data-panel-surface]',
  editor: '.task-pane[data-panel-visible] [data-workspace-split$=".editor"][data-open] > [data-panel-surface]',
  sidebar: '.shell:not(.no-sidebar) #workspace-sidebar',
  right: `.workspace-tools:not([hidden]), ${workspaceSurfaces}`,
}

/** Capture the outgoing panel once; animate its image, never the live split geometry. */
export function animatePanelChange(update: () => void, scope: PanelMotionScope, entering: boolean | (() => boolean) = false, captureIncoming = false) {
  if (applying) { update(); return }

  cancelPanelMotion()

  if (document.hidden || reducedMotion()) {
    update()
    return
  }

  if (typeof entering === 'function' ? entering() : entering) {
    // There is no outgoing image to preserve. Commit once, then animate the
    // live surface before paint without freezing the page for capture.
    const before = new Set(Array.from(document.querySelectorAll(surfaces[scope])))
    applying = true
    try { flushSync(update) } finally { applying = false }
    entryFrame = requestAnimationFrame(() => {
      entryFrame = 0
      if (document.hidden || reducedMotion()) return
      document.querySelectorAll<HTMLElement>(surfaces[scope]).forEach(element => {
        if (before.has(element)) return
        const bottom = element.parentElement?.dataset.workspaceSplit?.endsWith('.terminal-bottom')
        const direction = bottom ? 'bottom' : scope === 'sidebar' ? 'left' : 'right'
        const from = { opacity: 0, transform: bottom ? 'translateY(16px)' : `translateX(${direction === 'left' ? -16 : 16}px)` }
        const to = { opacity: 1, transform: 'translate(0)' }
        const animation = element.animate([from, to], { id: `ramu-panel-in-${direction}`, duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)' })
        entries.add(animation)
        void animation.finished.finally(() => entries.delete(animation)).catch(() => {})
      })
    })
    return
  }
  if (!document.startViewTransition) { update(); return }

  let applied = false
  const apply = () => {
    if (applied) return
    applied = true
    applying = true
    try { flushSync(update) } finally {
      applying = false
      // A closing panel needs only its old image, not a second snapshot of
      // the editor/terminal that now occupies the space behind it.
      if (!captureIncoming) delete document.documentElement.dataset.panelCapture
    }
  }
  document.documentElement.dataset.panelMotion = scope
  document.documentElement.dataset.panelCapture = 'true'
  let transition: ViewTransition
  try { transition = document.startViewTransition(apply) }
  catch {
    delete document.documentElement.dataset.panelMotion
    delete document.documentElement.dataset.panelCapture
    apply()
    return
  }
  const current = { transition, apply }
  active = current
  // ready rejects when a transition is interrupted or capture is unavailable.
  void transition.ready.catch(() => {})
  void transition.finished.finally(() => {
    if (active !== current) return
    active = undefined
    delete document.documentElement.dataset.panelMotion
    delete document.documentElement.dataset.panelCapture
  }).catch(() => {})
}

/** A divider takes ownership of layout; finish any earlier toggle and stop its motion. */
export function cancelPanelMotion() {
  active?.apply()
  active?.transition.skipTransition()
  cancelAnimationFrame(entryFrame)
  entryFrame = 0
  entries.forEach(animation => animation.cancel())
  entries.clear()
}

/** App preference adds to the OS preference; it never overrides accessibility settings. */
export function reducedMotion(): boolean {
  return document.documentElement.hasAttribute('data-reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches
}
