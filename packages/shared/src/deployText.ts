// Words for a project's deployments, uptime and usage, shared by the desktop Deploy sheet and the phone's Deployments
// view so both describe them the same way. Pure: the clients pass their own translation and date formatting.
import type { Translate } from './forgeStatus'
import type { Deployment, DeploymentState, ProjectDeployment, UptimeCheck, UsageFigure } from './types/deploy'

/** English labels; pass through `t()`. */
export const DEPLOYMENT_STATE: Record<DeploymentState, string> = {
  queued: 'Queued',
  building: 'Building',
  ready: 'Ready',
  failed: 'Failed',
  canceled: 'Canceled',
}

const METRIC: Record<Exclude<UsageFigure['metric'], 'service'>, string> = {
  'build-minutes': 'Build minutes',
  storage: 'Database storage',
  compute: 'Database compute',
  transfer: 'Data transfer',
}

/** The production deployment visitors see now, as far as the list tells: the newest one that finished building. */
export function liveDeployment(status: ProjectDeployment): Deployment | null {
  return status.deployments.find((deployment) => deployment.production && deployment.state === 'ready') ?? null
}

/** Roll back is offered for an earlier production deployment that finished building, on a platform that can. */
export function canRollBackTo(status: ProjectDeployment, deployment: Deployment): boolean {
  const live = liveDeployment(status)
  return (
    status.capabilities.includes('rollback') &&
    deployment.production &&
    deployment.state === 'ready' &&
    !!live &&
    deployment.id !== live.id
  )
}

/** A usage figure at 80% of its limit or more, which the clients mark as a warning. */
export const nearLimit = (figure: UsageFigure) => !!figure.limit && figure.used >= figure.limit * 0.8

export function deployText(t: Translate, time: (at: number) => string) {
  const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })

  /** A figure in the unit a person reads: bytes as MB or GB, seconds as hours. */
  function amount(value: number, unit: string): string {
    if (unit === 'bytes')
      return value >= 1024 ** 3
        ? t('{0} GB', { 0: number(value / 1024 ** 3) })
        : t('{0} MB', { 0: number(value / 1024 ** 2) })
    if (unit === 'seconds') return t('{0} hours', { 0: number(value / 3600) })
    if (unit === 'minutes') return t('{0} minutes', { 0: number(value) })
    return `${number(value)} ${unit}`.trim()
  }

  return {
    usageFigure(figure: UsageFigure): string {
      const name = figure.metric === 'service' ? (figure.service ?? '') : t(METRIC[figure.metric])
      const used = amount(figure.used, figure.unit)
      if (!figure.limit) return t('{0}: {1}', { 0: name, 1: used })
      return t('{0}: {1} of {2} ({3}%)', {
        0: name,
        1: used,
        2: amount(figure.limit, figure.unit),
        3: String(Math.round((figure.used / figure.limit) * 100)),
      })
    },

    uptimeCheck(check: UptimeCheck): string {
      const answer =
        check.status !== null
          ? t('HTTP {0} in {1} ms', { 0: String(check.status), 1: String(check.ms ?? 0) })
          : check.failure === 'timeout'
            ? t('no answer within 10 seconds')
            : check.failure === 'redirects'
              ? t('too many redirects')
              : t('could not connect')
      if (check.result === 'up') return t('Up · {0} · checked {1}', { 0: answer, 1: time(check.at) })
      if (check.result === 'down') return t('Not answering · {0} · checked {1}', { 0: answer, 1: time(check.at) })
      return t('Unknown · this computer was offline or asleep at {0}', { 0: time(check.at) })
    },

    /** What a deployment is, after its state: production or preview, the branch and when it started. */
    deploymentDetail(deployment: Deployment): string {
      return [deployment.production ? t('Production') : t('Preview'), deployment.ref, time(deployment.createdAt)]
        .filter(Boolean)
        .join(' · ')
    },
  }
}

/**
 * The pull request card's preview line: the preview's address once it is ready, or how far its build got. Null when
 * the platform lists none for the branch, or it was canceled.
 */
export function previewLine(
  deployment: Deployment | null,
  t: Translate,
): { text: string; url: string | null; tone: 'ok' | 'pending' | 'bad' } | null {
  if (!deployment || deployment.state === 'canceled') return null
  if (deployment.state === 'failed') return { text: t('Preview failed'), url: null, tone: 'bad' }
  if (deployment.state !== 'ready') return { text: t('Preview building…'), url: null, tone: 'pending' }
  if (!deployment.url) return null
  const host = deployment.url.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '')
  return { text: t('Preview at {0}', { 0: host }), url: deployment.url, tone: 'ok' }
}
