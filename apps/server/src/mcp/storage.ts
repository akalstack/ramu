import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SharedMcpPolicyState } from '@ramu/shared/mcp'
import type { ExternalMcpCall } from './gateway'
import type { SharedMcpPolicyStorage } from './policy'

interface AppState {
  getAppState<T>(key: string, fallback: T): T
  setAppState(key: string, value: unknown): void
}
const callSchema = z.strictObject({
  id: z.string().uuid(),
  sessionId: z.string().min(1).max(200),
  hostId: z.string().uuid(),
  connectionId: z.string().min(1).max(200),
  serviceAccountId: z.string().min(1).max(200),
  provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']),
  accountId: z.string().min(1).max(200),
  projectId: z.string().max(200).nullable(),
  revision: z.string().min(1).max(200),
  catalogRevision: z.string().min(1).max(200),
  toolName: z.string().min(1).max(200),
  action: z.enum(['read', 'write']),
  outcome: z.enum(['pending', 'completed', 'tool-error', 'unknown']),
  updatedAt: z.number().int().nonnegative(),
})
const documentSchema = z.strictObject({
  version: z.literal(1),
  hostId: z.string().uuid(),
  policy: z.unknown(),
  calls: z.array(callSchema).max(1000),
})
type Document = z.infer<typeof documentSchema>
const key = 'shared-mcp:v1'

/** One SQLite app_state row is replaced atomically by Workspace.setAppState.
 * Definitions, opaque references and outcome metadata only; no arguments, output or credential values. */
export class SharedMcpStorage implements SharedMcpPolicyStorage {
  private document: Document
  readonly hostId: string

  constructor(private readonly state: AppState) {
    const saved = state.getAppState<unknown>(key, null)
    this.document = documentSchema.parse(
      saved ?? {
        version: 1,
        hostId: randomUUID(),
        policy: { connections: [], accounts: [], grants: [] },
        calls: [],
      },
    )
    this.hostId = this.document.hostId
    if (this.document.calls.some((call) => call.hostId !== this.hostId))
      throw new Error('Shared MCP outcomes belong to another host')
    // A process restart cannot establish whether an interrupted upstream operation completed.
    const calls = this.document.calls.map((call) =>
      call.outcome === 'pending' ? { ...call, outcome: 'unknown' as const } : call,
    )
    if (saved === null || calls.some((call, index) => call !== this.document.calls[index]))
      this.commit({ ...this.document, calls })
  }

  private commit(document: Document) {
    const parsed = documentSchema.parse(document)
    this.state.setAppState(key, structuredClone(parsed))
    this.document = parsed
  }

  load() {
    return structuredClone(this.document.policy)
  }

  save(policy: SharedMcpPolicyState) {
    this.commit({ ...this.document, policy: structuredClone(policy) })
  }

  record(call: ExternalMcpCall) {
    if (call.hostId !== this.hostId) throw new Error('Shared MCP outcome belongs to another host')
    const previous = this.document.calls.find((entry) => entry.id === call.id)
    if (previous) {
      const { outcome: _outcome, updatedAt: _time, ...identity } = previous
      if (Object.entries(identity).some(([name, value]) => call[name as keyof ExternalMcpCall] !== value))
        throw new Error('Shared MCP call identity changed')
      if (previous.outcome !== 'pending' && previous.outcome !== call.outcome)
        throw new Error('Shared MCP outcome is already recorded')
    }
    let calls = [...this.document.calls.filter((entry) => entry.id !== call.id), { ...call, updatedAt: Date.now() }]
    while (calls.length > 1000) {
      const discard = calls.findIndex((entry) => entry.outcome === 'completed' || entry.outcome === 'tool-error')
      if (discard === -1) throw new Error('Inspect uncertain Shared MCP calls before starting more operations')
      calls = calls.filter((_entry, index) => index !== discard)
    }
    this.commit({ ...this.document, calls })
  }

  outcomes() {
    return structuredClone(this.document.calls)
  }
}
