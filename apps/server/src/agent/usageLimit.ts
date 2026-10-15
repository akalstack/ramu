/** Whether an error or provider reply says the account hit a usage, rate or spend limit. */
export function isUsageLimit(value: unknown): boolean {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value)
  return /usage_limit_reached|usageLimitExceeded|rate_limit_error|rate_limit_exceeded|hit your.*(?:usage|spend|limit)|usage limit|rate limit|spend limit|quota exceeded/i.test(
    text,
  )
}
