import { z } from 'zod'
import { accountKindOf, normalizeIdentities, type IdentitySettings } from '@ramu/shared/identities'
import {
  TOOL_GROUP,
  TRANSFER_GROUP_IDS,
  portablePreferences,
  settingsExportSchema,
  transferChanges,
  type SettingsExport,
  type TransferGroup,
} from '@ramu/shared/settingsTransfer'
import type { AgentProvider, ModelPreferences } from '@ramu/shared/types'
import { TOOL_KINDS } from '@ramu/shared/toolSync'
import { portableTools, receiveTools, toolsHere } from '../../toolSync'
import { identityAccounts } from './identities'
import type { HandlerContext, RegisterHandlers } from '../types'
import { hostDisplayName } from '../../remote/hostName'

const groups = z.array(z.enum(TRANSFER_GROUP_IDS as [TransferGroup, ...TransferGroup[]])).max(TRANSFER_GROUP_IDS.length)

/** What an export reads: the IPC context, or the same pieces the host's account service holds. */
export type TransferSources = Pick<
  HandlerContext,
  | 'loadPreferences'
  | 'workspace'
  | 'rules'
  | 'identities'
  | 'memory'
  | 'mediaAccounts'
  | 'getSharedMcp'
  | 'plugins'
  | 'hostBrowser'
  | 'learning'
>

const models = (ctx: Pick<HandlerContext, 'workspace'>) =>
  ctx.workspace.getAppState<ModelPreferences | null>('model-preferences', null)

/** This host's portable settings, in the groups asked for. */
export async function exportSettings(ctx: TransferSources, chosen: TransferGroup[]): Promise<SettingsExport> {
  const file: SettingsExport = {
    format: 'ramu-settings',
    version: 2,
    exportedAt: Date.now(),
    host: hostDisplayName(),
    groups: chosen,
    preferences: portablePreferences(ctx.loadPreferences(), chosen),
  }
  if (chosen.includes('models')) file.models = models(ctx)
  if (chosen.includes('rules') && ctx.rules)
    file.rules = ctx.rules
      .list()
      .filter((rule) => rule.projectId === null || rule.projectId.startsWith('identity:'))
      .map((rule) => ({
        name: rule.name,
        body: rule.body,
        activation: rule.activation,
        paths: rule.paths,
        providers: rule.providers,
        enabled: rule.enabled,
        identityId: rule.projectId?.startsWith('identity:') ? rule.projectId.slice(9) : null,
      }))
  if (chosen.includes('identities') && ctx.identities) {
    const settings = ctx.identities.settings()
    const options = await identityAccounts(ctx)
    file.identities = {
      identities: settings.identities,
      accounts: Object.entries(settings.accounts).flatMap(([key, owners]) => {
        const option = options.find((entry) => entry.key === key)
        return option
          ? [{ kind: accountKindOf(key), label: option.label, email: option.email, identities: owners }]
          : []
      }),
    }
  }
  if (chosen.includes('memories') && ctx.memory)
    file.memories = ctx.memory
      .active(null)
      .filter((entry) => entry.projectId === null && (entry.kind === 'user' || entry.kind === 'feedback'))
      .map((entry) => ({
        kind: entry.kind as 'user' | 'feedback',
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        importance: entry.importance,
      }))
  const kinds = TOOL_KINDS.filter((kind) => chosen.includes(TOOL_GROUP[kind]))
  if (kinds.length) {
    const { tools, skipped } = portableTools(ctx, kinds)
    file.tools = tools
    file.skippedTools = skipped
  }
  return settingsExportSchema.parse(file)
}

/** What the import would change here, and the accounts an identity names that this host has not connected. */
async function preview(ctx: HandlerContext, file: SettingsExport, chosen: TransferGroup[]) {
  const identities = ctx.identities?.settings() ?? { identities: [], accounts: {}, pins: {} }
  const changes = transferChanges(
    {
      preferences: ctx.loadPreferences(),
      models: models(ctx),
      rules: ctx.rules?.list() ?? [],
      identities,
      notes: ctx.memory?.active(null).filter((entry) => entry.projectId === null) ?? [],
      tools: toolsHere(ctx),
    },
    file,
    chosen,
  )
  const here = chosen.includes('identities') ? await identityAccounts(ctx) : []
  const connectHere = chosen.includes('identities')
    ? (file.identities?.accounts ?? [])
        .filter((account) => !matchAccount(here, account))
        .map((account) => account.label)
    : []
  return { changes, connectHere }
}

/** The same account on this host: the same kind and sign-in email, or the same label when neither names an email. */
const matchAccount = (
  here: Awaited<ReturnType<typeof identityAccounts>>,
  account: { kind: string; label: string; email: string | null },
) =>
  here.find(
    (option) =>
      accountKindOf(option.key) === account.kind &&
      (account.email ? option.email?.toLowerCase() === account.email.toLowerCase() : option.label === account.label),
  )

/** Copy settings and Import settings: one review, then one batch. Credentials and paths never travel. */
export const registerSettingsTransferHandlers: RegisterHandlers = (ctx) => ({
  'settingsTransfer.export': {
    args: z.tuple([groups]),
    run: (chosen: TransferGroup[]) => exportSettings(ctx, chosen),
  },
  'settingsTransfer.preview': {
    args: z.tuple([settingsExportSchema, groups]),
    run: (file: SettingsExport, chosen: TransferGroup[]) =>
      preview(
        ctx,
        file,
        chosen.filter((group) => file.groups.includes(group)),
      ),
  },
  'settingsTransfer.apply': {
    args: z.tuple([settingsExportSchema, groups, z.number().int().nonnegative()]),
    run: async (file: SettingsExport, requested: TransferGroup[], expected: number) => {
      const chosen = requested.filter((group) => file.groups.includes(group))
      const { changes, connectHere } = await preview(ctx, file, chosen)
      // A setting changed elsewhere since the review stops the copy, as a batched settings edit does.
      if (changes.length !== expected) throw new Error('Setting changed elsewhere. Review the changes again.')
      const current = ctx.loadPreferences()
      const portable = Object.fromEntries(
        Object.entries(portablePreferences({ ...current, ...file.preferences } as typeof current, chosen)),
      )
      if (Object.keys(portable).length || (chosen.includes('models') && file.models))
        ctx.savePreferences(
          { ...current, ...portable },
          chosen.includes('models') && file.models ? (file.models as ModelPreferences) : undefined,
        )
      if (chosen.includes('identities') && file.identities && ctx.identities) {
        const settings = ctx.identities.settings()
        const here = await identityAccounts(ctx)
        const merged: IdentitySettings = {
          ...settings,
          identities: [
            ...settings.identities.map(
              (identity) => file.identities!.identities.find((entry) => entry.id === identity.id) ?? identity,
            ),
            ...file.identities.identities.filter(
              (entry) => !settings.identities.some((identity) => identity.id === entry.id),
            ),
          ],
          accounts: { ...settings.accounts },
        }
        for (const account of file.identities.accounts) {
          const match = matchAccount(here, account)
          if (match) merged.accounts[match.key] = account.identities
        }
        ctx.identities.replace(normalizeIdentities(merged))
      }
      if (chosen.includes('rules') && ctx.rules)
        for (const entry of file.rules ?? []) {
          if (ctx.rules.list().some((rule) => rule.name === entry.name && rule.body === entry.body)) continue
          ctx.rules.save({
            name: entry.name,
            body: entry.body,
            activation: entry.activation,
            paths: entry.paths,
            providers: entry.providers as AgentProvider[],
            enabled: entry.enabled,
            projectId: entry.identityId ? `identity:${entry.identityId}` : null,
          })
        }
      if (chosen.includes('rules')) {
        ctx.ruleFiles?.sync()
        ctx.host.send('rules:changed', {})
      }
      if (chosen.includes('memories') && ctx.memory)
        for (const entry of file.memories ?? []) ctx.memory.save({ projectId: null, ...entry }, { actor: 'user' })
      // Plugins, skills and servers are not installed here: each waits in Customize for its own review on this host.
      const tools = (file.tools ?? []).filter((tool) => chosen.includes(TOOL_GROUP[tool.kind]))
      if (tools.length && receiveTools(ctx, tools, file.host)) ctx.host.send('toolSync:changed', null)
      // Restoring is how setup's "Restore your settings?" ends; until something is applied, setup comes back.
      ctx.workspace.setAppState('onboarding-completed', true)
      return { changed: changes.length, connectHere }
    },
  },
})
