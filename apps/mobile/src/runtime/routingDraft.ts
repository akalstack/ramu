import type { FileContext } from '@ramu/shared/types'

export const routingSelectionKey = (host: string) => `${host}:new:routing-selection`
export const routingSnapshot = (drafts: Record<string, string>, key: string) =>
  JSON.stringify([
    drafts[key] ?? '',
    drafts[`${key}:attachments`] ?? '[]',
    drafts[`${key}:context`] ?? '[]',
    drafts[`${key}:mentions`] ?? '[]',
  ])
export interface RoutingSelection {
  auto: boolean
  projectId: string | null
}
export function readRoutingSelection(
  drafts: Record<string, string>,
  host: string,
  eligible: string[],
  defaultAuto: boolean,
): RoutingSelection {
  try {
    const value = JSON.parse(drafts[routingSelectionKey(host)] ?? 'null')
    if (value?.version === 1 && typeof value.auto === 'boolean')
      return {
        auto: value.auto,
        projectId:
          !value.auto &&
          typeof value.projectId === 'string' &&
          (value.projectId === 'no-project' || eligible.includes(value.projectId))
            ? value.projectId
            : null,
      }
  } catch {}
  return { auto: defaultAuto, projectId: null }
}

export interface PendingRouteChoice {
  draft: string
  text: string
  attachments: string[]
  context: FileContext[]
  candidates: { projectId: string; reason: string }[]
}
export function encodeRouteChoice(value: PendingRouteChoice): string {
  const text = JSON.stringify({ version: 1, ...value })
  return text.length <= 100_000 ? text : ''
}
/** Restored candidates never create work: the person chooses, then the current host/catalog is revalidated. */
export function readRouteChoice(
  value: string | undefined,
  draft: string,
  eligible: string[],
): PendingRouteChoice | null {
  if (!value || value.length > 100_000) return null
  try {
    const data = JSON.parse(value)
    if (
      data?.version !== 1 ||
      data.draft !== draft ||
      typeof data.text !== 'string' ||
      !Array.isArray(data.attachments) ||
      data.attachments.length > 30 ||
      !data.attachments.every((id: unknown) => typeof id === 'string' && id.length <= 1000) ||
      !Array.isArray(data.context) ||
      data.context.length > 100 ||
      !data.context.every(
        (file: { repoId?: unknown; path?: unknown } | null) =>
          file && typeof file.repoId === 'string' && typeof file.path === 'string',
      ) ||
      !Array.isArray(data.candidates) ||
      data.candidates.length > 100
    )
      return null
    const candidates = data.candidates.filter(
      (candidate: { projectId?: unknown; reason?: unknown } | null) =>
        candidate &&
        typeof candidate.projectId === 'string' &&
        eligible.includes(candidate.projectId) &&
        typeof candidate.reason === 'string' &&
        candidate.reason.length <= 1000,
    )
    return candidates.length
      ? { draft, text: data.text, attachments: data.attachments, context: data.context, candidates }
      : null
  } catch {
    return null
  }
}
