// Version ordering shared by provider, app and desktop update checks.
export function newerVersion(latest: string, current: string): boolean {
  const date = /^\d{4}\.\d{2}\.\d{2}-/
  if (date.test(latest) || date.test(current)) return date.test(latest) && date.test(current) && latest.slice(0, 10) >= current.slice(0, 10) && latest !== current
  const pattern = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/
  const a = pattern.exec(latest), b = pattern.exec(current)
  if (!a || !b) return false
  for (let i = 1; i <= 3; i++) { if (+a[i]! !== +b[i]!) return +a[i]! > +b[i]! }
  if (!a[4] || !b[4]) return !a[4] && !!b[4]
  const x = a[4].split('.'), y = b[4].split('.')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    if (x[i] === undefined) return false
    if (y[i] === undefined) return true
    const numericX = /^\d+$/.test(x[i]!), numericY = /^\d+$/.test(y[i]!)
    if (numericX && numericY) return +x[i]! > +y[i]!
    if (numericX !== numericY) return !numericX
    return x[i]! > y[i]!
  }
  return false
}
