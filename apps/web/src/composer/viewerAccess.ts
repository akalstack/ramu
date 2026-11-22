import type { BackgroundStatus } from '@ramu/shared/types'

/** The server enforces access either way; this only decides what to offer. */
export const isViewOnly = (status: Pick<BackgroundStatus, 'access'> | null | undefined): boolean =>
  status?.access === 'viewer'

export const VIEW_ONLY_NOTICE =
  'This device can view threads and answer requests, but not send messages. Ask the host owner to pair it with full access.'

export const VIEW_ONLY_TERMINAL_NOTICE =
  'This device is view-only, so it cannot open terminals. Ask the host owner to pair it with full access.'

export const VIEW_ONLY_WRITE_NOTICE =
  'This device is view-only, so it cannot change this. Ask the host owner to pair it with full access.'

const hostAccess = new Map<string, 'owner' | 'viewer'>()
const accessReads = new Map<string, number>()
export function beginHostAccessRead(host: string): number {
  const next = (accessReads.get(host) ?? 0) + 1
  accessReads.set(host, next)
  return next
}
/** Missing/failed reads provide no new role evidence; a later confirmed owner response restores access. */
export function rememberHostAccess(
  host: string,
  status: Pick<BackgroundStatus, 'access'> | null | undefined,
  request: number,
) {
  if (accessReads.get(host) !== request) return
  if (status?.access === 'owner' || status?.access === 'viewer') hostAccess.set(host, status.access)
}

/** Workspace calls target the execution host; native terminal menus and clipboard/window preferences stay local. */
export const workspaceAccessDenied = (host: string, method: string): boolean =>
  host !== 'local' &&
  hostAccess.get(host) === 'viewer' &&
  (/^(files|git)\./.test(method) || (method.startsWith('term.') && method !== 'term.menu'))
