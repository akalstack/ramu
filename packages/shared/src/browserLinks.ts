import type { LinkTarget } from './browser'

/** Device-state key (device-wide, kept by the desktop shell) for where clicked web links open. */
export const LINK_TARGET_KEY = 'ramu.browser.linkTarget'

/** Anything but an explicit choice of the integrated browser keeps the person's own browser. */
export function linkTargetFrom(value: string | null | undefined): LinkTarget {
  return value === 'integrated' ? 'integrated' : 'system'
}

/** Only plain web links ever open in either browser; other schemes never leave the app this way. */
export function isWebLink(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Showing an agent page is a device presentation choice, independent of execution routing. */
export const AGENT_BROWSER_VISIBILITY_KEY = 'ramu.browser.agentVisibility'
export const agentBrowserVisibilityFrom = (value: string | null | undefined): 'automatic' | 'manual' =>
  value === 'manual' ? 'manual' : 'automatic'
