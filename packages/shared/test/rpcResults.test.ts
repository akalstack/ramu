import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RESULTS_FILE, rpcResultsSource } from '../scripts/rpcResults'
import { checkRpcResult, RpcResultError, type RpcResultShapes } from '../src/rpcResults'
import { RPC_RESULTS } from '../src/rpcResults.generated'

describe('RPC result shapes', () => {
  it('is generated from the current RamuMethods', () => {
    // Run `pnpm --filter @ramu/shared rpc-results` after changing a method's result type.
    expect(readFileSync(RESULTS_FILE, 'utf8')).toBe(rpcResultsSource())
  }, 60_000)

  it('lists every method with its declared result', () => {
    expect(Object.keys(RPC_RESULTS.methods).length).toBeGreaterThan(700)
    expect(() => checkRpcResult(RPC_RESULTS, 'tasks.list', [{ id: 'only an id' }])).toThrow(RpcResultError)
    expect(() => checkRpcResult(RPC_RESULTS, 'tasks.list', [])).not.toThrow()
  })

  it('names the field an optional object got wrong, not that it expected nothing', () => {
    const table: RpcResultShapes = {
      methods: { 'demo.get': 4 },
      shapes: [
        { k: 'string' },
        { k: 'undefined' },
        { k: 'object', p: { mode: [0, 0], subagents: [0, 0] } },
        { k: 'union', of: [1, 2] },
        { k: 'object', p: { preferences: [3, 1] } },
      ],
    }
    expect(() => checkRpcResult(table, 'demo.get', { preferences: { mode: 'a' } })).toThrow(
      'result.preferences.subagents: missing',
    )
  })

  it('accepts a kind of event a newer host added, and still refuses a known kind sent wrong', () => {
    const table: RpcResultShapes = {
      methods: { 'demo.events': 6 },
      shapes: [
        { k: 'string' },
        { k: 'literal', v: 'text' },
        { k: 'literal', v: 'stop' },
        { k: 'object', p: { kind: [1, 0], text: [0, 0] } },
        { k: 'object', p: { kind: [2, 0] } },
        { k: 'union', of: [3, 4] },
        { k: 'array', of: 5 },
      ],
    }
    expect(() =>
      checkRpcResult(table, 'demo.events', [
        { kind: 'text', text: 'hi' },
        { kind: 'settings-changed', by: 'x' },
      ]),
    ).not.toThrow()
    expect(() => checkRpcResult(table, 'demo.events', [{ kind: 'text' }])).toThrow('result[0].text: missing')
    expect(() => checkRpcResult(table, 'demo.events', ['not an event'])).toThrow(RpcResultError)
    // The real transcript read: an event this app has never heard of does not fail the whole answer.
    expect(() =>
      checkRpcResult(RPC_RESULTS, 'agent.changes', {
        reset: false,
        cursor: 2,
        lastSeq: 2,
        revision: 2,
        events: [{ seq: 2, event: { kind: 'a-kind-from-the-future', anything: true } }],
      }),
    ).not.toThrow()
  })

  it('leaves preferences, which hosts and apps of other versions read with defaults, unchecked', () => {
    const method = RPC_RESULTS.methods['settings.app.snapshot']!
    const shape = RPC_RESULTS.shapes[method]
    expect(shape?.k).toBe('object')
    const preferences = shape?.k === 'object' ? shape.p.preferences : undefined
    expect(preferences && RPC_RESULTS.shapes[preferences[0]]?.k).toBe('any')
  })

  it('accepts what JSON makes of a value and extra fields a newer host adds, and names the first wrong field', () => {
    const table: RpcResultShapes = {
      methods: { 'demo.get': 6 },
      shapes: [
        { k: 'string' },
        { k: 'number' },
        { k: 'undefined' },
        { k: 'union', of: [0, 2] },
        { k: 'literal', v: 'ready' },
        { k: 'array', of: 1 },
        { k: 'object', p: { name: [0, 0], note: [3, 1], state: [4, 0], counts: [5, 0], child: [6, 1] } },
      ],
    }
    const ok = {
      name: 'a',
      state: 'ready',
      counts: [1, 2],
      extra: true,
      child: { name: 'b', state: 'ready', counts: [] },
    }
    expect(() => checkRpcResult(table, 'demo.get', ok)).not.toThrow()
    expect(() => checkRpcResult(table, 'demo.get', { ...ok, note: null })).not.toThrow()
    expect(() => checkRpcResult(table, 'demo.get', { ...ok, counts: [1, 'x'] })).toThrow(
      'result.counts[1]: expected a number, got string',
    )
    expect(() => checkRpcResult(table, 'demo.get', { state: 'ready', counts: [] })).toThrow('result.name: missing')
    expect(() => checkRpcResult(table, 'demo.get', { ...ok, child: { ...ok, state: 'gone' } })).toThrow(
      'result.child.state: expected "ready", got "gone"',
    )
    // A method this table does not know (a newer host's) is not checked.
    expect(() => checkRpcResult(table, 'demo.other', 42)).not.toThrow()
  })
})
