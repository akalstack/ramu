// Words for a project's Live app sheet, shared by the desktop and the phone so both describe it the same way. Pure: the
// clients pass their own translation and date formatting.
import type { Translate } from './forgeStatus'
import type { UptimeCheck } from './types/deploy'
import type { ForgeCheckState } from './types/forge'

/** English labels for a check the Git host lists; pass through `t()`. */
export const CHECK_STATE: Record<ForgeCheckState, string> = {
  pending: 'In progress',
  success: 'Passed',
  failure: 'Failed',
  skipped: 'Skipped',
}

/** The last check of the live address, in words. */
export function uptimeCheckText(t: Translate, time: (at: number) => string, check: UptimeCheck): string {
  const answer =
    check.status !== null
      ? t('HTTP {0} in {1} ms', { 0: String(check.status), 1: String(check.ms ?? 0) })
      : check.failure === 'timeout'
        ? t('no answer within 10 seconds')
        : check.failure === 'redirects'
          ? t('too many redirects')
          : t('could not connect')
  if (check.result === 'up') return t('Up · {0} · checked {1}', { 0: answer, 1: time(check.at) })
  if (check.result === 'down') return t('Not answering · {0} · checked {1}', { 0: answer, 1: time(check.at) })
  return t('Unknown · this computer was offline or asleep at {0}', { 0: time(check.at) })
}
