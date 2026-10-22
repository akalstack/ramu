import type { SetupOmission } from '@ramu/shared/types'
import { t } from '../../i18n'
import { readinessLabel } from '../../settings/mcpReadinessView'

/** One short phrase for what a switch left behind, for example "Atlassian: MCP approval needed". */
export function omissionLabel(omission: SetupOmission): string {
  if (omission.kind === 'rule') return t('Rules are too large to send to this runtime')
  return `${omission.name}: ${readinessLabel(omission.status === 'too-large' ? 'unsupported' : omission.status)}`
}

/** The notice under a switch, or null when nothing was left behind. */
export function omissionsLine(omissions: readonly SetupOmission[] | undefined): string | null {
  if (!omissions?.length) return null
  return t('Not available after this switch: {0}', { '0': omissions.map(omissionLabel).join(', ') })
}

/** Whether Review access can help: only a Shared MCP connection has an access dialog to open. */
export const canReviewAccess = (omissions: readonly SetupOmission[] | undefined) =>
  !!omissions?.some((omission) => omission.kind === 'shared-mcp')
