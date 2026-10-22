import type { BrowserTabInfo } from '@ramu/shared/types/browser'

/**
 * What the phone can say about a tab's website identity. Profile names are administered on the owning host, so the phone
 * names the kind, and whether the sign-in is shared with other tabs of the same profile.
 */
export function profileLabel(profileId: string): string {
  if (profileId === 'temporary') return 'Temporary profile · not shared'
  if (profileId === 'default') return 'Default profile · shared with other tabs'
  return 'Named profile · shared with other tabs'
}

export type ControlState = 'offline' | 'backgrounded' | 'disconnected' | 'agent' | 'viewing' | 'yours' | 'settling'

/** One plain state for the controls, so they never imply control the phone does not hold. */
export function controlState(
  tab: Pick<BrowserTabInfo, 'controller' | 'paused' | 'generation'> & { inputReady?: boolean },
  context: { online: boolean; active: boolean; ownedGeneration: number | null },
): ControlState {
  if (!context.online) return 'offline'
  if (!context.active) return 'backgrounded'
  if (tab.paused) return 'disconnected'
  if (tab.controller === 'agent') return 'agent'
  if (tab.controller !== 'human' || tab.generation !== context.ownedGeneration) return 'viewing'
  return tab.inputReady ? 'yours' : 'settling'
}

export const CONTROL_TEXT: Record<ControlState, string> = {
  offline: 'Offline · showing the last frame',
  backgrounded: 'Paused while Ramu is in the background',
  disconnected: 'Control disconnected. Take control again to continue.',
  agent: 'The agent is in control',
  viewing: 'Viewing only',
  yours: 'You are in control',
  settling: 'Waiting for the agent’s last action to finish…',
}

/** Turns the host's refusal into the next step for the person. */
export function viewerMessage(error: string): string {
  if (/not granted|ask the owning host to grant/i.test(error))
    return 'This phone has not been allowed to view this thread’s browser. Ask the owner of that computer to allow it in Settings → Browser.'
  if (/pair this device/i.test(error)) return 'Pair this phone with the computer again to view its browser.'
  if (/wait before requesting/i.test(error)) return 'Refreshing…'
  if (/too large to stream/i.test(error)) return 'This page is too large to show on the phone. Make the page smaller on the computer.'
  return error
}
