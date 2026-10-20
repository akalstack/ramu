import { z } from 'zod'
import type { ProviderConfiguration, ProviderStatus } from '@ramu/shared/providers/providers'
import { codexHookTrust } from '../../providers/codex'
import { claudeAdvisorModel } from '../../agent/advisor'
import { providerBinaries } from '../preferences'
import { agentSettings, relPath } from '../schemas'
import type { RegisterHandlers } from '../types'
import { ENVIRONMENT_SCOPES, type ProviderEnvironmentValues } from '@ramu/shared/providers/environment'

const environmentValues = z.partialRecord(
  z.enum(ENVIRONMENT_SCOPES as [string, ...string[]]),
  z.array(z.object({ key: z.string().max(128), value: z.string().max(32 * 1024) })).max(500),
)

/** Provider sign-in and updates, plus usage limits and provider-specific helpers. */
export const registerProviderHandlers: RegisterHandlers = ({
  host,
  environment,
  providers,
  usage,
  agents,
  extraUsage,
  accountUsage,
}) => ({
  'providers.status': {
    args: z.tuple([providerBinaries.optional(), z.boolean().optional(), z.boolean().optional()]),
    run: (config?: ProviderConfiguration, latest?: boolean, refresh?: boolean) =>
      providers.status(config, latest, true, refresh),
  },
  'providers.accountEmails': { args: z.tuple([]), run: () => providers.accountEmails() },
  'providers.signIn': {
    args: z.tuple([agentSettings.shape.provider, agentSettings.shape.accountId]),
    run: (provider: ProviderStatus['provider'], accountId?: string) => providers.signIn(provider, accountId),
  },
  'providers.loginCommand': {
    args: z.tuple([agentSettings.shape.provider, providerBinaries.optional()]),
    run: (provider: ProviderStatus['provider'], config?: ProviderConfiguration) =>
      providers.loginCommand(provider, config),
  },
  'providers.update': {
    args: z.tuple([agentSettings.shape.provider]),
    run: (provider: ProviderStatus['provider']) => providers.update(provider),
  },
  'providers.updates': { args: z.tuple([]), run: () => providers.updates() },
  'providers.dismissUpdate': {
    args: z.tuple([agentSettings.shape.provider, relPath, z.string().max(200)]),
    run: (provider: ProviderStatus['provider'], binary: string, latestVersion: string) =>
      providers.dismiss({ provider, binary, latestVersion } as ProviderStatus),
  },
  // Values are credentials: only the execution host reads or changes them; other clients see names.
  'providers.environment': {
    args: z.tuple([z.boolean().optional()]),
    run: async (retry?: boolean) => {
      if (retry) await environment.load()
      return environment.status(host.canAdministerIntegrations?.() === true)
    },
  },
  'providers.setEnvironment': {
    args: z.tuple([environmentValues]),
    run: (values: ProviderEnvironmentValues) => {
      if (host.canAdministerIntegrations?.() !== true)
        throw new Error('Change environment variables on the host running Ramu')
      return environment.save(values)
    },
  },
  'providers.pickBinary': { args: z.tuple([]), run: () => host.native('pickExecutable') },
  'usage.get': { args: z.tuple([]), run: () => usage.list() },
  'usage.accounts': { args: z.tuple([]), run: () => usage.all() },
  'usage.refresh': {
    args: z.tuple([]),
    run: async () => {
      await Promise.all([agents.readClaudeUsage(), extraUsage.refresh(), accountUsage.refresh()])
      return usage.list()
    },
  },
  'codex.hook.status': { args: z.tuple([]), run: () => codexHookTrust(false) },
  'codex.hook.trust': { args: z.tuple([]), run: () => codexHookTrust(true) },
  'advisor.claude': { args: z.tuple([]), run: () => ({ model: claudeAdvisorModel() }) },
})
