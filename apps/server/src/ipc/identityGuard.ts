// The guardrail before Ramu commits, pushes, or opens or merges a pull request: the account it is
// about to use must belong to the project's identity or to every identity. A refusal names both identities; the card
// then offers Use ‹project identity› or Continue as ‹the other› (identities.useIdentity, identities.continueAs).
import { accountKey, forgeAccountKey } from '@ramu/shared/identities'
import { NO_PROJECT, type AgentSessionInfo } from '@ramu/shared/types'
import { resolvedAccountChoice } from '../workspace/forge/github'
import type { HandlerContext } from './types'

const projectOf = (ctx: Pick<HandlerContext, 'workspace'>, context: string) => {
  try {
    const projectId = ctx.workspace.projectIdOf(context)
    return projectId === NO_PROJECT ? null : projectId
  } catch {
    return null
  }
}

/** Before a push, pull request or merge from a checkout: its GitHub account, and the thread's provider login. */
export async function guardForge(
  ctx: Pick<HandlerContext, 'identities' | 'workspace' | 'agents'>,
  context: string,
  cwd: string,
  action: string,
) {
  const identities = ctx.identities
  if (!identities || identities.settings().identities.length < 2) return
  const projectId = projectOf(ctx, context)
  const key = forgeAccountKey(await resolvedAccountChoice(cwd))
  if (key) identities.guard(projectId, key, action)
  // A thread whose login was changed by hand to another identity's stops here too.
  let session: AgentSessionInfo | undefined
  try {
    session = ctx.agents
      .list(context)
      .filter((entry) => !entry.parentId)
      .at(-1)
  } catch {
    // A project or worktree view has no thread of its own.
  }
  if (session)
    identities.guard(
      projectId,
      accountKey('provider', session.settings.provider, session.settings.accountId ?? 'default'),
      action,
    )
}
