import type { BrowserImportDomain, BrowserImportResult, BrowserProfileInfo } from '@ramu/shared/types/browser'

/** A profile name that is unused, based on where the sessions come from. */
export function defaultImportName(source: string, profile: string, existing: readonly BrowserProfileInfo[]): string {
  const base = (
    profile && !['default', 'default-release'].includes(profile.toLowerCase()) ? `${source} · ${profile}` : source
  ).slice(0, 70)
  const taken = new Set(existing.map((entry) => entry.name.toLowerCase()))
  let name = `From ${base}`
  for (let index = 2; taken.has(name.toLowerCase()) && index < 100; index++) name = `From ${base} ${index}`
  return name.slice(0, 80)
}

/** Nothing is preselected. Import needs at least one site and a valid name. */
export function canImport(selected: ReadonlySet<string>, name: string): boolean {
  const trimmed = name.trim()
  return selected.size > 0 && trimmed.length > 0 && trimmed.length <= 80
}

/** Sites whose address contains the search, as typed; an empty search keeps them all. */
export function matchingDomains<T extends { domain: string }>(domains: readonly T[], search: string): T[] {
  const words = search.trim().toLowerCase()
  return words ? domains.filter((entry) => entry.domain.toLowerCase().includes(words)) : [...domains]
}

/** Selects every one of `shown`, or, when all of them are selected already, clears just those. */
export function toggleAll(selected: ReadonlySet<string>, shown: readonly { domain: string }[]): Set<string> {
  const next = new Set(selected)
  const all = shown.length > 0 && shown.every((entry) => next.has(entry.domain))
  for (const entry of shown) {
    if (all) next.delete(entry.domain)
    else next.add(entry.domain)
  }
  return next
}

export function toggleDomain(selected: ReadonlySet<string>, domain: string): Set<string> {
  const next = new Set(selected)
  if (!next.delete(domain)) next.add(domain)
  return next
}

/** How many cookies the selected sites hold, so the review step can say what will be copied. */
export function selectedCookieCount(domains: readonly BrowserImportDomain[], selected: ReadonlySet<string>): number {
  return domains.filter((entry) => selected.has(entry.domain)).reduce((sum, entry) => sum + entry.cookies, 0)
}

/** Plain lines for the result step. Counts and reasons only. */
export function resultLines(result: BrowserImportResult): string[] {
  const lines = [`Copied ${result.imported} sign-in cookie${result.imported === 1 ? '' : 's'}.`]
  for (const skip of result.skipped) lines.push(`Skipped ${skip.count}: ${skip.reason}`)
  if (result.failed) lines.push(`${result.failed} could not be saved.`)
  return lines
}

/** Some logins live outside cookies, so a successful copy is not a promise of a signed-in site. */
export const IMPORT_CAVEAT =
  'Some websites keep sign-ins in other storage or tie them to this device, so you may still need to sign in to those.'
