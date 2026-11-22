// The phone's Live app view of a project: what the host's Live app calls return, as lines to show. No React Native in
// here, so it is unit tested.
import { CHECK_STATE, uptimeCheckText } from '@ramu/shared/deployText'
import type { Translate } from '@ramu/shared/forgeStatus'
import type { DeployStatus, UptimeStatus } from '@ramu/shared/types/deploy'

export interface DeployCheckRow {
  key: string
  name: string
  state: string
  failed: boolean
  url: string | null
}

/** The latest deploy of each repository, as the Git host's checks on its default branch report it. */
export function deployCheckRows(
  status: DeployStatus,
  t: Translate,
): { repoId: string; title: string; checks: DeployCheckRow[] }[] {
  return status.repositories.map((repository) => ({
    repoId: repository.repoId,
    title: t('{0} · {1} at {2}', { 0: repository.name, 1: repository.branch, 2: repository.commit.slice(0, 7) }),
    checks: repository.checks.map((check) => ({
      key: `${repository.repoId}:${check.name}`,
      name: check.name,
      state: t(CHECK_STATE[check.state]),
      failed: check.state === 'failure',
      url: check.url,
    })),
  }))
}

/** The live address watch in words: the address checked, the last check, any failure, incident or unknown span. */
export function uptimeLines(
  uptime: UptimeStatus | null,
  t: Translate,
  time: (at: number) => string,
): { lines: string[]; down: boolean } {
  if (!uptime) return { lines: [], down: false }
  if (!uptime.enabled) return { lines: [t('The live address is not watched.')], down: false }
  return {
    down: uptime.downSince !== null || uptime.last?.result === 'down',
    lines: [
      uptime.url
        ? t('The host checks {0} every five minutes.', { 0: uptime.url })
        : t('Checks start once your Git host records a production deploy, or once you save the address.'),
      ...(uptime.source === 'git-host' ? [t('Found from the production deployment on your Git host.')] : []),
      ...(uptime.last ? [uptimeCheckText(t, time, uptime.last)] : []),
      ...(uptime.downSince !== null ? [t('Failing since {0}', { 0: time(uptime.downSince) })] : []),
      ...(uptime.incident
        ? [t('An incident thread is open in this project since {0}.', { 0: time(uptime.incident.openedAt) })]
        : []),
      ...(uptime.gap
        ? [
            t('Unknown from {0} to {1}: this computer was asleep or Ramu was not running.', {
              0: time(uptime.gap.from),
              1: time(uptime.gap.to),
            }),
          ]
        : []),
    ],
  }
}
