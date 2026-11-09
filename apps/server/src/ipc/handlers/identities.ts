import { z } from 'zod'
import {
  accountKey,
  identitySchema,
  forgeAccountKey,
  forgeChoiceOf,
  type IdentityAccountOption,
  type IdentityRule,
} from '@ramu/shared/identities'
import { AGENT_PROVIDERS, accountName, providerName } from '@ramu/shared/providers/providers'
import { connectionSummary, forgeRemoteOf } from '../../workspace/forge/github'
import { git } from '../../workspace/git'
import type { HandlerContext, RegisterHandlers } from '../types'

const id = z.string().min(1).max(100)
/** Labels are built here in English, like the rest of this list, and never show a login's internal id. */
const english = (text: string, values: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
const rule = identitySchema.shape.rules.element
const author = identitySchema.shape.gitAuthor

/** Every account connected on this host that an identity can hold. Names only; never a credential. */
export async function identityAccounts(
  ctx: Pick<HandlerContext, 'loadPreferences' | 'deploys' | 'getSharedMcp' | 'plugins' | 'hostBrowser'>,
): Promise<IdentityAccountOption[]> {
  const options: IdentityAccountOption[] = []
  const binaries = ctx.loadPreferences().providerBinaries
  for (const provider of AGENT_PROVIDERS) {
    const config = binaries[provider]
    if (config?.enabled === false) continue
    if (config?.defaultAccountEnabled !== false)
      options.push({
        key: accountKey('provider', provider, 'default'),
        kind: 'provider',
        label: `${providerName(provider)} · ${accountName(binaries, provider, 'default', undefined, english)}`,
        email: null,
      })
    for (const account of config?.accounts ?? [])
      options.push({
        key: accountKey('provider', provider, account.id),
        kind: 'provider',
        label: `${providerName(provider)} · ${accountName(binaries, provider, account.id, undefined, english)}`,
        email: account.name && account.name.includes('@') ? account.name : null,
      })
  }
  const forge = await connectionSummary(false).catch(() => null)
  for (const saved of forge?.saved ?? [])
    options.push({
      key: forgeAccountKey(saved.id)!,
      kind: 'forge',
      label: `${saved.origin} · ${saved.login ?? 'token'}`,
      email: null,
    })
  for (const account of forge?.accounts ?? [])
    options.push({
      key: forgeAccountKey(`cli:${account.login}`)!,
      kind: 'forge',
      label: `${account.host} · ${account.login} (gh)`,
      email: null,
    })
  for (const account of (await ctx.deploys?.accounts.list(false, () => false).catch(() => [])) ?? [])
    if (account.connected)
      options.push({
        key: accountKey(account.kind === 'media' ? 'media' : 'hosting', account.platform),
        kind: account.kind === 'media' ? 'media' : 'hosting',
        label: `${account.name} · ${account.account ?? ''}`.replace(/ · $/, ''),
        email: account.account?.includes('@') ? account.account : null,
      })
  if (ctx.getSharedMcp)
    for (const connection of ctx.getSharedMcp().policy.snapshot().connections)
      options.push({
        key: accountKey('mcp', connection.id),
        kind: 'mcp',
        label: `MCP · ${connection.name}`,
        email: null,
      })
  for (const plugin of ctx.plugins?.list() ?? [])
    options.push({
      key: accountKey('plugin', plugin.id),
      kind: 'plugin',
      label: `Plugin · ${plugin.name}`,
      email: null,
    })
  try {
    for (const profile of ctx.hostBrowser?.catalog().profiles ?? [])
      if (profile.id !== 'temporary')
        options.push({
          key: accountKey('browser', profile.id),
          kind: 'browser',
          label: `Browser · ${profile.name}`,
          email: null,
        })
  } catch {
    // No host browser on this machine: nothing to assign.
  }
  return options
}

/** Identities: readable by paired devices; edits need the device's settings permission like any host setting. */
export const registerIdentityHandlers: RegisterHandlers = (ctx) => {
  const service = () => {
    if (!ctx.identities) throw new Error('Update this host for identities')
    return ctx.identities
  }
  const snapshot = async () => ({
    settings: service().settings(),
    projects: service().projects(),
    accounts: await identityAccounts(ctx),
    suggestions: service()
      .projects()
      .flatMap((entry) => {
        const rule = service().suggestion(entry.projectId)
        return rule ? [{ projectId: entry.projectId, rule }] : []
      }),
    gitUser: service().gitUser(),
  })
  return {
    'identities.get': { args: z.tuple([]), run: snapshot },
    'identities.add': {
      args: z.tuple([
        z.object({
          name: identitySchema.shape.name,
          gitAuthor: author,
          rules: z.array(rule).max(40).optional(),
          color: identitySchema.shape.color.optional(),
          id: id.optional(),
        }),
      ]),
      run: async (input: Parameters<ReturnType<typeof service>['add']>[0]) => {
        service().add(input)
        return snapshot()
      },
    },
    'identities.update': {
      args: z.tuple([
        id,
        z.object({
          name: identitySchema.shape.name.optional(),
          color: identitySchema.shape.color.optional(),
          gitAuthor: author.optional(),
          rules: z.array(rule).max(40).optional(),
          isDefault: z.literal(true).optional(),
        }),
      ]),
      run: async (identityId: string, patch: Parameters<ReturnType<typeof service>['update']>[1]) => {
        service().update(identityId, patch)
        return snapshot()
      },
    },
    'identities.remove': {
      args: z.tuple([id, id.nullable()]),
      run: async (identityId: string, moveTo: string | null) => {
        service().remove(identityId, moveTo)
        return snapshot()
      },
    },
    'identities.pin': {
      args: z.tuple([z.string().min(1).max(200), id.nullable()]),
      run: async (projectId: string, identityId: string | null) => {
        service().pin(projectId, identityId)
        return snapshot()
      },
    },
    'identities.assign': {
      args: z.tuple([z.string().min(1).max(400), z.array(id).max(12)]),
      run: async (key: string, identityIds: string[]) => {
        service().assign(key, identityIds)
        return snapshot()
      },
    },
    'identities.suggestion': {
      args: z.tuple([z.string().min(1).max(200)]),
      run: (projectId: string) => service().suggestion(projectId),
    },
    /** "Projects from github.com/acme use Work?": yes adds the rule, either answer stops asking for this project. */
    'identities.answerSuggestion': {
      args: z.tuple([z.string().min(1).max(200), id.nullable(), rule.nullable()]),
      run: async (projectId: string, identityId: string | null, accepted: IdentityRule | null) => {
        const identities = service()
        if (identityId && accepted) {
          const identity = identities.settings().identities.find((entry) => entry.id === identityId)
          if (!identity) throw new Error('That identity is not on this host.')
          identities.update(identityId, { rules: [...identity.rules, accepted] })
        }
        identities.offered(projectId)
        return snapshot()
      },
    },
    'identities.mismatch': {
      args: z.tuple([z.string().min(1).max(200).nullable()]),
      run: (projectId: string | null) => service().mismatch(projectId),
    },
    /** Continue as the other identity: the stopped action may run once. */
    'identities.continueAs': {
      args: z.tuple([z.string().min(1).max(200).nullable()]),
      run: (projectId: string | null) => service().continueAs(projectId),
    },
    /** Use the project's identity: points this repository at that identity's own GitHub account. */
    'identities.useIdentity': {
      args: z.tuple([z.string().min(1).max(200), z.string().min(1).max(200)]),
      run: async (taskId: string, repoId: string) => {
        const projectId = ctx.workspace.projectIdOf(taskId)
        const mismatch = service().mismatch(projectId)
        if (!mismatch) throw new Error('Nothing is waiting for that choice. Try the action again.')
        const own = service().ownAccount(projectId, mismatch.accountKey)
        const choice = own ? forgeChoiceOf(own) : null
        if (!choice)
          throw new Error(
            `${mismatch.expected.name} has no account of this kind. Connect one and put it in ${mismatch.expected.name}.`,
          )
        const repo = ctx.workspace.listRepositories(projectId).find((entry) => entry.id === repoId)
        if (!repo) throw new Error('Unknown repository.')
        const remote = await forgeRemoteOf(repo.root)
        if (!remote) throw new Error('This repository has no GitHub remote.')
        ctx.forgeAccounts.setRepositoryAccount(remote.origin, remote.owner, remote.repo, choice)
        return { identity: mismatch.expected.name }
      },
    },
    /** Sets `user.name` and `user.email` in each of the project's repositories, for commits made outside Ramu. */
    'identities.writeGitConfig': {
      args: z.tuple([z.string().min(1).max(200)]),
      run: async (projectId: string) => {
        const identity = service().forProject(projectId)
        if (!identity) throw new Error('This project has no identity yet.')
        const repositories = ctx.workspace.listRepositories(projectId)
        for (const repo of repositories) {
          await git(repo.root, ['config', '--local', 'user.name', identity.gitAuthor.name])
          await git(repo.root, ['config', '--local', 'user.email', identity.gitAuthor.email])
        }
        return { repositories: repositories.length, email: identity.gitAuthor.email }
      },
    },
  }
}
