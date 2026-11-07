import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { z } from 'zod'
import { domainName } from '@ramu/shared/domains'
import type { DnsRecord, UsageReport } from '@ramu/shared/types/deploy'
import { currentBranch } from '../git'
import type { DomainWatches } from './domainWatch'
import type { DeployService } from './service'

const DEPLOY_GUIDE =
  'Deploy tools work on the project this thread belongs to, on the platform and account linked in its Deploy sheet. Call deploy_status first: it names the platform, the live address, the latest deployments and the capabilities the platform has; never call an action it does not list. Never run vercel or netlify yourself to deploy. deploy_production, deploy_rollback, deploy_domain_add and deploy_domain_records always ask the person; a refusal is final for this request. deploy_production first runs the migrate command from ramu.json against the production database; a failed migration stops the deploy and returns its output to fix. Never delete a database; that is the person’s action on the provider’s page.'

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
  watches: Pick<DomainWatches, 'watch'>,
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
        'Builds this thread’s current branch as a preview deployment, after it is pushed. Returns the deployment; check it with deploy_status and deploy_logs. Outside Full access the person approves it first.',
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
      return result(await deploys.deploy(projectId, branch, false))
    },
  )
  server.registerTool(
    'deploy_production',
    {
      description:
        'Builds the production branch and makes it live. Always asks the person with a card naming the address; a refusal is final.',
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
      return result(await deploys.deploy(projectId, null, true))
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
      if (!(added.configured && added.certificate)) watches.watch(projectId, added.name, source.parentId ?? source.id)
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
        watches.watch(projectId, updated.name, source.parentId ?? source.id)
      return result({ domain: updated })
    },
  )
}
