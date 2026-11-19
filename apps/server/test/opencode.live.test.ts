// Opt-in: RAMU_REAL_OPENCODE=1 pnpm vitest run test/opencode.live.test.ts
// Runs one chat on the installed OpenCode 2 with a stand-in for Ramu's tool server.
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'
import { createOpenCodeRunner } from '../src/providers/opencode'

describe.runIf(process.env.RAMU_REAL_OPENCODE === '1')('OpenCode 2 runner with the real CLI', () => {
  it('runs a turn with a shell tool and a Ramu tool', { timeout: 120_000 }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ramu-opencode-'))
    writeFileSync(join(cwd, 'a.txt'), 'hello\n')
    const token = randomUUID()
    let pinged = false
    const http = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end()
      const server = new McpServer({ name: 'ramu', version: '0.1.0' })
      server.registerTool('ramu_ping', { description: 'Tells Ramu the agent is alive. Returns pong.' }, () => {
        pinged = true
        return { content: [{ type: 'text', text: 'pong' }] }
      })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => void transport.close())
      let body = ''
      for await (const chunk of req) body += chunk
      await server.connect(transport)
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as { port: number }).port
    const events: AgentEvent[] = []
    const runner = createOpenCodeRunner(
      { cwd, additionalDirs: [], covers: [cwd] } as never,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', model: '', access: 'full' },
      (event) => {
        events.push(event)
        if (process.env.RAMU_OPENCODE_REPORT) console.error(JSON.stringify(event).slice(0, 300))
      },
    )
    runner.setTools!({ url: `http://127.0.0.1:${port}/mcp`, token })
    try {
      await runner.start(
        'Run `ls` with your shell tool, then call the ramu_ping tool, then reply with just: done',
        null,
      )
      while (!events.some((e) => e.kind === 'result')) await new Promise((r) => setTimeout(r, 200))
      const result = events.find((e) => e.kind === 'result')
      expect(result).toMatchObject({ isError: false })
      expect(events.some((e) => e.kind === 'init')).toBe(true)
      expect(events.some((e) => e.kind === 'tool-result' && e.summary.includes('a.txt'))).toBe(true)
      expect(events.some((e) => e.kind === 'text')).toBe(true)
      expect(pinged).toBe(true)
    } finally {
      await runner.stop()
      http.close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
