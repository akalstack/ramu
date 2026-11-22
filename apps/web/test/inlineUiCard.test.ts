import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { applyInlineUi, type InlineSurface } from '@ramu/shared/chat/inlineUi'
import type { AgentEvent } from '@ramu/shared/types'
import { InlineUiCard, InlineUiSurface } from '../src/chat/InlineUiCard'
import { toBlocks } from '../src/views/agent/lib/blocks'

vi.mock('../src/i18n', () => ({ useLanguage: () => 'en', t: (text: string) => text }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: vi.fn() }) }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/ipc', () => ({ invoke: vi.fn() }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))

const surface = (dataModel: Record<string, unknown>): InlineSurface => {
  const result = applyInlineUi(new Map(), [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'deploy',
        components: [
          { id: 'root', component: 'Column', children: ['title', 'targets', 'envs', 'go'] },
          { id: 'title', component: 'Text', text: { '@call': 'formatString', args: { value: 'Deploy **${/app}**' } } },
          {
            id: 'targets',
            component: 'ChoicePicker',
            label: 'Target',
            options: [
              { label: 'Staging', value: 'staging' },
              { label: 'Production', value: 'production' },
            ],
            value: { '@path': '/target' },
          },
          { id: 'envs', component: 'List', children: { componentId: 'env', path: '/envs' } },
          { id: 'env', component: 'Text', text: { '@path': 'name' }, variant: 'caption' },
          { id: 'go_label', component: 'Text', text: 'Deploy' },
          {
            id: 'go',
            component: 'Button',
            child: 'go_label',
            variant: 'primary',
            action: { event: { name: 'deploy', context: { target: { '@path': '/target' } } } },
            '@checks': [
              { condition: { '@call': 'required', args: { value: { '@path': '/target' } } }, message: 'Pick a target' },
            ],
          },
        ],
        dataModel,
      },
    },
  ])
  if (!result.ok) throw new Error(result.error)
  return result.surfaces[0]!
}
const render = (card: InlineSurface, live = true) =>
  renderToStaticMarkup(createElement(InlineUiCard, { surface: card, sessionId: 's', live }))

it('draws the card with bound text, templates and the chosen option', () => {
  const html = render(surface({ app: 'api', target: ['staging'], envs: [{ name: 'eu-1' }, { name: 'us-2' }] }))
  expect(html).toContain('<span>Deploy </span><strong>api</strong>')
  expect(html).toContain('eu-1')
  expect(html).toContain('us-2')
  expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Staging/)
  expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>Production/)
})

it('keeps the button off until its checks pass, and on a view-only device', () => {
  const pending = render(surface({ app: 'api', target: [] }))
  expect(pending).toMatch(/<button[^>]*disabled=""[^>]*title="Pick a target"/)
  const ready = render(surface({ app: 'api', target: ['staging'] }))
  expect(ready).not.toMatch(/<button(?=[^>]*title="Pick a target")/)
  expect(render(surface({ app: 'api', target: ['staging'] }), false)).toMatch(
    /<button[^>]*disabled=""[^>]*><span[^>]*><span><span>Deploy<\/span>/,
  )
})

it('shows each card once, at its newest version, and drops a deleted card', () => {
  const first = surface({ app: 'api', target: [] })
  const second = { ...first, revision: 2 }
  const events: AgentEvent[] = [
    { kind: 'inline-ui', surface: first },
    { kind: 'text', text: 'Pick a target.' },
    { kind: 'inline-ui', surface: second },
  ]
  const cards = toBlocks(events).filter((block) => block.kind === 'event' && block.event.kind === 'inline-ui')
  expect(cards).toHaveLength(1)
  expect(cards[0]!.kind === 'event' && cards[0]!.event.kind === 'inline-ui' && cards[0]!.event.surface.revision).toBe(2)
  const deleted: AgentEvent = { kind: 'inline-ui', surface: { ...first, revision: 3, components: [], deleted: true } }
  expect(
    toBlocks([...events, deleted]).some((block) => block.kind === 'event' && block.event.kind === 'inline-ui'),
  ).toBe(false)
})

it('draws a Card artifact’s records and totals from /records', () => {
  const result = applyInlineUi(
    new Map(),
    [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'trip',
          components: [
            { id: 'root', component: 'Column', children: ['total', 'list'] },
            {
              id: 'total',
              component: 'Text',
              text: { '@call': 'sum', args: { values: { '@path': '/records/spend' }, field: 'amount' } },
            },
            { id: 'list', component: 'List', children: { componentId: 'row', path: '/records/spend' } },
            { id: 'row', component: 'Text', text: { '@path': 'note' } },
          ],
        },
      },
    ],
    { collections: new Set(['spend']) },
  )
  if (!result.ok) throw new Error(result.error)
  const html = renderToStaticMarkup(
    createElement(InlineUiSurface, {
      surface: result.surfaces[0]!,
      draftKey: 'artifact-card:a',
      canAct: true,
      label: 'Trip',
      extra: {
        records: {
          spend: [
            { id: '1', amount: 30, note: 'Taxi' },
            { id: '2', amount: 12, note: 'Lunch' },
          ],
        },
      },
      onRequest: async () => false,
    }),
  )
  expect(html).toContain('<span>42</span>')
  expect(html).toContain('Taxi')
  expect(html).toContain('Lunch')
})
