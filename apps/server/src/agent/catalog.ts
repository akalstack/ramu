import { modelContextWindow } from '../providers/modelContext'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, ProviderCatalog } from '@ramu/shared/types'
import { acpModels } from '../providers/acp'
import { cursorModels } from '../providers/cursor'
import { codexModels } from '../providers/codex'
import { InputQueue } from './inputQueue'
import { claudeDefaultEffort } from './settings'
import type { QueryFn } from './types'
import { errorMessage, timeout } from './util'

/** What catalog discovery needs from the service. */
export interface CatalogSource {
  providerOff(provider: AgentProvider): boolean
  providerQuery: QueryFn
}

/** Fixed catalogs for the fake-agent test mode. */
export function fakeCatalogs(): ProviderCatalog[] {
  return [
    {
      provider: 'claude-code',
      models: [
        {
          provider: 'claude-code',
          id: 'fake-claude',
          name: 'Claude (test)',
          efforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium',
          isDefault: true,
        },
      ],
    },
    ...(['opencode', 'cursor', 'antigravity'] as const).map((provider): ProviderCatalog => ({
      provider,
      models: [
        {
          provider,
          id: `fake-${provider}`,
          name: `${providerName(provider)} (test)`,
          efforts: [],
          defaultEffort: null,
          isDefault: true,
        },
      ],
    })),
    {
      provider: 'codex',
      models: [
        {
          provider: 'codex',
          id: 'fake-codex',
          name: 'Codex (test)',
          efforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium',
          isDefault: true,
        },
      ],
    },
  ]
}

/** Asks every enabled provider for its models; a provider that fails is listed with its error. */
export function discoverCatalogs({ providerOff, providerQuery }: CatalogSource): Promise<ProviderCatalog[]> {
  return Promise.all([
    (async (): Promise<ProviderCatalog> => {
      if (providerOff('claude-code')) return { provider: 'claude-code', models: [] }
      const input = new InputQueue()
      let query: Query | undefined
      try {
        query = providerQuery({ prompt: input, options: { permissionMode: 'default' } })
        const models = await timeout(
          query.supportedModels(),
          20_000,
          'Claude model discovery timed out. Check the Claude Code installation and login.',
        )
        const concreteModels = models.filter(
          (m) => m.value.toLowerCase() !== 'default' && !/^default\b/i.test(m.displayName),
        )
        return {
          provider: 'claude-code',
          models: concreteModels.map((m, i) => ({
            provider: 'claude-code',
            id: m.value,
            name: m.displayName,
            ...(modelContextWindow(m) ? { contextWindow: modelContextWindow(m) } : {}),
            efforts: m.supportedEffortLevels ?? [],
            defaultEffort: claudeDefaultEffort(m.supportedEffortLevels ?? []),
            isDefault: i === 0,
          })),
        }
      } catch (e) {
        return { provider: 'claude-code', models: [], error: errorMessage(e) }
      } finally {
        input.close()
        query?.close()
      }
    })(),
    // Cursor chats run on the SDK, so its catalog is the SDK's; before an SDK sign-in, the CLI's list stands in.
    (providerOff('cursor') ? Promise.resolve([]) : cursorModels().catch(() => acpModels('cursor'))).then(
      (models): ProviderCatalog => ({ provider: 'cursor', models }),
      (e): ProviderCatalog => ({ provider: 'cursor', models: [], error: errorMessage(e) }),
    ),
    ...(['antigravity'] as const).map((provider) =>
      (providerOff(provider) ? Promise.resolve([]) : acpModels(provider)).then(
        (models): ProviderCatalog => ({ provider, models }),
        (e): ProviderCatalog => ({ provider, models: [], error: errorMessage(e) }),
      ),
    ),
    (providerOff('opencode') ? Promise.resolve([]) : acpModels('opencode')).then(
      (models): ProviderCatalog => ({ provider: 'opencode', models }),
      (e): ProviderCatalog => ({ provider: 'opencode', models: [], error: errorMessage(e) }),
    ),
    (providerOff('codex') ? Promise.resolve([]) : codexModels()).then(
      (models): ProviderCatalog => ({ provider: 'codex', models }),
      (e): ProviderCatalog => ({ provider: 'codex', models: [], error: errorMessage(e) }),
    ),
  ])
}
