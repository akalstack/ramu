import type { AppUpdateStatus } from './updates'

/**
 * What the one update row in About says and offers, from the update state. Every state reads as a sentence about Ramu
 * with at most one next step, so the person never has to piece it together from several rows. `title` and `detail`
 * are catalog keys with `values`, translated where they are shown.
 */
export interface AppUpdateView {
  tone: 'current' | 'busy' | 'offer' | 'ready' | 'problem'
  title: string
  detail: string
  values: Record<string, string | number>
  action: 'check' | 'download' | 'restart' | 'installer' | 'retry' | null
  /** When an up-to-date check ran; the row fills `{1}` with its age in the reader's language. */
  checkedAt?: number
}

export function appUpdateView(state: AppUpdateStatus): AppUpdateView {
  const current = state.currentVersion
  const next = state.release?.version ?? ''
  if (state.phase === 'error')
    return {
      tone: 'problem',
      title: state.release ? 'Ramu {0} could not be downloaded' : 'Could not check for updates',
      detail: updateErrorText(state.error),
      values: { 0: next },
      action: 'retry',
    }
  if (state.phase === 'checking')
    return {
      tone: 'busy',
      title: 'Checking for updates…',
      detail: 'You have Ramu {0}.',
      values: { 0: current },
      action: null,
    }
  if (state.release && state.phase === 'downloading')
    return {
      tone: 'busy',
      title: 'Downloading Ramu {0}…',
      detail: '{1} of {2} MB. Keep working; you choose when to restart.',
      values: {
        0: next,
        1: Math.round(state.downloadedBytes / 1_000_000),
        2: Math.max(1, Math.round(state.release.size / 1_000_000)),
      },
      action: null,
    }
  if (state.release && state.phase === 'ready')
    return state.supported === false
      ? {
          tone: 'offer',
          title: 'Ramu {0} is available',
          detail: 'This build installs by hand. You have {1}.',
          values: { 0: next, 1: current },
          action: 'installer',
        }
      : {
          tone: 'ready',
          title: state.nativeReady ? 'Ramu {0} is ready to install' : 'Preparing Ramu {0}…',
          detail: 'Restarting takes a few seconds. Threads keep running.',
          values: { 0: next },
          action: state.nativeReady ? 'restart' : null,
        }
  if (state.release)
    return {
      tone: 'offer',
      title: 'Ramu {0} is available',
      detail: 'You have {1}.',
      values: { 0: next, 1: current },
      action: 'download',
    }
  return {
    tone: 'current',
    title: 'Ramu {0} is up to date',
    detail: state.checkedAt ? 'Checked {1}.' : 'Not checked yet.',
    values: { 0: current },
    action: 'check',
    ...(state.checkedAt ? { checkedAt: Date.parse(state.checkedAt) } : {}),
  }
}

/**
 * A failed check or download in words a person can act on, instead of the raw error. Returns a catalog key; anything
 * unrecognised keeps its own message without the "Error:" prefix, since it is still the most specific thing known.
 */
export function updateErrorText(raw: string | null): string {
  const text = (raw ?? '').replace(/^(?:[A-Za-z]*Error:\s*)+/, '').trim()
  if (
    /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|socket hang up|getaddrinfo/i.test(text)
  )
    return 'GitHub could not be reached. Check your connection, then try again.'
  if (/rate limit|\b403\b|\b429\b/i.test(text)) return 'GitHub is limiting update checks for now. Try again in an hour.'
  if (/checksum|size did not match|size exceeded/i.test(text))
    return 'The download did not match the release, so it was thrown away. Try again.'
  if (/ENOSPC|no space/i.test(text)) return 'There is not enough free disk space for the update.'
  return text || 'Something went wrong. Try again.'
}
