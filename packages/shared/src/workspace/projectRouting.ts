// Deterministic first stage of automatic project selection, plus validation of the bounded AI stage. Recency and a
// model's own confidence are never evidence; a destination is chosen only from names/aliases with word boundaries or a
// model reason grounded in the permitted catalog. Anything else asks the person.

export interface RoutingCandidate {
  id: string
  name: string
  /** Host label shown when two hosts hold a project with the same name. */
  host?: string
  aliases?: string[]
  description?: string
}

export type RoutingOutcome =
  | { kind: 'resolved'; projectId: string; reason: string; via: 'name' | 'alias' | 'ai' }
  | { kind: 'ambiguous'; candidates: { projectId: string; reason: string }[] }
  | { kind: 'unknown' }
  /** The request starts something new (a page, a site, an app, a question) that belongs to no listed project. */
  | { kind: 'new'; reason: string }
  | { kind: 'unavailable'; reason: 'no-projects' | 'catalog-incomplete' | 'ai-failed' | 'invalid-ai-result' }

/** Largest catalog sent to the classifier; a bigger one can never prove a unique match. */
export const ROUTING_CATALOG_LIMIT = 50
export const ROUTING_DESCRIPTION_LIMIT = 280

const normalize = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Whole-word (or whole-phrase) occurrence, so "ram" never matches "Ramu" and "pay" never matches "payment". */
function mentions(prompt: string, term: string): boolean {
  const needle = normalize(term)
  if (needle.length < 2) return false
  return ` ${prompt} `.includes(` ${needle} `)
}

export function routeByName(promptText: string, candidates: readonly RoutingCandidate[]): RoutingOutcome {
  if (!candidates.length) return { kind: 'unavailable', reason: 'no-projects' }
  const prompt = normalize(promptText)
  const hits: { candidate: RoutingCandidate; via: 'name' | 'alias'; term: string }[] = []
  for (const candidate of candidates) {
    if (mentions(prompt, candidate.name)) hits.push({ candidate, via: 'name', term: candidate.name })
    else {
      const alias = candidate.aliases?.find((a) => mentions(prompt, a))
      if (alias) hits.push({ candidate, via: 'alias', term: alias })
    }
  }
  if (!hits.length) return { kind: 'unknown' }
  // The longest matched term wins over a shorter one it contains ("Ramu Mobile" over "Ramu").
  const longest = Math.max(...hits.map((h) => normalize(h.term).length))
  const best = hits.filter((h) => normalize(h.term).length === longest)
  if (best.length === 1) {
    const hit = best[0]!
    return {
      kind: 'resolved',
      projectId: hit.candidate.id,
      via: hit.via,
      reason:
        hit.via === 'name'
          ? `Mentions “${hit.candidate.name}”`
          : `Mentions “${hit.term}”, an alias of ${hit.candidate.name}`,
    }
  }
  return {
    kind: 'ambiguous',
    candidates: best.map((h) => ({ projectId: h.candidate.id, reason: `Mentions “${h.term}”` })),
  }
}

/** Catalog the router may send out: bounded, trimmed, and nothing but names, aliases and short descriptions. */
export function routingCatalog(candidates: readonly RoutingCandidate[]): RoutingCandidate[] | null {
  if (candidates.length > ROUTING_CATALOG_LIMIT) return null
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.host ? { host: c.host } : {}),
    ...(c.aliases?.length ? { aliases: c.aliases.slice(0, 8) } : {}),
    ...(c.description ? { description: c.description.slice(0, ROUTING_DESCRIPTION_LIMIT) } : {}),
  }))
}

export interface AiRoutingResult {
  projectIds?: unknown
  reason?: unknown
  /** True when no project fits because the request starts something new. */
  new?: unknown
}

/**
 * Turn the classifier's answer into an outcome. One id from the eligible catalog with a reason that quotes catalog text
 * resolves; several ids ask; none is unknown; anything malformed or pointing outside the catalog is rejected.
 */
export function interpretAiRouting(result: AiRoutingResult, catalog: readonly RoutingCandidate[]): RoutingOutcome {
  if (!Array.isArray(result.projectIds) || result.projectIds.some((id) => typeof id !== 'string'))
    return { kind: 'unavailable', reason: 'invalid-ai-result' }
  const ids = [...new Set(result.projectIds as string[])]
  const byId = new Map(catalog.map((c) => [c.id, c]))
  if (ids.some((id) => !byId.has(id))) return { kind: 'unavailable', reason: 'invalid-ai-result' }
  const reason = typeof result.reason === 'string' ? result.reason.trim().slice(0, 240) : ''
  if (!ids.length) return result.new === true ? { kind: 'new', reason } : { kind: 'unknown' }
  if (ids.length > 1) return { kind: 'ambiguous', candidates: ids.map((projectId) => ({ projectId, reason })) }
  const chosen = byId.get(ids[0]!)!
  if (!reason || !groundedIn(reason, chosen))
    return { kind: 'ambiguous', candidates: [{ projectId: chosen.id, reason }] }
  return { kind: 'resolved', projectId: chosen.id, reason, via: 'ai' }
}

/** A reason counts only when it cites the project's own name, alias or description words. */
function groundedIn(reason: string, project: RoutingCandidate): boolean {
  const text = normalize(reason)
  if ([project.name, ...(project.aliases ?? [])].some((term) => mentions(text, term))) return true
  const words = new Set(
    normalize(project.description ?? '')
      .split(' ')
      .filter((w) => w.length > 4),
  )
  return text.split(' ').some((w) => words.has(w))
}

/** Same project name on several hosts needs the host in its label. */
export function routingLabels(candidates: readonly RoutingCandidate[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const c of candidates) counts.set(normalize(c.name), (counts.get(normalize(c.name)) ?? 0) + 1)
  return new Map(
    candidates.map((c) => [
      c.id,
      c.host && (counts.get(normalize(c.name)) ?? 0) > 1 ? `${c.name} · ${c.host}` : c.name,
    ]),
  )
}

/**
 * The same project on several hosts is one piece of work, so a name alone never reaches every copy. Copies are narrowed
 * to the hosts the prompt names; a prompt that names none leaves the choice to the person, and only a prompt that names
 * every copy's host keeps them all.
 */
export function settleCopies(
  outcome: RoutingOutcome,
  promptText: string,
  candidates: readonly RoutingCandidate[],
): RoutingOutcome {
  if (outcome.kind !== 'ambiguous') return outcome
  const listed = outcome.candidates
  const prompt = normalize(promptText)
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const copies = new Map<string, RoutingCandidate[]>()
  for (const { projectId } of listed) {
    const candidate = byId.get(projectId)
    if (!candidate) continue
    const key = normalize(candidate.name)
    copies.set(key, [...(copies.get(key) ?? []), candidate])
  }
  const dropped = new Set<string>()
  let unclear = false
  for (const group of copies.values()) {
    if (group.length < 2) continue
    const named = group.filter((candidate) => candidate.host && mentions(prompt, candidate.host))
    if (!named.length) unclear = true
    else for (const candidate of group) if (!named.includes(candidate)) dropped.add(candidate.id)
  }
  if (unclear) return { kind: 'ambiguous', candidates: listed }
  if (!dropped.size) return outcome
  const kept = listed.filter((entry) => !dropped.has(entry.projectId))
  if (kept.length === 1) {
    const chosen = byId.get(kept[0]!.projectId)!
    return {
      kind: 'resolved',
      projectId: chosen.id,
      reason: `Mentions “${chosen.name}” on ${chosen.host}`,
      via: 'name',
    }
  }
  return { kind: 'ambiguous', candidates: kept }
}
