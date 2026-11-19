/** "4.2 MB", in the reader's number format. */
export function formatSize(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  const short = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes,
    unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'unit',
      unit: units[unit],
      unitDisplay: 'short',
      maximumFractionDigits: unit ? 1 : 0,
    }).format(value)
  } catch {
    // Some phone JavaScript engines have no unit formatting.
    return `${unit ? value.toFixed(1) : Math.round(value)} ${short[unit]}`
  }
}
