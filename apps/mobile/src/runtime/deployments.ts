// The phone's Deployments view of a project: what the host's deploy calls return, as rows and lines to show. No React
// Native in here, so it is unit tested.
import {
  canRollBackTo,
  DEPLOYMENT_STATE,
  deployText,
  domainState,
  liveDeployment,
  nearLimit,
} from '@ramu/shared/deployText'
import type { Translate } from '@ramu/shared/forgeStatus'
import type {
  Deployment,
  DomainStatus,
  ProjectDeployment,
  ProjectResources,
  StoreRelease,
  UptimeStatus,
  UsageReport,
} from '@ramu/shared/types/deploy'
import { blockingChecks } from '@ramu/shared/storeRelease'

export interface DeploymentRow {
  id: string
  state: string
  failed: boolean
  detail: string
  message: string | null
  url: string | null
  /** An earlier production deployment the platform can make live again. */
  rollBack: boolean
}

export interface DeploymentsView {
  /** The platform and its project, or null when the project has no deploy target. */
  target: string | null
  live: string | null
  error: string | null
  rows: DeploymentRow[]
  uptime: { lines: string[]; down: boolean }
  /** The project's custom domains and where each is; a live one can be opened. */
  domains: { name: string; state: string; live: boolean }[]
  usage: {
    platform: UsageReport['platform']
    title: string
    billingPage: string
    lines: { text: string; warn: boolean }[]
  }[]
}

export function deploymentsView(
  status: ProjectDeployment,
  uptime: UptimeStatus | null,
  usage: UsageReport[],
  t: Translate,
  time: (at: number) => string,
  domains: DomainStatus[] = [],
): DeploymentsView {
  const words = deployText(t, time)
  const binding = status.binding
  return {
    target: binding ? [binding.siteName, binding.repository].filter(Boolean).join(' · ') : null,
    live: status.productionUrl,
    error: status.error?.message ?? null,
    rows: status.deployments.map((deployment) => ({
      id: deployment.id,
      state: t(DEPLOYMENT_STATE[deployment.state]),
      failed: deployment.state === 'failed',
      detail: words.deploymentDetail(deployment),
      message: deployment.message,
      url: deployment.url,
      rollBack: canRollBackTo(status, deployment),
    })),
    uptime: uptimeLines(uptime, t, time, words.uptimeCheck),
    domains: domains.map((domain) => ({
      name: domain.name,
      state: domainState(domain, t),
      live: domain.configured && domain.certificate,
    })),
    usage: usage.map((report) => ({
      platform: report.platform,
      title: report.period
        ? t('{0} since {1}', { 0: report.name, 1: new Date(report.period.start).toLocaleDateString() })
        : report.name,
      billingPage: report.billingPage,
      lines: [
        ...report.figures.map((figure) => ({ text: words.usageFigure(figure), warn: nearLimit(figure) })),
        ...(report.figures.length && report.figures.every((figure) => !figure.limit)
          ? [{ text: t('{0}’s API reports no plan limits; Open billing shows them.', { 0: report.name }), warn: false }]
          : []),
        ...(report.unavailable ? [{ text: report.unavailable, warn: false }] : []),
      ],
    })),
  }
}

function uptimeLines(
  uptime: UptimeStatus | null,
  t: Translate,
  time: (at: number) => string,
  check: (value: NonNullable<UptimeStatus['last']>) => string,
): DeploymentsView['uptime'] {
  if (!uptime) return { lines: [], down: false }
  if (!uptime.enabled) return { lines: [t('The live address is not watched.')], down: false }
  return {
    down: uptime.downSince !== null || uptime.last?.result === 'down',
    lines: [
      uptime.url
        ? t('The host checks {0} every five minutes.', { 0: uptime.url })
        : t('Checks start once the app has a live production deployment.'),
      ...(uptime.last ? [check(uptime.last)] : []),
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

/** The confirmation Roll back shows, naming the address that changes and the version it goes back to. */
export function rollbackConfirmation(
  status: ProjectDeployment,
  deployment: Deployment,
  t: Translate,
  time: (at: number) => string,
): { title: string; message: string } {
  const detail = [deployText(t, time).deploymentDetail(deployment), deployment.message].filter(Boolean).join('\n')
  const address = status.productionUrl ?? liveDeployment(status)?.url ?? status.binding?.siteName ?? ''
  return {
    title: t('Roll back'),
    message: `${detail}\n\n${t('{0} will show this version until the next deploy.', { 0: address })}`,
  }
}

export interface StoreBuildRow {
  id: string
  state: string
  failed: boolean
  detail: string
  message: string | null
  error: string | null
  upload: { text: string; failed: boolean } | null
  page: string
}

/** A project's Expo app on the phone: its latest store builds, and whether Release can start now. */
export function storeView(
  release: StoreRelease | null,
  t: Translate,
  time: (at: number) => string,
): { builds: StoreBuildRow[]; canRelease: boolean; blocked: string | null } | null {
  if (!release?.app) return null
  const blocking = blockingChecks(release.checks, 'all')
  return {
    builds: release.builds.map((build) => ({
      id: build.id,
      state: t(DEPLOYMENT_STATE[build.state]),
      failed: build.state === 'failed',
      detail: [
        build.platform === 'ios' ? 'iOS' : 'Android',
        build.version && build.buildNumber ? `${build.version} (${build.buildNumber})` : build.version,
        time(build.createdAt),
      ]
        .filter(Boolean)
        .join(' · '),
      message: build.message,
      error: build.error,
      upload: build.submission
        ? {
            text:
              t('Upload to {0}: {1}', {
                0:
                  build.platform === 'ios'
                    ? 'TestFlight'
                    : t('Play’s {0} track', { 0: build.submission.track ?? 'internal' }),
                1: t(DEPLOYMENT_STATE[build.submission.state]),
              }) + (build.submission.error ? ` · ${build.submission.error}` : ''),
            failed: build.submission.state === 'failed',
          }
        : null,
      page: build.page,
    })),
    canRelease: release.connected && !!release.app.projectId && !blocking.length,
    blocked: !release.connected
      ? t('Connect Expo on the computer running the host to release.')
      : !release.app.projectId || blocking.length
        ? t('Finish what the stores need in the Deploy sheet on a computer first.')
        : null,
  }
}

/** A project's databases and other resources on the phone: what each is, the variables it sets and its page. */
export function resourceRows(
  resources: ProjectResources | null,
  t: Translate,
): { id: string; name: string; detail: string; page: string }[] {
  if (!resources) return []
  return resources.resources.map((resource) => {
    const provider =
      resources.providers.find((entry) => entry.provider === resource.provider)?.name ?? resource.provider
    return {
      id: `${resource.provider}:${resource.id}`,
      name: resource.name,
      detail: [
        provider,
        resource.variables.join(', '),
        resource.previewBranch ? t('previews use their own database') : null,
      ]
        .filter(Boolean)
        .join(' · '),
      page: resource.page,
    }
  })
}
