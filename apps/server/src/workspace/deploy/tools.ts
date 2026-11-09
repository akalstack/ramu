import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { z } from 'zod'
import { domainName } from '@ramu/shared/domains'
import { translate } from '@ramu/shared/i18n'
import { STORE_PERSON_STEPS, storeCheckText } from '@ramu/shared/storeRelease'
import { CLI_PLATFORMS, type CliPlatform, type DnsRecord, type UsageReport } from '@ramu/shared/types/deploy'
import { commandLine } from '@ramu/shared/stacks'
import { currentBranch } from '../git'
import type { HostingAccounts } from './accounts'
import { CLI_PLATFORM_SPECS, cliCommandReads, runPlatformCli } from './cliPlatforms'
import type { DeployWatches } from './deployWatch'
import type { DomainWatches } from './domainWatch'
import type { StoreReleases } from './release'
import type { DeployService } from './service'

const DEPLOY_GUIDE =
  'Deploy tools work on the project this thread belongs to, on the platform and account linked in its Deploy sheet. Call deploy_status first: it names the platform, the live address, the latest deployments and the capabilities the platform has; never call an action it does not list. Never run vercel or netlify yourself to deploy. A project on Railway, Fly.io, Cloudflare or Supabase has no deploy target here: use platform_cli for it. deploy_production, deploy_rollback, deploy_domain_add and deploy_domain_records always ask the person; a refusal is final for this request. deploy_production first runs the migrate command from ramu.json against the production database; a failed migration stops the deploy and returns its output to fix. Never delete a database; that is the person’s action on the provider’s page. After deploy_preview, deploy_production or a push of the production branch, Ramu wakes this thread once the deployment finishes, with its address or the end of its build log; do not poll for it.'

const deploymentId = z.string().trim().min(1).max(200)
const domain = z.string().trim().min(1).max(260)

/** One record in plain words, as an approval card names it. */
const recordText = (record: DnsRecord) =>
  record.type === 'TXT'
    ? `a TXT record named ${record.name} with the value ${record.value}`
    : `${record.type === 'A' ? 'an' : 'a'} ${record.type} record named ${record.name} pointing to ${record.value}`

/** The authenticated MCP connection supplies the session; arguments cannot choose another project or account. */
export function registerDeployTools(
  server: McpServer,
  deploys: DeployService,
  /** Domains followed until live, and deployments followed until they finish; both wake this thread. */
  watches: { domains: Pick<DomainWatches, 'watch'>; deploys: Pick<DeployWatches, 'follow'> },
  /** The project's usage reports: its hosting platform's, then its resources'. */
  usage: (projectId: string) => Promise<UsageReport[]>,
  source: AgentSessionInfo,
  projectId: string,
  current: () => AgentSessionInfo,
  projectName: () => string,
  /** Asks the person through the thread's approval card. Resolves false when refused. */
  requestApproval: (detail: string, signal?: AbortSignal) => Promise<boolean>,
) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const ask = async (detail: string, signal: AbortSignal | undefined, refusal: string) => {
    if (!(await requestApproval(detail, signal))) throw new Error(refusal)
  }
  server.registerTool(
    'deploy_status',
    {
      description: `${DEPLOY_GUIDE} Returns the deploy target, live address, capabilities and the latest deployments.`,
      inputSchema: {},
    },
    async () => {
      const status = await deploys.project(projectId)
      return result({ ...status, deployments: status.deployments.slice(0, 5) })
    },
  )
  server.registerTool(
    'deploy_logs',
    {
      description:
        'The end of a deployment’s build log (the latest deployment when no id is given). Read it before fixing a failed deploy.',
      inputSchema: { deploymentId: deploymentId.optional() },
    },
    async ({ deploymentId: id }) => {
      const target = id ?? (await deploys.project(projectId)).deployments[0]?.id
      if (!target) throw new Error('This project has no deployments yet.')
      return result({ deploymentId: target, log: await deploys.logs(projectId, target) })
    },
  )
  server.registerTool(
    'deploy_preview',
    {
      description:
        'Builds this thread’s current branch as a preview deployment, after it is pushed. Returns the deployment; this thread is woken with its address or build log when it finishes, so do not poll. Outside Full access the person approves it first.',
      inputSchema: {},
    },
    async (_args, extra) => {
      const session = current()
      if (session.id !== source.id || session.cwd !== source.cwd)
        throw new Error('The thread’s checkout changed. Reconnect before trying again.')
      const branch = await currentBranch(session.cwd)
      if (!branch) throw new Error('Check out a branch and push it before deploying a preview.')
      if (session.settings.access !== 'full')
        await ask(
          `Build the branch ${branch} of ${projectName()} as a preview deployment. Production does not change.`,
          extra.signal,
          'The person declined the preview deployment. Do not retry it without a new request.',
        )
      const deployment = await deploys.deploy(projectId, branch, false)
      watches.deploys.follow(projectId, deployment, source.parentId ?? source.id)
      return result(deployment)
    },
  )
  server.registerTool(
    'deploy_production',
    {
      description:
        'Builds the production branch and makes it live. Always asks the person with a card naming the address; a refusal is final. This thread is woken with the address or build log when the deployment finishes, so do not poll.',
      inputSchema: {},
    },
    async (_args, extra) => {
      const status = await deploys.project(projectId)
      if (!status.binding) throw new Error('This project has no deploy target yet. Ask the person to open Deploy.')
      const url = status.productionUrl ?? status.binding.siteName
      await ask(
        `Deploy ${projectName()} to production at ${url}. This builds ${status.binding.productionBranch} and replaces what visitors see now.`,
        extra.signal,
        'The person declined the production deploy. Do not retry it without a new request.',
      )
      const deployment = await deploys.deploy(projectId, null, true)
      watches.deploys.follow(projectId, deployment, source.parentId ?? source.id)
      return result(deployment)
    },
  )
  server.registerTool(
    'deploy_rollback',
    {
      description:
        'Makes an earlier production deployment live again (an id from deploy_status). Always asks the person with a card naming the address; a refusal is final.',
      inputSchema: { deploymentId },
    },
    async ({ deploymentId: id }, extra) => {
      const status = await deploys.project(projectId)
      const target = status.deployments.find((deployment) => deployment.id === id)
      const url = status.productionUrl ?? status.binding?.siteName ?? projectName()
      const when = target ? new Date(target.createdAt).toISOString().replace('T', ' ').slice(0, 16) : id
      const what = target?.message ? ` (“${target.message}”)` : ''
      await ask(
        `Roll ${url} back to the production deployment from ${when} UTC${what}. Visitors see that version instead of the current one until the next deploy.`,
        extra.signal,
        'The person declined the rollback. Do not retry it without a new request.',
      )
      await deploys.rollback(projectId, id)
      return result({ rolledBack: true, deploymentId: id, url })
    },
  )
  server.registerTool(
    'deploy_usage',
    {
      description:
        'What the project’s hosting platform and database report for the current billing period, each figure beside the plan’s limit when the platform reports one, and the billing page. Read-only. When a figure nears its limit, propose the cheapest fix as a pull request (cache pages, shrink images, build less often, delete unused data); never change a plan or add a payment method, which is the person’s action on the billing page.',
      inputSchema: {},
    },
    async () => result({ usage: await usage(projectId) }),
  )
  server.registerTool(
    'deploy_domains',
    {
      description:
        'The project’s custom domains on its platform: the DNS records each needs, whether the DNS points there, whether HTTPS is live, and whether its DNS is at the platform (so deploy_domain_records can create the records).',
      inputSchema: {},
    },
    async () => result({ domains: await deploys.domains(projectId) }),
  )
  server.registerTool(
    'deploy_domain_add',
    {
      description:
        'Adds a custom domain (such as www.example.com) to the project on its platform. Always asks the person with a card naming the domain; a refusal is final. Returns the DNS records to create; tell the person each one in plain words, or offer deploy_domain_records when its DNS is at the platform. This thread is woken once the domain serves HTTPS.',
      inputSchema: { domain },
    },
    async ({ domain: input }, extra) => {
      const name = domainName(input)
      if (!name) throw new Error('Give a domain name such as www.example.com.')
      const platform = deploys.platformName(projectId)
      if (!platform) throw new Error('This project has no deploy target yet. Ask the person to open Deploy.')
      await ask(
        `Add the domain ${name} to ${projectName()} on ${platform}. Once its DNS points there, visitors to ${name} see this app.`,
        extra.signal,
        'The person declined adding the domain. Do not retry it without a new request.',
      )
      const added = await deploys.addDomain(projectId, name)
      if (!(added.configured && added.certificate))
        watches.domains.watch(projectId, added.name, source.parentId ?? source.id)
      return result({ domain: added })
    },
  )
  server.registerTool(
    'deploy_domain_records',
    {
      description:
        'Creates the DNS records a project domain needs in the platform’s own DNS, for a domain deploy_domains lists with managedDns. Always asks the person with a card naming each record; a refusal is final.',
      inputSchema: { domain },
    },
    async ({ domain: input }, extra) => {
      const name = domainName(input)
      const found = (await deploys.domains(projectId)).find((entry) => entry.name === name)
      if (!found) throw new Error('That is not a domain of this project. Add it with deploy_domain_add first.')
      const platform = deploys.platformName(projectId) ?? 'the platform'
      if (!found.managedDns)
        throw new Error(`${found.name} does not use ${platform} DNS. Tell the person which records to add instead.`)
      await ask(
        `Change the DNS of ${found.name} in ${platform} DNS: create ${found.records.map(recordText).join(', and ')}.`,
        extra.signal,
        'The person declined the DNS change. Do not retry it without a new request.',
      )
      const updated = await deploys.createRecords(projectId, found.name)
      if (!(updated.configured && updated.certificate))
        watches.domains.watch(projectId, updated.name, source.parentId ?? source.id)
      return result({ domain: updated })
    },
  )
}

const RELEASE_GUIDE =
  'Release tools work on the Expo app of the project this thread belongs to, on the Expo account connected on this host. Call release_status first: it lists what the stores need (from app.json and eas.json), what only the person can do on the stores, and the latest store builds with their submissions. Never run eas build or eas submit yourself. release_start always asks the person; a refusal is final for this request. Ramu never submits an app for review: that is the person’s step on each store.'

/** Store releases of the project's Expo app; registered only for a project that has one. */
export function registerReleaseTools(
  server: McpServer,
  releases: Pick<StoreReleases, 'status' | 'start' | 'logs'>,
  watch: Pick<DeployWatches, 'followRelease'>,
  source: AgentSessionInfo,
  projectId: string,
  /** Asks the person through the thread's approval card. Resolves false when refused. */
  requestApproval: (detail: string, signal?: AbortSignal) => Promise<boolean>,
) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'release_status',
    {
      description: `${RELEASE_GUIDE} Returns the app, the store checks, the person’s store steps and the latest builds.`,
      inputSchema: {},
    },
    async () => {
      const status = await releases.status(projectId)
      return result({
        ...status,
        checks: status.checks.map((check) => ({
          ...check,
          text: storeCheckText((key, values) => translate('en', key, values), check),
        })),
        personSteps: STORE_PERSON_STEPS,
      })
    },
  )
  server.registerTool(
    'release_logs',
    {
      description:
        'The end of a store build’s log, or of the log of the submission made from it (an id from release_status). Read it before fixing a failed build or submission.',
      inputSchema: { buildId: z.string().uuid(), of: z.enum(['build', 'submission']).optional() },
    },
    async ({ buildId, of }) => result({ buildId, log: await releases.logs(projectId, buildId, of ?? 'build') }),
  )
  server.registerTool(
    'release_start',
    {
      description:
        'Builds the app’s default branch on EAS and uploads each build to TestFlight (iOS) and Play’s internal testing track (Android). Never submits for review. Always asks the person with a card; a refusal is final. Refused while a store check is missing. This thread is woken when each build and its upload finish, with the log on failure, so do not poll.',
      inputSchema: { platform: z.enum(['all', 'ios', 'android']).optional() },
    },
    async ({ platform }, extra) => {
      const target = platform ?? 'all'
      const status = await releases.status(projectId)
      if (!status.app) throw new Error('This project has no Expo app at the root of its repository.')
      const version = status.checks.find((check) => check.id === 'version')?.detail
      const stores =
        target === 'all'
          ? 'iOS and Android, then upload the iOS build to TestFlight and the Android build to Play’s internal testing track'
          : target === 'ios'
            ? 'iOS, then upload it to TestFlight'
            : 'Android, then upload it to Play’s internal testing track'
      if (
        !(await requestApproval(
          `Release ${status.app.name}${version ? ` ${version}` : ''} to the stores: build it on EAS for ${stores}, on the Expo account ${status.account ?? ''}. Testers you invite can install it; nothing is submitted for review.`,
          extra.signal,
        ))
      )
        throw new Error('The person declined the release. Do not retry it without a new request.')
      const builds = await releases.start(projectId, target)
      for (const build of builds) watch.followRelease(projectId, build.id, source.parentId ?? source.id)
      return result({ builds })
    },
  )
}

const CLI_GUIDE = `Runs the CLI of Railway (railway), Fly.io (fly), Cloudflare (wrangler) or Supabase (supabase) in this thread's checkout, signed in with the account the person connected in Settings → Deploy. Use it instead of running those CLIs yourself: the token is passed to the CLI in its environment and never shown, and a CLI you run yourself is signed out. Pass the arguments after the CLI's name, such as ["status"] or ["deploy", "--detach"]; never pass a token or a login command. Commands that only read (whoami, status, list, logs, help) run straight away; every other command asks the person with a card naming it, and a refusal is final for this request. Run non-interactive forms (--yes, --json, --detach, --no-tail) since there is no terminal to answer prompts. Write the platform's own config files (railway.json, fly.toml, wrangler.toml, supabase/config.toml) yourself and commit them like any change.`

/** The platforms driven through their own CLI, signed in with the token kept on this host. */
export function registerPlatformCliTools(
  server: McpServer,
  accounts: Pick<HostingAccounts, 'auth' | 'connected'>,
  source: AgentSessionInfo,
  current: () => AgentSessionInfo,
  /** Asks the person through the thread's approval card. Resolves false when refused. */
  requestApproval: (detail: string, signal?: AbortSignal) => Promise<boolean>,
  run: typeof runPlatformCli = runPlatformCli,
) {
  server.registerTool(
    'platform_cli',
    {
      description: CLI_GUIDE,
      inputSchema: {
        platform: z.enum(CLI_PLATFORMS),
        args: z.array(z.string().max(1000)).min(1).max(60),
      },
    },
    async ({ platform, args }: { platform: CliPlatform; args: string[] }, extra) => {
      const spec = CLI_PLATFORM_SPECS[platform]
      if (!accounts.connected(platform))
        throw new Error(
          `${spec.name} is not connected on this host. Ask the person to connect it in Settings → Deploy.`,
        )
      if (args.some((arg) => /^(login|logout)$/.test(arg) || /token/i.test(arg.split('=')[0] ?? '')))
        throw new Error('Sign-in is the person’s step in Settings, and the token is passed for you. Leave it out.')
      const session = current()
      if (session.id !== source.id || session.cwd !== source.cwd)
        throw new Error('The thread’s checkout changed. Reconnect before trying again.')
      const shown = `${spec.binaries[0]} ${commandLine(args)}`
      if (
        !cliCommandReads(platform, args) &&
        !(await requestApproval(`Run ${shown} on your ${spec.name} account, in ${session.cwd}.`, extra.signal))
      )
        throw new Error('The person declined this command. Do not retry it without a new request.')
      const { auth, accountId, defaultScope } = await accounts.auth(platform)
      const ran = await run(
        platform,
        args,
        session.cwd,
        { token: auth.token, accountId: defaultScope ?? accountId },
        extra.signal,
      )
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ command: shown, ...ran }) }],
        ...(ran.exitCode === 0 ? {} : { isError: true }),
      }
    },
  )
}
