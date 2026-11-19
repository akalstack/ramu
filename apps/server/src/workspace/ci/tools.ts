import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { draftCi } from './setup'

/** `ci_setup` writes the CI file into the thread's own checkout; the authenticated session picks the checkout. */
export function registerCiTools(server: McpServer, source: AgentSessionInfo, current: () => AgentSessionInfo) {
  server.registerTool(
    'ci_setup',
    {
      description:
        'Writes the CI workflow for this thread’s repository (.github/workflows/ci.yml, or .gitlab-ci.yml on GitLab) from its lockfile, scripts and ramu.json: a cached install, then the lint, typecheck, test and build steps it has, on pull requests and pushes to the default branch. Review the file before committing: add monorepo filters, services such as Postgres that the tests need, and environment variables (as secrets, never values). Then commit it on a branch and open a pull request. When the file exists already it is left alone and returned.',
      inputSchema: {},
    },
    async () => {
      const session = current()
      if (session.id !== source.id || session.cwd !== source.cwd)
        throw new Error('The thread’s checkout changed. Reconnect before trying again.')
      const { workflow, written, existing } = await draftCi(session.cwd)
      const result = {
        path: workflow.path,
        forge: workflow.forge,
        toolchain: workflow.toolchain,
        steps: workflow.steps,
        written,
        ...(existing === null ? { content: workflow.content } : { existing, generated: workflow.content }),
        next: written
          ? 'Review and adjust the file, then commit it on a branch and open a pull request.'
          : 'The repository already has this file. Compare it with the generated one and change it only if the person asks.',
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )
}
