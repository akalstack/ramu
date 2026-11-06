import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { z } from 'zod'
import { currentBranch } from '../git'
import type { DeployService } from './service'

const DEPLOY_GUIDE =
  'Deploy tools work on the project this thread belongs to, on the platform and account linked in its Deploy sheet. Call deploy_status first: it names the platform, the live address, the latest deployments and the capabilities the platform has; never call an action it does not list. Never run vercel or netlify yourself to deploy. deploy_production and deploy_rollback always ask the person; a refusal is final for this request.'

const deploymentId = z.string().trim().min(1).max(200)

/** The authenticated MCP connection supplies the session; arguments cannot choose another project or account. */
export function registerDeployTools(
  server: McpServer,
  deploys: DeployService,
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
}
