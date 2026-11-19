import { expect, it } from 'vitest'
import { interactiveVersions } from '../src/interactiveVersions'
import type { InteractiveReference } from '../src/interactive'
it('groups only this content/session, orders revisions, and keeps the historical reference authoritative', () => {
  const original: InteractiveReference = {
    id: 'c',
    sessionId: 's',
    network: { resources: [], connect: [] },
    version: 1,
    title: 'Original',
    summary: '',
    digest: 'hash',
    createdAt: 1,
    checked: true,
  }
  const newer = { ...original, version: 2, title: 'New' }
  expect(
    interactiveVersions(original, [
      newer,
      newer,
      { ...original, title: 'Changed' },
      { ...original, id: 'other' },
      { ...newer, sessionId: 'other' },
    ]),
  ).toEqual([newer, original])
  expect(interactiveVersions(original, [])).toEqual([original])
})

it('copies between revisions only with an explicit identical state schema and identical ownership', async () => {
  const { canCopyInteractiveState } = await import('../src/interactiveVersions')
  const from: InteractiveReference = {
    id: 'c',
    sessionId: 's',
    network: { resources: [], connect: [] },
    version: 1,
    title: 'Original',
    summary: '',
    digest: 'hash',
    createdAt: 1,
    checked: true,
    stateSchema: 'capacity-v1',
  }
  expect(canCopyInteractiveState(from, { ...from, version: 2 })).toBe(true)
  for (const to of [
    { ...from },
    { ...from, version: 2, stateSchema: undefined },
    { ...from, version: 2, stateSchema: 'new' },
    { ...from, version: 2, id: 'other' },
    { ...from, version: 2, sessionId: 'other' },
  ])
    expect(canCopyInteractiveState(from, to)).toBe(false)
  expect(
    canCopyInteractiveState({ ...from, stateSchema: undefined }, { ...from, version: 2, stateSchema: undefined }),
  ).toBe(false)
})
