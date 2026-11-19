import { expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SharedMcpStorage } from '../src/mcp/storage'
import { SharedMcpService } from '../src/mcp/service'

// Public, unauthenticated, read-only acceptance. Never launches a paid provider or modifies a service account.
it.skipIf(process.env.RAMU_TEST_PUBLIC_MCP !== '1')(
  'reads a public repository through the production HTTP gateway for two provider principals',
  async () => {
    const db = openDb(':memory:')
    const manager = new SharedMcpService(new SharedMcpStorage(new Workspace(db, '/unused')))
    const connection = manager.save({
      name: 'DeepWiki acceptance',
      serviceAccountId: 'public',
      enabled: true,
      providers: ['claude-code', 'codex'],
      scope: { projectIds: ['acceptance'], hostWide: false },
      transport: { type: 'http', url: 'https://mcp.deepwiki.com/mcp', headerSecretRefs: {} },
    })
    try {
      for (const provider of ['claude-code', 'codex'] as const) {
        manager.saveAccount({ provider, accountId: 'test', shareApprovals: false })
        const selection = { provider, accountId: 'test', projectId: 'acceptance' }
        const inspection = await manager.check(connection.id, selection)
        expect(inspection.tools.some((tool) => tool.name === 'read_wiki_structure')).toBe(true)
        manager.approve({
          connectionId: connection.id,
          revision: inspection.revision,
          catalogRevision: inspection.catalogRevision,
          provider,
          accountId: 'test',
          scope: connection.scope,
          tools: [{ name: 'read_wiki_structure', action: 'read', approval: 'connection' }],
        })
        const gateway = manager.gateway(
          `acceptance:${provider}`,
          {
            ...selection,
            hostId: manager.storage.hostId,
            role: 'interactive',
            externalToolsAllowed: true,
          },
          async () => false,
        )
        try {
          const result = await gateway.invoke(connection.id, inspection.catalogRevision, 'read_wiki_structure', {
            repoName: 'modelcontextprotocol/typescript-sdk',
          })
          expect(result.isError).not.toBe(true)
          expect(result.content.length).toBeGreaterThan(0)
        } finally {
          await gateway.close()
        }
      }
      expect(manager.storage.outcomes().filter((call) => call.outcome === 'completed')).toHaveLength(2)
    } finally {
      await manager.close()
      db.close()
    }
  },
  60_000,
)
