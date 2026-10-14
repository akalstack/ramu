import { expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { ToolRegistry } from '../src/toolRegistry'

it('defers optional schemas, discovers newly registered tools and validates invocation through real MCP', async () => {
  const server = new McpServer({ name: 'ramu', version: 'test' })
  const registry = new ToolRegistry(server, true)
  const called: number[] = []
  registry.server.registerTool('schedule_pause', { description: 'Pause an existing schedule', inputSchema: { id: z.number().int().positive() } }, ({ id }) => { called.push(id); return { content: [{ type: 'text', text: 'paused' }] } })
  registry.server.registerTool('memory_read', { description: 'Read a shared memory', inputSchema: {} }, () => ({ content: [] }))
  registry.expose()
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['tool_search', 'tool_invoke'])
    const found = await client.callTool({ name: 'tool_search', arguments: { query: 'pause schedule' } })
    expect(found.content).toEqual([expect.objectContaining({ text: expect.stringContaining('schedule_pause') })])
    const invalid = await client.callTool({ name: 'tool_invoke', arguments: { name: 'schedule_pause', arguments: { id: -1 } } })
    expect(invalid.isError).toBe(true); expect(called).toEqual([])
    const valid = await client.callTool({ name: 'tool_invoke', arguments: { name: 'schedule_pause', arguments: { id: 2 } } })
    expect(valid.isError).not.toBe(true); expect(called).toEqual([2])
    expect((await registry.invoke('provider_shell', {}, {})).isError).toBe(true)
  } finally { await client.close(); await server.close() }
})

it('catalogs only registered capabilities and preserves handler scope errors', async () => {
  const registry = new ToolRegistry(new McpServer({ name: 'ramu', version: 'test' }), true)
  registry.server.registerTool('memory_read', { description: 'Read memory', inputSchema: { id: z.string() } }, () => { throw new Error('Another project') })
  expect(registry.search('shell')).toEqual([])
  expect((await registry.invoke('memory_read', { id: 'foreign' }, {})).isError).toBe(true)
})
