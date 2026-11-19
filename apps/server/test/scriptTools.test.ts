import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../src/agent/toolRegistry'
import {
  registerScriptTools,
  runScript,
  SCRIPT_LIMITS,
  scriptValue,
  sharedToolName,
  type ScriptCall,
} from '../src/agent/scriptTools'

const signal = () => new AbortController().signal
const extra = { signal: signal() } as Parameters<ToolRegistry['invoke']>[2]
const issues = Array.from({ length: 45 }, (_, i) => ({ id: `ISS-${i + 1}`, open: i % 3 === 0 }))
const tracker: ScriptCall = async (name, args) => {
  if (name === 'list_issues') {
    const page = Number(args.page ?? 1)
    return { issues: issues.slice((page - 1) * 20, page * 20), next: page * 20 < issues.length ? page + 1 : null }
  }
  if (name === 'get_issue') return issues.find((issue) => issue.id === args.id)
  throw new Error(`unknown tool ${name}`)
}

describe('runScript', () => {
  it('pages, fans out and returns only the result with a count of every call', async () => {
    const report = await runScript(
      `let page = 1, ids = []
       while (page) { const r = await call('list_issues', { page }); ids.push(...r.issues.map((i) => i.id)); page = r.next }
       const full = await Promise.all(ids.map((id) => call('get_issue', { id })))
       log('checked', full.length)
       return full.filter((i) => i.open).length`,
      tracker,
      signal(),
    )
    expect(report).toEqual({ result: 15, calls: { list_issues: 3, get_issue: 45 }, log: ['checked 45'] })
  })

  it('never runs more calls at once than the limit', async () => {
    let active = 0
    let most = 0
    const slow: ScriptCall = async () => {
      most = Math.max(most, ++active)
      await new Promise((done) => setTimeout(done, 5))
      active--
      return 1
    }
    const report = await runScript(
      'return (await Promise.all(Array.from({ length: 20 }, () => call("x")))).length',
      slow,
      signal(),
      { ...SCRIPT_LIMITS, parallel: 3 },
    )
    expect(report.result).toBe(20)
    expect(most).toBe(3)
  })

  it('reports the calls and logs made before a failure, and lets a script catch a failed call', async () => {
    const report = await runScript(
      `await call('list_issues', {})
       try { await call('delete_everything', {}) } catch (e) { log('declined:', e.message) }
       throw new Error('gave up')`,
      tracker,
      signal(),
    )
    expect(report).toEqual({
      error: 'gave up',
      calls: { list_issues: 1, delete_everything: 1 },
      log: ['declined: unknown tool delete_everything'],
    })
  })

  it('has no way to reach the host', async () => {
    const report = await runScript(
      `return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof globalThis.__call]`,
      tracker,
      signal(),
    )
    expect(report.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'function'])
  })

  it('stops a runaway loop at the time limit', async () => {
    const report = await runScript('while (true) {}', tracker, signal(), { ...SCRIPT_LIMITS, timeoutMs: 200 })
    expect(report.error).toBe('The script stopped after 0 seconds')
  })

  it('refuses calls beyond the limit', async () => {
    const report = await runScript(
      'for (let i = 0; i < 5; i++) await call("get_issue", { id: "ISS-1" })',
      tracker,
      signal(),
      { ...SCRIPT_LIMITS, maxCalls: 3 },
    )
    expect(report.error).toBe('A script can make at most 3 calls')
    expect(report.calls).toEqual({ get_issue: 3 })
  })

  it('stops waiting when the turn is stopped', async () => {
    const stop = new AbortController()
    const never: ScriptCall = () => new Promise(() => {})
    const running = runScript('await call("hang")', never, stop.signal)
    stop.abort()
    expect((await running).error).toBe('The script was stopped')
  })
})

describe('run_script tool', () => {
  const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

  it('calls Shared MCP tools by the name the provider shows and marks a failed script as an error', async () => {
    const seen: string[] = []
    const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), false)
    registerScriptTools(registry.server, async (name, args) => {
      seen.push(name)
      return text({ echo: args })
    })
    const ok = await registry.invoke(
      'run_script',
      { code: 'return [await call("mcp__shared_mcp__linear-1a2b3c__get", { a: 1 }), await call("shared_mcp.b", {})]' },
      extra,
    )
    expect(ok.isError).not.toBe(true)
    expect(JSON.parse((ok.content[0] as { text: string }).text).result).toEqual([{ echo: { a: 1 } }, { echo: {} }])
    expect(seen).toEqual(['linear-1a2b3c__get', 'b'])
    const failed = await registry.invoke('run_script', { code: 'throw new Error("nope")' }, extra)
    expect(failed.isError).toBe(true)
  })

  it('cuts a result that is too long and says how to fix it', async () => {
    const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), false)
    registerScriptTools(registry.server, async () => text(null), { ...SCRIPT_LIMITS, outputChars: 100 })
    const result = await registry.invoke('run_script', { code: 'return "x".repeat(500)' }, extra)
    expect((result.content[0] as { text: string }).text).toMatch(/more characters cut\. Return less/)
  })
})

describe('scriptValue and sharedToolName', () => {
  it('parses JSON, keeps plain text and throws a tool error', () => {
    expect(scriptValue({ content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ a: 1 })
    expect(scriptValue({ content: [{ type: 'text', text: 'plain' }] })).toBe('plain')
    expect(() => scriptValue({ isError: true, content: [{ type: 'text', text: 'declined' }] })).toThrow('declined')
  })

  it('drops each provider prefix', () => {
    expect(sharedToolName('mcp__shared_mcp__x__y')).toBe('x__y')
    expect(sharedToolName('shared_mcp_x__y')).toBe('x__y')
    expect(sharedToolName('x__y')).toBe('x__y')
  })
})
