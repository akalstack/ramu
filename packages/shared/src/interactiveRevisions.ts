import type { InteractiveReference } from './interactive'
import type { AgentEvent } from './types'

/** Every version of one document a transcript published, newest first. */
export interface InteractiveRevision {
  latest: InteractiveReference
  versions: InteractiveReference[]
}

/** A revision the agent is checking right now, or the reason its last check did not publish. */
export type InteractiveUpdate = { state: 'updating' } | { state: 'failed'; detail: string }

/**
 * Groups a transcript's documents by id, so desktop and phone both draw only the newest version as a full card and every
 * older one as a row in its own place.
 */
export function interactiveRevisions(events: readonly AgentEvent[]): Map<string, InteractiveRevision> {
  const byId = new Map<string, Map<number, InteractiveReference>>()
  for (const event of events) {
    if (event.kind !== 'interactive') continue
    const versions = byId.get(event.reference.id) ?? new Map<number, InteractiveReference>()
    versions.set(event.reference.version, event.reference)
    byId.set(event.reference.id, versions)
  }
  const result = new Map<string, InteractiveRevision>()
  for (const [id, versions] of byId) {
    const sorted = [...versions.values()].sort((a, b) => b.version - a.version)
    result.set(id, { latest: sorted[0]!, versions: sorted })
  }
  return result
}

/** The version that replaced this one, whose `changes` say what it changed. */
export function interactiveSuccessor(
  reference: InteractiveReference,
  revision: InteractiveRevision | undefined,
): InteractiveReference | undefined {
  return revision?.versions.filter((entry) => entry.version > reference.version).at(-1)
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const parse = (text: string | undefined): unknown => {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The Ramu tool a call names, however its provider spells it, unwrapping the deferred catalog's tool_invoke. */
function interactiveCall(event: AgentEvent): { name: string; args: Record<string, unknown> } | null {
  if (event.kind !== 'tool-use') return null
  const name =
    /^mcp__ramu__(.+)$/.exec(event.name)?.[1] ??
    /^ramu_(.+)$/.exec(event.name)?.[1] ??
    (event.summary === 'ramu' ? event.name : undefined)
  if (!name) return null
  const args = record(parse(event.input))
  if (name === 'tool_invoke') {
    const inner = typeof args.name === 'string' ? args.name : ''
    return inner ? { name: inner, args: record(args.arguments) } : null
  }
  return { name, args }
}

const resultText = (event: AgentEvent & { kind: 'tool-result' }): string =>
  event.content?.find((part) => part.type === 'text')?.text ?? event.summary

/** Why a preview result cannot be published: script errors or failed checks, in the agent's own words. */
function previewProblem(event: AgentEvent & { kind: 'tool-result' }): string | null {
  const text = resultText(event)
  if (event.isError) return text.slice(0, 300) || 'The preview failed.'
  const value = record(parse(text))
  const errors = Array.isArray(value.errors) ? value.errors.map(String) : []
  const failed = Array.isArray(value.checks) ? value.checks.map(record).filter((check) => check.passed === false) : []
  if (errors.length) return errors[0]!.slice(0, 300)
  if (failed.length) return `Check failed: ${String(failed[0]!.label ?? '')}`.slice(0, 300)
  return null
}

/**
 * Revisions in flight, by document id. A preview that names the version it revises marks that document as updating
 * until its result arrives; a failing result is kept until the next preview or publication of the same document.
 */
export function interactiveUpdates(events: readonly AgentEvent[]): Map<string, InteractiveUpdate> {
  const pending = new Map<string, string>()
  const updates = new Map<string, InteractiveUpdate>()
  for (const event of events) {
    if (event.kind === 'interactive') {
      updates.delete(event.reference.id)
      continue
    }
    if (event.kind === 'tool-result') {
      const id = pending.get(event.toolUseId)
      if (!id || event.running) continue
      pending.delete(event.toolUseId)
      const problem = previewProblem(event)
      if (problem) updates.set(id, { state: 'failed', detail: problem })
      // A clean preview still waits for its publication, which ends the update.
      continue
    }
    const call = interactiveCall(event)
    if (call?.name !== 'artifact_preview' || event.kind !== 'tool-use') continue
    const id = typeof record(call.args.previous).id === 'string' ? (record(call.args.previous).id as string) : null
    if (!id) continue
    pending.set(event.toolUseId, id)
    updates.set(id, { state: 'updating' })
  }
  return updates
}

/** A bounded line diff for Compare: unchanged, removed and added lines, oldest first. */
export function interactiveSourceDiff(before: string, after: string): { kind: ' ' | '-' | '+'; text: string }[] {
  const a = before.split('\n').slice(0, 2000)
  const b = after.split('\n').slice(0, 2000)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length,
    endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA),
    midB = b.slice(start, endB)
  const out: { kind: ' ' | '-' | '+'; text: string }[] = a.slice(Math.max(0, start - 3), start).map((text) => ({
    kind: ' ',
    text,
  }))
  // A full LCS table is only built for small changed regions; larger ones read as a removal then an addition.
  if (midA.length * midB.length <= 250_000) {
    const table = Array.from({ length: midA.length + 1 }, () => new Uint16Array(midB.length + 1))
    for (let i = midA.length - 1; i >= 0; i--)
      for (let j = midB.length - 1; j >= 0; j--)
        table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    let i = 0,
      j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        out.push({ kind: ' ', text: midA[i]! })
        i++
        j++
      } else if (j < midB.length && (i === midA.length || table[i]![j + 1]! > table[i + 1]![j]!)) {
        out.push({ kind: '+', text: midB[j++]! })
      } else out.push({ kind: '-', text: midA[i++]! })
    }
  } else {
    out.push(
      ...midA.map((text) => ({ kind: '-' as const, text })),
      ...midB.map((text) => ({ kind: '+' as const, text })),
    )
  }
  out.push(...a.slice(endA, endA + 3).map((text) => ({ kind: ' ' as const, text })))
  return out
}
