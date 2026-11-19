// A one-tool MCP server for `ramu plugin check` tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'fixture', version: '0.1.0' })
server.registerTool('search', { description: 'Search.' }, async () => ({ content: [{ type: 'text', text: '[]' }] }))
await server.connect(new StdioServerTransport())
