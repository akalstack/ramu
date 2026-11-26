import { z } from 'zod'
import type { ProviderConfiguration, ProviderStatus } from '@ramu/shared/providers/providers'
import { codexHookTrust } from '../../providers/codex'
import { claudeAdvisorModel } from '../../agent/advisor'
import { providerBinaries } from '../preferences'
import { agentSettings, relPath } from '../schemas'
import type { RegisterHandlers } from '../types'
import { MAX_API_KEY_LENGTH } from '@ramu/shared/providers/apiKeys'
import { MEDIA_SERVICES, type MediaService } from '@ramu/shared/types/media'
import {
  ANTIGRAVITY_SIGN_IN_METHODS,
  ENVIRONMENT_SCOPES,
  antigravityKeyName,
  type AntigravitySignIn,
  type ProviderEnvironmentValues,
} from '@ramu/shared/providers/environment'

const environmentValues = z.partialRecord(
  z.enum(ENVIRONMENT_SCOPES as [string, ...string[]]),
  z.array(z.object({ key: z.string().max(128), value: z.string().max(32 * 1024) })).max(500),
)

const cloudField = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9._:-]*$/)
  .optional()
const antigravitySignIn = z.object({
  method: z.enum(ANTIGRAVITY_SIGN_IN_METHODS),
  apiKey: z.string().max(512).optional(),
  gcpProject: cloudField,
  gcpLocation: cloudField,
})

/** Provider sign-in and updates, plus usage limits and provider-specific helpers. */
export const registerProviderHandlers: RegisterHandlers = ({
  host,
  environment,
  apiKeys,
  providers,
  usage,
  agents,
  accountUsage,
  usageConfigurationChanged,
  abilities,
  activity,
  mediaAccounts,
}) => {
  if (abilities) {
    abilities.track = (label, detail, work, cancel) => activity.run(label, detail, work, cancel)
    providers.abilityChecks = (provider) => abilities.checks.list(provider)
  }
  const ability = () => {
    if (!abilities) throw new Error('Abilities are not available on this host.')
    return abilities
  }
  const media = () => {
    if (!mediaAccounts) throw new Error('Update this host for media keys.')
    return mediaAccounts
  }
  const administrator = () => host.canAdministerIntegrations?.() === true
  const administrate = () => {
    if (!administrator()) throw new Error('Save media keys on the host running Ramu.')
  }
  return {
    'abilities.checks': { args: z.tuple([]), run: () => ability().status() },
    'abilities.check': {
      args: z.tuple([agentSettings.shape.provider]),
      run: (provider: ProviderStatus['provider']) => ability().recheck(provider),
    },
    'abilities.mediaAccounts': {
      args: z.tuple([z.boolean()]),
      run: async (check: boolean) => ({ accounts: await media().list(check), canAdminister: administrator() }),
    },
    'abilities.saveMediaKey': {
      args: z.tuple([z.enum(MEDIA_SERVICES), z.string().trim().min(8).max(4000).regex(/^\S+$/, 'Paste the key alone')]),
      run: (service: MediaService, key: string) => {
        administrate()
        return media().save(service, key)
      },
    },
    'abilities.removeMediaKey': {
      args: z.tuple([z.enum(MEDIA_SERVICES)]),
      run: async (service: MediaService) => {
        administrate()
        await media().disconnect(service)
        return { accounts: await media().list(false), canAdminister: administrator() }
      },
    },
    'abilities.mentionModels': { args: z.tuple([]), run: () => ability().mentionModels() },
    'abilities.mcpTools': { args: z.tuple([]), run: () => ability().mcpTools() },
    'abilities.again': {
      args: z.tuple([z.string().min(1).max(200), z.string().uuid(), z.boolean()]),
      run: (sessionId: string, callId: string, otherProvider: boolean) =>
        ability().again(sessionId, callId, otherProvider),
    },
    'providers.status': {
      args: z.tuple([providerBinaries.optional(), z.boolean().optional(), z.boolean().optional()]),
      run: (config?: ProviderConfiguration, latest?: boolean, refresh?: boolean) =>
        providers.status(config, latest, true, refresh),
    },
    'providers.statusOf': {
      args: z.tuple([agentSettings.shape.provider, providerBinaries.optional()]),
      run: (provider: ProviderStatus['provider'], config?: ProviderConfiguration) =>
        providers.statusOf(provider, config),
    },
    'providers.accountEmails': { args: z.tuple([]), run: () => providers.accountEmails() },
    'providers.accountLogins': { args: z.tuple([]), run: () => providers.accountLogins() },
    'providers.signIn': {
      args: z.tuple([agentSettings.shape.provider, agentSettings.shape.accountId, antigravitySignIn.optional()]),
      run: async (provider: ProviderStatus['provider'], accountId?: string, method?: AntigravitySignIn) => {
        if (method && provider !== 'antigravity') throw new Error('This provider has one sign-in method')
        const typed = method?.apiKey?.trim()
        const name = method && antigravityKeyName(method.method)
        // A Gemini key already saved under Media signs Antigravity in too, so the same key is never typed twice.
        const key =
          typed ||
          (method?.method === 'gemini-api-key' &&
          !environment.status(true).values?.antigravity?.some((entry) => entry.key === name)
            ? await mediaAccounts?.savedKey('gemini').catch(() => null)
            : null)
        if (method && name && key) {
          // A key is a credential: it joins Antigravity's variables in the host credential store, like any other.
          if (host.canAdministerIntegrations?.() !== true) throw new Error('Enter API keys on the host running Ramu')
          const current = environment.status(true).values ?? {}
          await environment.save({
            ...current,
            antigravity: [
              ...(current.antigravity ?? []).filter((entry) => entry.key !== name),
              { key: name, value: key },
            ],
          })
        }
        return providers.signIn(provider, accountId, method && { ...method, apiKey: undefined })
      },
    },
    // The code a provider's sign-in page shows; null abandons the sign-in.
    'providers.completeSignIn': {
      args: z.tuple([
        agentSettings.shape.provider,
        z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
        z.string().max(16_384).nullable(),
      ]),
      run: (provider: ProviderStatus['provider'], accountId: string, code: string | null) =>
        providers.completeSignIn(provider, accountId, code),
    },
    // Keys are credentials: only the execution host enters them; other clients see that a login uses one.
    'providers.setApiKey': {
      args: z.tuple([
        agentSettings.shape.provider,
        z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
        z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
        z.string().max(MAX_API_KEY_LENGTH).nullable(),
      ]),
      run: (provider: ProviderStatus['provider'], accountId: string, variable: string, key: string | null) => {
        if (host.canAdministerIntegrations?.() !== true) throw new Error('Enter API keys on the host running Ramu')
        return providers.setApiKey(provider, accountId, variable, key, apiKeys)
      },
    },
    'providers.loginCommand': {
      args: z.tuple([agentSettings.shape.provider, providerBinaries.optional()]),
      run: (provider: ProviderStatus['provider'], config?: ProviderConfiguration) =>
        providers.loginCommand(provider, config),
    },
    'providers.update': {
      args: z.tuple([agentSettings.shape.provider, z.boolean().optional()]),
      run: (provider: ProviderStatus['provider'], now?: boolean) => providers.update(provider, now),
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
      run: async (values: ProviderEnvironmentValues) => {
        if (host.canAdministerIntegrations?.() !== true)
          throw new Error('Change environment variables on the host running Ramu')
        const saved = await environment.save(values)
        // An API key or endpoint typed here changes whose plan the gauges show.
        usageConfigurationChanged()
        return saved
      },
    },
    'providers.pickBinary': { args: z.tuple([]), run: () => host.native('pickExecutable') },
    'usage.get': { args: z.tuple([]), run: () => usage.list() },
    'usage.accounts': { args: z.tuple([]), run: () => usage.all() },
    'usage.activity': {
      args: z.tuple([z.number().int().min(1).max(31)]),
      run: (days: number) => {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - (days - 1))
        return agents.activity(start.getTime())
      },
    },
    'usage.refresh': {
      args: z.tuple([]),
      run: async () => {
        await accountUsage.refresh()
        return usage.list()
      },
    },
    'codex.hook.status': { args: z.tuple([]), run: () => codexHookTrust(false) },
    'codex.hook.trust': { args: z.tuple([]), run: () => codexHookTrust(true) },
    'advisor.claude': { args: z.tuple([]), run: () => ({ model: claudeAdvisorModel() }) },
  }
}
