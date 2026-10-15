/** Read when needed, so a long-lived service does not freeze startup's timezone. */
export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
