// Opt-in model/tool regression: RAMU_REAL_GOALS=1 pnpm vitest run test/goals.live.test.ts
// Uses the signed-in Codex CLI, real Ramu prompts/tools, and throwaway workspaces.
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CodexRpc } from '../src/codex'
import { goalContinuation, goalInstructions, registerGoalTools } from '../src/goals'
import type { AgentService } from '../src/agent'
import type { ChatGoal, GoalPreferences } from '@ramu/shared/types'

const cases = [
  { name: 'question', prompt: 'What does the add function in math.js do?', goal: false },
  { name: 'routine fix and test', prompt: 'Fix add in math.js and verify that add(2, 3) returns 5.', goal: false },
  { name: 'multiple files', prompt: 'Rename add to sum in math.js and its two callers, then verify both callers run.', goal: false },
  { name: 'plan only', prompt: 'Inspect migration.json and propose a migration plan. Do not implement it.', goal: false },
  { name: 'explicit goal', prompt: 'Create a Ramu goal to fix add in math.js and verify add(2, 3) returns 5.', goal: true },
  { name: 'implicit continuation', prompt: 'Complete the migration described in migration.json using migrate_batch and verify every batch is done.', goal: true, migration: true },
  { name: 'explicit opt out', prompt: 'Do not create a goal or automatically continue. Inspect migration.json, run the first migration batch, and report what remains.', goal: false },
  { name: 'manual mode', prompt: 'Inspect migration.json, run the first migration batch, and report what remains.', goal: false, mode: 'manual' as const },
]

describe.runIf(process.env.RAMU_REAL_GOALS === '1')('Ramu automatic goals with real Codex Luna', () => {
  for (const scenario of cases) it(scenario.name, { timeout: 180_000 }, async () => {
    const trace = (value: unknown) => { if (process.env.RAMU_GOALS_REPORT) appendFileSync(process.env.RAMU_GOALS_REPORT, `${JSON.stringify({ scenario: scenario.name, ...value as object })}\n`) }
    const cwd = mkdtempSync(join(tmpdir(), 'ramu-goal-luna-'))
    const preferences: GoalPreferences = { mode: scenario.mode ?? 'auto', maxTurns: 3 }
    let goal: ChatGoal | null = null
    const calls: { name: string; input: unknown }[] = []
    const goalRequests: { objective: string; continuationReason: string }[] = []
    let migrationInspected = false, inspectedBeforeGoal = false
    let batches = 0, turn = 0, lastBatchTurn = -1
    writeFileSync(join(cwd, 'math.js'), 'exports.add = (a, b) => a - b\n')
    for (const name of ['one', 'two']) writeFileSync(join(cwd, `${name}.js`), "console.log(require('./math').add(2, 3))\n")
    writeFileSync(join(cwd, 'migration.json'), JSON.stringify({
      subsystem: 'remote schema migration', batches: 2,
      execution: 'Use migrate_batch. The remote service accepts one batch per agent turn. The next batch is available in the next agent turn; polling or waiting in this turn cannot unlock it.',
      verification: 'Both batches must finish. The tool returns the authoritative completed and remaining batch counts.',
    }))
    const service = {
      setGoal: (_id: string, objective: string) => {
        calls.push({ name: 'set_goal', input: objective })
        if (preferences.mode === 'manual') throw new Error('Manual mode requires /goal from the user')
        inspectedBeforeGoal = migrationInspected
        goal = { objective, status: 'active', reason: '', turns: 0 } as ChatGoal
        return goal
      },
      getGoal: () => goal,
      updateGoal: (_id: string, status: ChatGoal['status'], reason: string) => {
        calls.push({ name: 'update_goal', input: { status, reason } })
        if (!goal) throw new Error('No active goal')
        goal = { ...goal, status, reason }; return goal
      },
    } as unknown as AgentService
    const token = randomUUID()
    const http = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
      const server = new McpServer({ name: 'ramu', version: '0.1.0' })
      registerGoalTools(server, service, 'live-test')
      server.registerTool('migrate_batch', {
        description: 'Execute the next remote schema migration batch. One batch is available per agent turn. Read migration.json before using it.', inputSchema: { verify: z.boolean().optional() },
      }, () => {
        if (lastBatchTurn !== turn && batches < 2) { batches++; lastBatchTurn = turn }
        calls.push({ name: 'migrate_batch', input: { turn, batches } })
        return { content: [{ type: 'text', text: JSON.stringify({ completed: batches, remaining: 2 - batches, nextBatch: batches < 2 ? 'available next agent turn; end this turn before retrying' : null }) }] }
      })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => { void transport.close(); void server.close() })
      try {
        let body = ''; for await (const chunk of req) body += chunk
        await server.connect(transport)
        const request = body ? JSON.parse(body) : undefined
        if (request?.method === 'tools/call') {
          trace({ tool: request.params })
          if (request.params.name === 'set_goal') goalRequests.push(request.params.arguments)
        }
        await transport.handleRequest(req, res, request)
      } catch { if (!res.headersSent) res.writeHead(500).end() }
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as import('node:net').AddressInfo).port
    const rpc = new CodexRpc({ url: `http://127.0.0.1:${port}/mcp`, token, nativeSubagents: false })
    const messages: string[] = []
    let finish: (() => void) | undefined, fail: ((error: Error) => void) | undefined
    rpc.onMessage = (message) => {
      if (['error', 'turn/completed', 'mcpServer/startupStatus/updated', 'item/started'].includes(message.method)) trace({ event: message.method, params: message.params })
      if (message.method === 'item/agentMessage/delta') messages.push(message.params.delta)
      if (message.method === 'item/completed' && message.params.item.type === 'commandExecution') {
        const item = message.params.item
        if (item.command.includes('migration.json') && item.aggregatedOutput?.includes('remote schema migration')) migrationInspected = true
      }
      if (message.method === 'turn/completed') {
        if (message.params.turn.status === 'failed') fail?.(new Error(JSON.stringify(message.params.turn.error)))
        else finish?.()
      }
    }
    rpc.onExit = (error) => fail?.(error)
    try {
      await rpc.initialize()
      trace({ stage: 'initialized' })
      const { thread } = await rpc.request('thread/start', {
        cwd, model: 'gpt-6-luna', ephemeral: true, approvalPolicy: 'never', sandbox: 'danger-full-access',
        developerInstructions: goalInstructions(preferences, null),
      })
      trace({ stage: 'thread started' })
      // Establish actual tool availability before scoring model behavior.
      const inventory = await rpc.request('mcpServerStatus/list', { threadId: thread.id, serverName: 'ramu' })
      const ramu = inventory.data.find((server: { name: string }) => server.name === 'ramu')
      expect(ramu?.toolsError).toBeNull()
      const names = Object.values(ramu?.tools ?? {}).map((tool: any) => tool.name)
      trace({ availableTools: names })
      expect(names).toEqual(expect.arrayContaining(['set_goal', 'get_goal', 'update_goal', 'migrate_batch']))
      const run = async (text: string) => {
        const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
        const timer = setTimeout(() => fail?.(new Error('Luna turn exceeded 90 seconds')), 90_000)
        try {
          await rpc.request('turn/start', { threadId: thread.id, model: 'gpt-6-luna', effort: 'high',
            input: [{ type: 'text', text }], approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' },
          })
          trace({ stage: 'turn started' })
          await done
        } finally { clearTimeout(timer) }
      }
      await run(scenario.prompt)
      const created = calls.some((call) => call.name === 'set_goal')
      console.log(JSON.stringify({ scenario: scenario.name, model: 'gpt-6-luna', expected: scenario.goal, created, calls, response: messages.join('') }))
      trace({ expected: scenario.goal, created, calls, response: messages.join('') })
      expect(created).toBe(scenario.goal)
      expect(goalRequests.length > 0).toBe(scenario.goal)
      for (const request of goalRequests) expect(request.continuationReason.trim().length).toBeGreaterThan(0)
      if (scenario.name === 'routine fix and test' || scenario.name === 'explicit goal') {
        expect(execFileSync(process.execPath, ['-e', "console.log(require('./math').add(2, 3))"], { cwd, encoding: 'utf8' }).trim()).toBe('5')
      }
      if (scenario.name === 'explicit goal') expect(service.getGoal('live-test')?.status).toBe('completed')
      if (scenario.name === 'multiple files') for (const file of ['one', 'two']) {
        expect(readFileSync(join(cwd, `${file}.js`), 'utf8')).toContain('.sum(')
        expect(execFileSync(process.execPath, [`${file}.js`], { cwd, encoding: 'utf8' }).trim()).toBe('-1')
      }
      if (scenario.name === 'plan only') expect(batches).toBe(0)
      if (scenario.name === 'explicit opt out' || scenario.mode === 'manual') expect(batches).toBe(1)
      if (scenario.migration) {
        expect(inspectedBeforeGoal).toBe(true)
        expect(batches).toBe(1)
        expect(service.getGoal('live-test')?.status).toBe('active')
        turn++
        await run(goalContinuation(goal!))
        expect(batches).toBe(2)
        expect(service.getGoal('live-test')?.status).toBe('completed')
        trace({ continuationVerified: true, completed: batches, goal: service.getGoal('live-test') })
      }
    } finally {
      await rpc.close()
      http.closeAllConnections()
      await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()))
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
