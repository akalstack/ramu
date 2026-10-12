// Live local HTTP MCP/elicitation audit. Only new sessions and a local test
// server are used. Tokens are synthetic and no external messages are sent.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { auditHost, textOf, reportFailure } from './acp-audit-host.mjs'
if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-mcp-audit.mjs <isolated install directory> --live')
const runtime = resolve(process.argv[2])

async function probe(provider) {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-http-mcp-'))
  const token = randomUUID()
  const serverName = `ramu_audit_${randomUUID().replaceAll('-', '')}`
  const mcp = new McpServer({ name: serverName, version: '0.0.1' })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
  const outcomes = []
  let validHeaders = 0
  let invalidHeaders = 0
  let formCount = 0
  let urlCount = 0
  let cancel = false
  let host
  const updates = []
  mcp.registerTool('audit_question', { description: 'Ask the audit host one form or URL question. Use this exact tool for the integration audit.', inputSchema: { mode: z.enum(['form', 'url']) } }, async ({ mode }) => {
    const response = await mcp.server.elicitInput(mode === 'form' ? {
      mode: 'form', message: 'Audit color?', requestedSchema: { type: 'object', properties: { color: { type: 'string', enum: ['red', 'blue'] } }, required: ['color'] },
    } : { mode: 'url', message: 'Audit URL question; do not open it.', url: 'https://example.invalid/ramu-audit', elicitationId: randomUUID() })
    outcomes.push({ mode, action: response.action, color: response.content?.color })
    return { content: [{ type: 'text', text: JSON.stringify({ action: response.action, color: response.content?.color }) }] }
  })
  await mcp.connect(transport)
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { invalidHeaders++; res.writeHead(401); res.end(); return }
    validHeaders++
    try {
      let body
      if (req.method === 'POST') {
        let source = ''
        for await (const chunk of req) source += chunk.toString()
        body = source ? JSON.parse(source) : undefined
      }
      await transport.handleRequest(req, res, body)
    } catch { if (!res.headersSent) res.writeHead(500); res.end() }
  })
  http.listen(0, '127.0.0.1'); await once(http, 'listening')
  try {
    host = await auditHost(provider, runtime, cwd, {
      options: { tools: [], env: { ...process.env, MCP_TOOL_TIMEOUT: '3600000' } },
      mcpServers: [{ name: serverName, type: 'http', url: `http://127.0.0.1:${http.address().port}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }],
      onUpdate: async (event) => updates.push(event),
      onPermission: async (request) => {
        assert.equal(request.sessionId, host.sessionId)
        const option = request.options.find((entry) => entry.kind === 'allow_once')
        return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } }
      },
      onElicitation: async (request) => {
        assert.equal(request.sessionId, host.sessionId)
        if (request.mode === 'url') { urlCount++; assert.ok(request.url.includes('example.invalid')); return { action: 'cancel' } }
        formCount++
        assert.deepEqual(request.requestedSchema.properties.color.enum, ['red', 'blue'])
        return cancel ? { action: 'cancel' } : { action: 'accept', content: { color: 'blue' } }
      },
    })
    if (provider === 'codex') await host.mode('workspace-write')
    await host.prompt(`MCP audit: call ${serverName}.audit_question exactly once with mode=form. Do not call any other tool. After the tool returns, reply only its returned color.`)
    assert.equal(formCount, 1, 'Form elicitation missing')
    assert.deepEqual(outcomes[0], { mode: 'form', action: 'accept', color: 'blue' })
    assert.ok(textOf(updates, host.sessionId).toLowerCase().includes('blue'))
    cancel = true
    await host.prompt(`MCP audit: call ${serverName}.audit_question exactly once with mode=form. The client will cancel it. Do not retry or call another tool.`)
    assert.equal(formCount, 2, 'Cancelled form missing')
    assert.equal(outcomes[1].action, 'cancel')
    await host.prompt(`MCP audit: call ${serverName}.audit_question exactly once with mode=url. The client will cancel it; do not open the URL or call another tool.`)
    assert.equal(urlCount, 1, 'URL elicitation missing')
    assert.equal(outcomes[2].action, 'cancel')
    updates.length = 0
    const result = await host.prompt('The MCP audit is done. Do not call tools. Reply exactly ACP_MCP_ALIVE.')
    assert.equal(result.stopReason, 'end_turn')
    assert.ok(textOf(updates, host.sessionId).includes('ACP_MCP_ALIVE'))
    assert.ok(validHeaders > 0)
    assert.equal(invalidHeaders, 0)
    console.log(JSON.stringify({ test: `live-${provider}-scoped-http-mcp`, passed: true, scopedAuthHeadersPreserved: true, formAcceptedWithChosenAnswer: true, formCancellationRoundTrip: true, urlCancellationRoundTrip: true, parentUsable: true, uniqueServerNameAvoidsConfigConflict: true }))
  } catch (error) { reportFailure(`live-${provider}-scoped-http-mcp`, error, { formCount, urlCount, toolCalls: outcomes.length, invalidHeaders }) }
  finally {
    if (host) await host.close()
    await transport.close(); await mcp.close()
    http.closeAllConnections(); await new Promise((resolveClosed) => http.close(resolveClosed))
    await rm(cwd, { recursive: true, force: true })
  }
}
for (const provider of ['claude', 'codex']) await probe(provider)
