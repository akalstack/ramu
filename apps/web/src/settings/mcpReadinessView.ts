import type { SharedMcpAccountReadiness } from '@ramu/shared/mcp'
import { t } from '../i18n'

/** Short label for a login's Shared MCP readiness; kept apart from quota and enabled state. */
export function readinessLabel(status: SharedMcpAccountReadiness['status']): string {
  switch (status) {
    case 'ready':
      return t('MCP ready')
    case 'approval-needed':
      return t('MCP approval needed')
    case 'sign-in-required':
      return t('MCP sign-in required')
    case 'unsupported':
      return t('MCP unsupported')
    case 'not-checked':
      return t('MCP not checked')
  }
}

/** Calm for ready, a warning tone for anything the person must act on, muted otherwise. */
export function readinessTone(status: SharedMcpAccountReadiness['status']): 'ok' | 'warn' | 'muted' {
  return status === 'ready' ? 'ok' : status === 'approval-needed' || status === 'sign-in-required' ? 'warn' : 'muted'
}

/** The readiness line with its last-check time, for example "MCP ready · checked 5m ago". */
export function readinessLine(
  readiness: Pick<SharedMcpAccountReadiness, 'status' | 'checkedAt'>,
  ago: (at: number) => string,
) {
  return readiness.checkedAt === null
    ? readinessLabel(readiness.status)
    : t('{0} · checked {1}', { '0': readinessLabel(readiness.status), '1': ago(readiness.checkedAt) })
}
