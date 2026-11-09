// A `ramu://plugin/install` link from getramu.dev can arrive before Settings is open; the source waits here until the
// Plugins page takes it and opens the review.
import { parseInstallLink } from '@ramu/shared/plugins'

let pending: { source: string; index: string | null } | null = null

/** Keeps the link's source for the Plugins page; returns false for a link that is not an install link. */
export function receivePluginLink(link: string): boolean {
  const parsed = parseInstallLink(link)
  if (!parsed) return false
  pending = parsed
  return true
}

export function takePendingPluginSource(): { source: string; index: string | null } | null {
  const link = pending
  pending = null
  return link
}
