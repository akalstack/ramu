import { classifyLimit } from '../providers/limitClassifier'

/** Whether an error or provider reply says the account hit a usage, rate or spend limit (any confidence). */
export function isUsageLimit(value: unknown): boolean {
  return classifyLimit(value, { channel: 'error' }) !== null
}

/**
 * Every model that could answer is at a usage limit. It is a pause, not a failure: `resetsAt` says when it should lift, when known.
 * Background work reports it as "try again after ..." instead of an error.
 */
export class ProviderLimitError extends Error {
  constructor(
    readonly resetsAt: number | null,
    readonly cause?: unknown,
  ) {
    super(
      resetsAt
        ? `Every available model reached a usage limit. Try again after ${new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        : 'Every available model reached a usage limit. Try again after the limit resets.',
    )
    this.name = 'ProviderLimitError'
  }
}
