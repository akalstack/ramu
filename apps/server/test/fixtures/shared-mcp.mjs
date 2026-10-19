import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'shared-mcp-fixture', version: 'test' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [{ name: 'inspect_environment', inputSchema: { type: 'object' } }],
}))
server.setRequestHandler(CallToolRequestSchema, () => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        cwd: process.cwd(),
        argument: process.argv[2],
        providerTokenPresent: Boolean(process.env.RAMU_MCP_TOKEN),
        unrelatedSecretPresent: Boolean(process.env.SHARED_MCP_TEST_PRIVATE),
        configuredSecret: process.env.SERVICE_TEST_KEY,
      }),
    },
  ],
}))
await server.connect(new StdioServerTransport())
