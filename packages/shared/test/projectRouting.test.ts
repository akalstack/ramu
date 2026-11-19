import { describe, expect, it } from 'vitest'
import {
  interpretAiRouting,
  routeByName,
  routingCatalog,
  routingLabels,
  ROUTING_CATALOG_LIMIT,
  type RoutingCandidate,
} from '../src/workspace/projectRouting'

const ramu: RoutingCandidate = { id: 'p1', name: 'Ramu', aliases: ['agent app'] }
const mobile: RoutingCandidate = { id: 'p2', name: 'Ramu Mobile' }
const store: RoutingCandidate = { id: 'p3', name: 'Storefront', description: 'Checkout and payment web application' }
const billing: RoutingCandidate = { id: 'p4', name: 'Billing', description: 'Invoices and payment processing' }

describe('routeByName', () => {
  it('resolves a clearly named project with a reason', () => {
    expect(routeByName("Fix Ramu's mobile pairing screen", [ramu, store])).toMatchObject({
      kind: 'resolved',
      projectId: 'p1',
      via: 'name',
    })
  })
  it('uses aliases and prefers the longer name over one it contains', () => {
    expect(routeByName('tidy the agent app', [ramu, store])).toMatchObject({ projectId: 'p1', via: 'alias' })
    expect(routeByName('fix Ramu Mobile layout', [ramu, mobile])).toMatchObject({ projectId: 'p2' })
  })
  it('never matches on substrings or accents mismatch noise', () => {
    expect(routeByName('Fix the ramulan thing', [ramu])).toEqual({ kind: 'unknown' })
    expect(routeByName('Fix login', [store, billing])).toEqual({ kind: 'unknown' })
    expect(routeByName('café menu', [{ id: 'c', name: 'Cafe' }])).toMatchObject({ kind: 'resolved' })
  })
  it('asks when two projects tie, including the same name on two hosts', () => {
    const a = { id: 'a', name: 'Ramu', host: 'Laptop' }
    const b = { id: 'b', name: 'Ramu', host: 'Server' }
    const out = routeByName('Fix Ramu', [a, b])
    expect(out.kind).toBe('ambiguous')
    expect([...routingLabels([a, b]).values()]).toEqual(['Ramu · Laptop', 'Ramu · Server'])
  })
  it('reports no projects as unavailable', () => {
    expect(routeByName('anything', [])).toEqual({ kind: 'unavailable', reason: 'no-projects' })
  })
})

describe('AI stage', () => {
  const catalog = [store, billing]
  it('resolves only one catalog id with a grounded reason', () => {
    expect(interpretAiRouting({ projectIds: ['p3'], reason: 'Storefront handles checkout' }, catalog)).toMatchObject({
      kind: 'resolved',
      via: 'ai',
    })
  })
  it('asks when the reason is not grounded or several fit', () => {
    expect(interpretAiRouting({ projectIds: ['p3'], reason: 'seems right' }, catalog).kind).toBe('ambiguous')
    expect(interpretAiRouting({ projectIds: ['p3', 'p4'], reason: 'both' }, catalog).kind).toBe('ambiguous')
  })
  it('starts new work outside a project only when the classifier says it is new', () => {
    expect(interpretAiRouting({ projectIds: [], reason: 'A new page', new: true }, catalog)).toEqual({
      kind: 'new',
      reason: 'A new page',
    })
    expect(interpretAiRouting({ projectIds: [], reason: 'Unclear', new: false }, catalog)).toEqual({ kind: 'unknown' })
    // A match always wins over a stray new flag.
    expect(
      interpretAiRouting({ projectIds: ['p3'], reason: 'Storefront handles checkout', new: true }, catalog).kind,
    ).toBe('resolved')
  })
  it('rejects ids outside the catalog and malformed output; none means unknown', () => {
    expect(interpretAiRouting({ projectIds: ['zzz'], reason: 'x' }, catalog)).toEqual({
      kind: 'unavailable',
      reason: 'invalid-ai-result',
    })
    expect(interpretAiRouting({ projectIds: 'p3' }, catalog).kind).toBe('unavailable')
    expect(interpretAiRouting({ projectIds: [] }, catalog)).toEqual({ kind: 'unknown' })
  })
  it('refuses to send an oversize catalog and trims descriptions', () => {
    const many = Array.from({ length: ROUTING_CATALOG_LIMIT + 1 }, (_, i) => ({ id: `${i}`, name: `P${i}` }))
    expect(routingCatalog(many)).toBeNull()
    expect(routingCatalog([{ id: 'x', name: 'X', description: 'a'.repeat(1000) }])![0]!.description).toHaveLength(280)
  })
})
