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
