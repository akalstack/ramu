// The person's own server as a hosting target. The app runs there as a Docker container behind Caddy, which serves the
// domains over HTTPS with certificates it renews itself. Deploys run in the repository's GitHub Actions (build, push
// to GHCR, restart over SSH), so the server never needs Ramu running; Ramu reads those runs, dispatches the same job
// for a production deploy or a rollback, and reaches the server over SSH only for its logs, variables and domains.
import { lookup } from 'node:dns/promises'
import { z } from 'zod'
import { apexOf, recordName } from '@ramu/shared/domains'
import { DOCKER_INSTALL_PAGE, serverAppName, SERVER_WORKFLOW, SERVER_WORKFLOW_PATH } from '@ramu/shared/serverDeploy'
import type { Deployment, DeploymentState, ServerDocker } from '@ramu/shared/types/deploy'
import {
  DeployError,
  platformCall,
  registerHostingAdapter,
  tail,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
  type PlatformDomain,
} from './adapter'
import { DECODE, isIpv4, remoteCommand, runSsh, SSH_USER, type SshRunner, type SshTarget } from './ssh'

/** What the saved "token" of the server account holds: where it is, the key Ramu signs in with and its pinned key. */
const connectionSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  user: z.string().regex(SSH_USER),
  privateKey: z.string().min(1).max(16_384),
  publicKey: z.string().max(2_000).nullable(),
  knownHosts: z.string().min(1).max(8_000),
})
export type ServerConnection = z.infer<typeof connectionSchema>

export const serverConnection = (token: string): ServerConnection => connectionSchema.parse(JSON.parse(token))

export const sshTarget = (connection: ServerConnection): SshTarget => ({
  host: connection.host,
  port: connection.port,
  user: connection.user,
  privateKey: connection.privateKey,
  knownHosts: connection.knownHosts,
})

/** The checks every app script starts with: decode the values, and refuse an app name that is not one of Ramu's. */
const APP = [
  'set -eu',
  DECODE,
  'app=$(d "$1")',
  'case "$app" in ""|*[!a-z0-9-]*) echo "Unexpected app name." >&2; exit 2;; esac',
  'dir="$HOME/ramu/apps/$app"',
]

/** Who Ramu signs in as; proves the key and the pinned host key work. */
export const WHOAMI_SCRIPT = 'id -un'

/** Whether Docker is usable by this user, and whether ports 80 and 443 are free for Caddy. */
export const PROBE_SCRIPT = [
  'if ! command -v docker >/dev/null 2>&1; then echo "docker=missing"; exit 0; fi',
  'if ! docker info >/dev/null 2>&1; then echo "docker=no-permission"; exit 0; fi',
  'echo "docker=ready"',
  'echo "version=$(docker version --format "{{.Server.Version}}" 2>/dev/null || true)"',
  'if [ "$(docker inspect -f "{{.State.Running}}" ramu-caddy 2>/dev/null || true)" = "true" ]; then exit 0; fi',
  'if command -v ss >/dev/null 2>&1 && ss -ltnH 2>/dev/null | awk "{print \\$4}" | grep -Eq ":(80|443)\\$"; then echo "ports=busy"; fi',
].join('\n')

/**
 * Writes the app's Caddy site (its domains forwarding to the container's port) and starts or reloads Ramu's Caddy
 * container. Caddy gets and renews the HTTPS certificates itself once the domains point at the server.
 */
export const SETUP_SCRIPT = [
  ...APP,
  'port=$(d "$2"); domains=$(d "$3")',
  'case "$port" in ""|*[!0-9]*) echo "Unexpected port." >&2; exit 2;; esac',
  '[ -n "$domains" ] || exit 2',
  'for name in $domains; do case "$name" in *[!a-z0-9.-]*) echo "Unexpected domain." >&2; exit 2;; esac; done',
  'root="$HOME/ramu"',
  'mkdir -p "$dir" "$root/caddy/sites"',
  '[ -f "$dir/env" ] || { : > "$dir/env"; chmod 600 "$dir/env"; }',
  'printf "%s\\n" "$port" > "$dir/port"',
  'printf "%s\\n" $domains > "$dir/domains"',
  'printf "import sites/*.caddy\\n" > "$root/caddy/Caddyfile"',
  'printf "%s {\\n\\tencode gzip\\n\\treverse_proxy ramu-%s:%s\\n}\\n" "$(printf "%s" "$domains" | sed "s/ /, /g")" "$app" "$port" > "$root/caddy/sites/$app.caddy"',
  'docker network inspect ramu >/dev/null 2>&1 || docker network create ramu >/dev/null',
  'state=$(docker inspect -f "{{.State.Running}}" ramu-caddy 2>/dev/null || echo none)',
  'if [ "$state" = "true" ]; then docker exec ramu-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null',
  'elif [ "$state" = "false" ]; then docker start ramu-caddy >/dev/null',
  'else docker run -d --name ramu-caddy --network ramu --restart unless-stopped -p 80:80 -p 443:443 -p 443:443/udp -v "$root/caddy:/etc/caddy:ro" -v ramu-caddy-data:/data -v ramu-caddy-config:/config caddy:2 >/dev/null',
  'fi',
  'echo ok',
].join('\n')

/** The app's port and domains as the server keeps them. */
const INFO_SCRIPT = [
  ...APP,
  'printf "port=%s\\n" "$(cat "$dir/port" 2>/dev/null || true)"',
  'printf "domains=%s\\n" "$(cat "$dir/domains" 2>/dev/null | tr "\\n" " " || true)"',
].join('\n')

const LOGS_SCRIPT = [
  ...APP,
  'lines=$(d "$2")',
  'case "$lines" in ""|*[!0-9]*) exit 2;; esac',
  'docker logs --tail "$lines" "ramu-$app" 2>&1 || echo "The app is not running on the server."',
].join('\n')

/** Variable names only: the values stay in the server's env file, readable by the SSH user alone. */
const ENV_NAMES_SCRIPT = [...APP, '[ -f "$dir/env" ] && sed -n "s/=.*//p" "$dir/env" || true'].join('\n')

/**
 * Merges `NAME=value` lines from standard input into the env file (a name already there is replaced), then recreates
 * the running container so it reads them. Values travel only on standard input, never in the command line.
 */
const ENV_SET_SCRIPT = [
  ...APP,
  'mkdir -p "$dir"',
  'umask 077',
  'incoming=$(mktemp "$dir/.env.XXXXXX"); merged=$(mktemp "$dir/.env.XXXXXX")',
  'cat > "$incoming"',
  'touch "$dir/env"',
  'awk -F= "NR==FNR { seen[\\$1] = 1; next } !(\\$1 in seen)" "$incoming" "$dir/env" > "$merged"',
  'cat "$incoming" >> "$merged"',
  'mv "$merged" "$dir/env"; rm -f "$incoming"',
  'if [ -f "$dir/image" ] && docker inspect "ramu-$app" >/dev/null 2>&1; then',
  '  docker rm -f "ramu-$app" >/dev/null',
  '  docker run -d --name "ramu-$app" --network ramu --restart unless-stopped --env-file "$dir/env" --label "dev.ramu.app=$app" "$(cat "$dir/image")" >/dev/null',
  'fi',
].join('\n')

/** Reads a `key=value` reply of the scripts above. */
export function replyFields(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

/** The probe's answer: whether Docker can run the app, and whether Caddy can have ports 80 and 443. */
export function probeResult(stdout: string): { docker: ServerDocker; version: string | null; portsBusy: boolean } {
  const fields = replyFields(stdout)
  const docker: ServerDocker =
    fields.docker === 'ready' ? 'ready' : fields.docker === 'no-permission' ? 'no-permission' : 'missing'
  return { docker, version: fields.version || null, portsBusy: fields.ports === 'busy' }
}

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

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const LIST_LIMIT = 30
const POLL_TRIES = 5

export function serverAdapter(
  options: {
    ssh?: SshRunner
    api?: string
    fetch?: typeof fetch
    /** The server's IPv4 address for DNS records, when it is given by name. */
    address?: (host: string) => Promise<string | null>
    pollMs?: number
  } = {},
): HostingAdapter {
  const ssh = options.ssh ?? runSsh
  const api = options.api ?? 'https://api.github.com'
  const fetcher = options.fetch ?? fetch
  const pollMs = options.pollMs ?? 2_000
  const address =
    options.address ??
    (async (host: string) => {
      const found = await lookup(host, { family: 4 }).catch(() => null)
      return found?.address ?? null
    })

  /** Runs one fixed script on the server; a script that fails reports its first lines of error output. */
  const remote = async (auth: HostingAuth, script: string, values: string[], what: string, input = '') => {
    const connection = serverConnection(auth.token)
    const result = await ssh(sshTarget(connection), remoteCommand(script, values), input)
    if (result.code !== 0)
      throw new DeployError(
        `The server failed while ${what}${result.stderr.trim() ? `: ${tail(result.stderr, 6)}` : '.'}`,
        null,
      )
    return result.stdout
  }

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
      `/repos/${site.siteId}/actions/workflows/${SERVER_WORKFLOW}/runs?per_page=${Math.min(limit + 10, 100)}`,
      'reading the deploy runs',
    )
    // A run skipped because CI failed deployed nothing.
    return (workflow_runs ?? []).filter((run) => run.conclusion !== 'skipped').slice(0, limit)
  }

  const run = async (auth: HostingAuth, site: HostingSite, id: string) => {
    if (!/^\d{1,20}$/.test(id)) throw new DeployError('That is not a deploy run of this project.', 'not-found')
    const found = await github<WorkflowRun>(auth, `/repos/${site.siteId}/actions/runs/${id}`, 'reading the deploy run')
    if ((found.path ?? '').split('@')[0] !== SERVER_WORKFLOW_PATH)
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
        `/repos/${site.siteId}/actions/workflows/${SERVER_WORKFLOW}/dispatches`,
        'starting the deploy job',
        { method: 'POST', body: JSON.stringify({ ref, inputs, return_run_details: true }) },
      )
    } catch (error) {
      if (error instanceof DeployError && error.kind === 'not-found')
        throw new DeployError(
          `GitHub has no ${SERVER_WORKFLOW_PATH} on ${ref}. Merge the pull request that adds the deploy job first.`,
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

  const info = async (auth: HostingAuth, site: HostingSite) => {
    const fields = replyFields(
      await remote(auth, INFO_SCRIPT, [serverAppName(site.siteId)], 'reading the app’s settings'),
    )
    return {
      port: fields.port ?? '',
      domains: (fields.domains ?? '').split(/\s+/).filter(Boolean),
    }
  }

  return {
    id: 'server',
    name: 'Own server',
    tokenPage: DOCKER_INSTALL_PAGE,
    async account(auth) {
      const connection = serverConnection(auth.token)
      await remote(auth, WHOAMI_SCRIPT, [], 'checking the sign-in')
      const where = connection.port === 22 ? connection.host : `${connection.host}:${connection.port}`
      return {
        id: `${connection.user}@${connection.host}:${connection.port}`,
        name: `${connection.user}@${where}`,
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    async listDeployments(auth, site, limit) {
      return (await runs(auth, site, Math.min(limit, LIST_LIMIT))).map(deploymentOf)
    },
    async deploymentStatus(auth, site, id) {
      return deploymentOf(await run(auth, site, id))
    },
    async deploymentLogs(auth, site, id, lines) {
      if (!/^\d{1,20}$/.test(id)) throw new DeployError('That is not a deploy run of this project.', 'not-found')
      const { jobs } = await github<{ jobs?: { id: number }[] }>(
        auth,
        `/repos/${site.siteId}/actions/runs/${id}/jobs`,
        'reading the deploy job',
      )
      const job = jobs?.[0]
      let log = job ? await jobLog(auth, site, job.id) : ''
      log = tail(
        // eslint-disable-next-line no-control-regex -- terminal colour codes in the job log
        log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, ''),
        lines,
      )
      // The container's own output belongs to the version running now, the newest finished deploy.
      const live = (await runs(auth, site, 10)).map(deploymentOf).find((entry) => entry.state === 'ready')
      if (live?.id !== id) return log
      const app = await remote(auth, LOGS_SCRIPT, [serverAppName(site.siteId), String(lines)], 'reading the app’s log')
      return `${log}\n\n${tail(app, lines)}`.trim()
    },
    async productionUrl(_auth, site) {
      return `https://${site.siteName}`
    },
    capabilities: {
      deployProduction: (auth, site, ref) => dispatch(auth, site, ref, {}),
      async rollback(auth, site, id) {
        const target = deploymentOf(await run(auth, site, id))
        if (!target.commit || !target.ref) throw new DeployError('That deploy names no commit to put back.', null)
        await dispatch(auth, site, target.ref, { tag: target.commit })
      },
      environment: {
        environments: ['production'],
        async list(auth, site) {
          const names = await remote(auth, ENV_NAMES_SCRIPT, [serverAppName(site.siteId)], 'reading the variables')
          return { production: names.split('\n').filter((name) => VARIABLE.test(name)) }
        },
        async set(auth, site, _environment, values) {
          const lines = Object.entries(values).map(([name, value]) => {
            if (!VARIABLE.test(name)) throw new Error(`${name} is not a variable name the server can keep.`)
            // Docker's env file holds one line per variable.
            if (/[\r\n\0]/.test(value)) throw new Error(`${name} spans several lines; the server keeps one line each.`)
            return `${name}=${value}`
          })
          await remote(
            auth,
            ENV_SET_SCRIPT,
            [serverAppName(site.siteId)],
            'writing the variables',
            `${lines.join('\n')}\n`,
          )
        },
      },
      domains: {
        async list(auth, site): Promise<PlatformDomain[]> {
          const { domains } = await info(auth, site)
          const { host } = serverConnection(auth.token)
          const ip = isIpv4(host) ? host : await address(host)
          return domains.map((name) => {
            const zone = apexOf(name)
            return {
              name,
              records: ip ? [{ type: 'A', host: name, name: recordName(name, zone), value: ip }] : [],
              configured: null,
              certificate: null,
              managedDns: false,
              zone,
            }
          })
        },
        async add(auth, site, name) {
          const { port, domains } = await info(auth, site)
          if (domains.includes(name)) return
          await remote(
            auth,
            SETUP_SCRIPT,
            [serverAppName(site.siteId), port, [...domains, name].join(' ')],
            'adding the domain to Caddy',
          )
        },
        async createRecords() {
          throw new Error('Your server has no DNS of its own. Add the records at your domain provider.')
        },
      },
    },
  }

  /** A job's log: GitHub answers with a short-lived link to the file, fetched without the token. */
  async function jobLog(auth: HostingAuth, site: HostingSite, job: number): Promise<string> {
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
}

registerHostingAdapter(serverAdapter())
