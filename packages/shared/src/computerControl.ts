import type { ComputerSessionSummary } from './api'

/** Who controls the computer, in the words every viewer shows. Copy keys are English source strings. */
export function computerControllerLabel(session: ComputerSessionSummary): string {
  if (session.interruption === 'local-input') return 'Paused: you are using this computer’s mouse or keyboard'
  if (session.paused) return 'Control paused'
  if (session.controller.kind === 'human') return 'You are in control'
  if (session.controller.kind === 'agent') return 'Agent control'
  return 'Ready'
}

/** The server refuses a take-over from a second device with this wording; the viewer then asks the controller instead. */
export const needsHandoff = (message: string): boolean => /handoff/i.test(message)

/** A display whose host cannot see the person using the real mouse or keyboard says so before automation relies on it. */
export const LOCAL_INPUT_LIMIT =
  'Ramu cannot tell when you use this computer’s mouse or keyboard. Take control before using it yourself.'

export const showsLocalInputLimit = (session: ComputerSessionSummary): boolean =>
  session.target.kind === 'display' && session.detectsLocalInput === false

/** Where a tap or click lands on a frame drawn with `contain` inside a box: letterbox bars are outside the frame. */
export function frameOffset(
  touch: { x: number; y: number },
  box: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } | null {
  if (!(box.width > 0 && box.height > 0 && frame.width > 0 && frame.height > 0)) return null
  const fit = Math.min(box.width / frame.width, box.height / frame.height)
  const shown = { width: frame.width * fit, height: frame.height * fit }
  const left = (box.width - shown.width) / 2
  const top = (box.height - shown.height) / 2
  const x = touch.x - left
  const y = touch.y - top
  if (x < 0 || y < 0 || x > shown.width || y > shown.height) return null
  return {
    x: Math.min(frame.width - 1, Math.max(0, Math.round((x / shown.width) * frame.width))),
    y: Math.min(frame.height - 1, Math.max(0, Math.round((y / shown.height) * frame.height))),
  }
}
