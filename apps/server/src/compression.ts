import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Db } from './db'
import type { IntelligencePreferences } from '@ramu/shared/types'

/** Runs before an MCP result reaches the provider. Raw data remains scoped and retrievable. */
export class CompressionService {
  constructor(private readonly db: Db) {}
  compact(sessionId: string, mode: IntelligencePreferences['compression'], result: CallToolResult): CallToolResult {
    if (mode === 'off' || result.isError || result.structuredContent) return result
    const budget = mode === 'balanced' ? 12000 : 5000
    return {
      ...result,
      content: result.content.map((block) => {
        if (block.type !== 'text' || block.text.length <= budget) return block
        const id = randomUUID(),
          text = block.text
        const preview = `${text.slice(0, Math.floor(budget * 0.65))}\n[Middle omitted; retrieve full output with tool_result_read]\n${text.slice(-Math.floor(budget * 0.35))}`
        const compact = JSON.stringify({
          truncated: true,
          originalCharacters: text.length,
          resultId: id,
          preview,
          read: 'tool_result_read with resultId, offset and limit. Read omitted sections before relying on absent details.',
        })
        this.db
          .prepare('INSERT INTO tool_payloads VALUES (?, ?, ?, ?, ?)')
          .run(id, sessionId, text, compact.length, Date.now())
        return { ...block, text: compact }
      }),
    }
  }
  read(sessionId: string, id: string, offset: number, limit: number) {
    const row = this.db
      .prepare('SELECT content FROM tool_payloads WHERE id = ? AND session_id = ?')
      .get(id, sessionId) as { content: string } | undefined
    if (!row) throw new Error('Unknown tool output for this chat')
    return {
      content: row.content.slice(offset, offset + limit),
      offset,
      totalCharacters: row.content.length,
      nextOffset: offset + limit < row.content.length ? offset + limit : null,
    }
  }
  stats(sessionId: string) {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS outputs, COALESCE(SUM(length(content)), 0) AS originalCharacters, COALESCE(SUM(compact_chars), 0) AS compactCharacters FROM tool_payloads WHERE session_id = ?',
      )
      .get(sessionId) as { outputs: number; originalCharacters: number; compactCharacters: number }
    return {
      ...row,
      estimatedTokensAvoided: Math.max(0, Math.floor((row.originalCharacters - row.compactCharacters) / 4)),
      note: 'Character-based estimate for compressed Ramu tool outputs only, before detail rereads. Not provider billing or total conversation savings.',
    }
  }
  register(server: McpServer, sessionId: string) {
    server.registerTool(
      'tool_result_read',
      {
        description:
          'Read an exact slice of a previously compacted Ramu tool result in this chat. Offsets and limits are characters.',
        inputSchema: {
          resultId: z.string().max(100),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(12000).default(4000),
        },
      },
      ({ resultId, offset, limit }) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(this.read(sessionId, resultId, offset, limit)) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: String(error) }] }
        }
      },
    )
  }
}
