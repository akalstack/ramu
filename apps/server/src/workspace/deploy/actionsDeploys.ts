// Deploys made by a GitHub Actions job in the repository, for targets without a Git integration (the person's own
// server, Fly.io). The job's runs are the deployments; Ramu dispatches the same job for a production deploy, and with
// an earlier commit's `tag` for a rollback. Only runs of that one workflow file are read or dispatched.
import type { Deployment, DeploymentState } from '@ramu/shared/types/deploy'
import { DeployError, platformCall, tail, type HostingAuth, type HostingSite } from './adapter'

interface WorkflowRun {
  id: number
  status?: string
  conclusion?: string | null
  head_branch?: string | null
  head_sha?: string
  display_title?: string
  created_at?: string
  path?: string
  head_commit?: { message?: string } | null
}

const STATES: Record<string, DeploymentState> = {
  queued: 'queued',
  requested: 'queued',
  waiting: 'queued',
  pending: 'queued',
  in_progress: 'building',
}

function runState(run: WorkflowRun): DeploymentState {
  if (run.status !== 'completed') return STATES[run.status ?? 'queued'] ?? 'queued'
  if (run.conclusion === 'success') return 'ready'
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') return 'canceled'
  return 'failed'
}

/** A run of the deploy job as a deployment. Its title names the commit it deployed, which a rollback sets. */
function deploymentOf(run: WorkflowRun): Deployment {
  const commit = /Deploy ([0-9a-f]{40})/.exec(run.display_title ?? '')?.[1] ?? run.head_sha ?? null
  return {
    id: String(run.id),
    state: runState(run),
    url: null,
    production: true,
    ref: run.head_branch ?? null,
    commit,
    message: commit && commit === run.head_sha ? (run.head_commit?.message?.split('\n')[0] ?? null) : null,
    createdAt: run.created_at ? Date.parse(run.created_at) : 0,
  }
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Ramu',
}

const LIST_LIMIT = 30
const POLL_TRIES = 5

/**
 * The deploy job in `workflow` (a file in `.github/workflows/`) of the repository a binding's `siteId` names
 * (`owner/name`), reached with the GitHub token of the account that reaches it.
 */
export function actionsDeploys(options: { workflow: string; api: string; fetch: typeof fetch; pollMs: number }) {
  const { workflow, api, fetch: fetcher, pollMs } = options
  const workflowPath = `.github/workflows/${workflow}`

  const github = async <T>(auth: HostingAuth, path: string, what: string, init: RequestInit = {}) => {
    if (!auth.github) throw new DeployError('Link this project to its GitHub repository first.', 'not-found')
    return platformCall<T>(
      'GitHub',
      fetcher,
      `${api}${path}`,
      { ...init, token: await auth.github(), headers: GITHUB_HEADERS },
      what,
    )
  }

  const runs = async (auth: HostingAuth, site: HostingSite, limit: number) => {
    const { workflow_runs } = await github<{ workflow_runs?: WorkflowRun[] }>(
      auth,
      `/repos/${site.siteId}/actions/workflows/${workflow}/runs?per_page=${Math.min(limit + 10, 100)}`,
      'reading the deploy runs',
    )
    // A run skipped because CI failed deployed nothing.
    return (workflow_runs ?? []).filter((run) => run.conclusion !== 'skipped').slice(0, limit)
  }

  const run = async (auth: HostingAuth, site: HostingSite, id: string) => {
    if (!/^\d{1,20}$/.test(id)) throw new DeployError('That is not a deploy run of this project.', 'not-found')
    const found = await github<WorkflowRun>(auth, `/repos/${site.siteId}/actions/runs/${id}`, 'reading the deploy run')
    if ((found.path ?? '').split('@')[0] !== workflowPath)
      throw new DeployError('That is not a deploy run of this project.', 'not-found')
    return found
  }

  /** Starts the deploy job and answers with its run, read from GitHub's reply or the runs started since. */
  const dispatch = async (auth: HostingAuth, site: HostingSite, ref: string, inputs: Record<string, string>) => {
    const since = Date.now() - 5_000
    let reply: { workflow_run_id?: number } | null
    try {
      reply = await github<{ workflow_run_id?: number } | null>(
        auth,
        `/repos/${site.siteId}/actions/workflows/${workflow}/dispatches`,
        'starting the deploy job',
        { method: 'POST', body: JSON.stringify({ ref, inputs, return_run_details: true }) },
      )
    } catch (error) {
      if (error instanceof DeployError && error.kind === 'not-found')
        throw new DeployError(
          `GitHub has no ${workflowPath} on ${ref}. Merge the pull request that adds the deploy job first.`,
          'not-found',
          error.status,
          { cause: error },
        )
      throw error
    }
    if (reply?.workflow_run_id) return deploymentOf(await run(auth, site, String(reply.workflow_run_id)))
    for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
      const started = (await runs(auth, site, 5)).find((entry) => Date.parse(entry.created_at ?? '') >= since)
      if (started) return deploymentOf(started)
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    throw new DeployError('GitHub started the deploy job but has not listed its run yet. Check again shortly.', null)
  }

  /** A job's log: GitHub answers with a short-lived link to the file, fetched without the token. */
  const jobLog = async (auth: HostingAuth, site: HostingSite, job: number): Promise<string> => {
    if (!auth.github) return ''
    const response = await fetcher(`${api}/repos/${site.siteId}/actions/jobs/${job}/logs`, {
      redirect: 'manual',
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${await auth.github()}` },
    }).catch(() => null)
    const location = response?.headers.get('location')
    await response?.body?.cancel().catch(() => undefined)
    if (!location?.startsWith('https://') && !location?.startsWith(api)) return ''
    const file = await fetcher(location, { redirect: 'error' }).catch(() => null)
    return file?.ok ? await file.text() : ''
  }

  return {
    async list(auth: HostingAuth, site: HostingSite, limit: number) {
      return (await runs(auth, site, Math.min(limit, LIST_LIMIT))).map(deploymentOf)
    },
    async status(auth: HostingAuth, site: HostingSite, id: string) {
      return deploymentOf(await run(auth, site, id))
    },
    /** The end of the run's job log, without timestamps or terminal colours. */
    async log(auth: HostingAuth, site: HostingSite, id: string, lines: number) {
      if (!/^\d{1,20}$/.test(id)) throw new DeployError('That is not a deploy run of this project.', 'not-found')
      const { jobs } = await github<{ jobs?: { id: number }[] }>(
        auth,
        `/repos/${site.siteId}/actions/runs/${id}/jobs`,
        'reading the deploy job',
      )
      const job = jobs?.[0]
      const log = job ? await jobLog(auth, site, job.id) : ''
      return tail(
        // eslint-disable-next-line no-control-regex -- terminal colour codes in the job log
        log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, ''),
        lines,
      )
    },
    deploy: (auth: HostingAuth, site: HostingSite, ref: string) => dispatch(auth, site, ref, {}),
    /** Dispatches the job with the earlier deployment's commit, which it deploys again without building. */
    async rollback(auth: HostingAuth, site: HostingSite, id: string) {
      const target = deploymentOf(await run(auth, site, id))
      if (!target.commit || !target.ref) throw new DeployError('That deploy names no commit to put back.', null)
      await dispatch(auth, site, target.ref, { tag: target.commit })
    },
  }
}
