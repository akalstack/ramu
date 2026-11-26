import type { ScheduleRun } from './types'

export type RunTone = 'ok' | 'warn' | 'bad' | 'accent' | 'muted'

/**
 * The colour a schedule run's state reads in, on the scale thread marks use on every device: accent while it is under
 * way, amber when it waits on the person or never ran, red when it broke, green once it finished, quiet when called off.
 */
export function runTone(status: ScheduleRun['status']): RunTone {
  switch (status) {
    case 'completed':
      return 'ok'
    case 'failed':
    case 'interrupted':
      return 'bad'
    case 'needs-input':
    case 'missed':
      return 'warn'
    case 'running':
    case 'queued':
      return 'accent'
    default:
      return 'muted'
  }
}
