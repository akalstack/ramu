import { afterEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { InteractiveStore, type InteractiveInput } from '../src/interactive/store'
import { PageStore } from '../src/interactive/pages'
import type { InlineSurface } from '@ramu/shared/chat/inlineUi'

const databases: Db[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const previewer = vi.fn(async (_html: string) => ({
  screenshot: 'data:image/png;base64,AA==',
  height: 400,
  checks: [],
  errors: [] as string[],
}))

function setup() {
  const db = openDb(':memory:')
  databases.push(db)
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0)",
  )
  const interactive = new InteractiveStore(db, vi.fn(), previewer)
  return { interactive, pages: new PageStore(db, interactive) }
}

const tracker = (button: Record<string, unknown>): InteractiveInput => ({
  kind: 'card',
  title: 'Trip costs',
  summary: 'What we spent',
  checks: [],
  records: { expenses: { fields: { amount: 'number', note: 'string?' } } },
  messages: [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'trip',
        components: [
          { id: 'root', component: 'Column', children: ['total', 'amount', 'add', 'list'] },
          {
            id: 'total',
            component: 'Text',
            text: {
              '@call': 'formatNumber',
              args: { value: { '@call': 'sum', args: { values: { '@path': '/records/expenses' }, field: 'amount' } } },
            },
          },
          {
            id: 'amount',
            component: 'TextField',
            label: 'Amount',
            value: { '@path': '/form/amount' },
            variant: 'number',
          },
          { id: 'add_label', component: 'Text', text: 'Add' },
          { id: 'add', component: 'Button', child: 'add_label', action: button },
          { id: 'list', component: 'List', children: { componentId: 'row', path: '/records/expenses' } },
          { id: 'row', component: 'Text', text: { '@path': 'note' } },
        ],
        dataModel: { form: { amount: '' } },
      },
    },
  ],
})
const add = {
  functionCall: {
    '@call': 'addRecord',
    args: { collection: 'expenses', values: { amount: { '@path': '/form/amount' } } },
  },
}

it('publishes a card kept with its surface and record collections, drawn as a page for previews and exports', async () => {
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', tracker(add))
  expect(preview.errors).toEqual([])
  const html = previewer.mock.calls.at(-1)![0]
  expect(html).toContain('class="ramu-card"')
  expect(html).toContain('<span>Amount</span>')
  expect(html).not.toContain('<script')
  const reference = interactive.publish('s', preview.id, 'r1')
  expect(reference).toMatchObject({ kind: 'card', files: ['card.json', 'ramu.json'] })
  const kept = pages.keep('s', reference.id, { title: 'Trip costs' })
  expect(kept.kind).toBe('card')
  expect(kept.capabilities.records?.expenses?.fields).toEqual({ amount: 'number', note: 'string?' })
  const surface = JSON.parse(
    pages.document(kept.id).files!.find((f) => f.path === 'card.json')!.content,
  ) as InlineSurface
  expect(surface).toMatchObject({ surfaceId: 'trip', revision: 1 })
  // Saving goes through the same records grant and field checks as an App.
  expect(() => pages.addRecord(kept.id, 'expenses', { amount: 12 })).toThrow('Allow it in Artifact settings')
  pages.grant(kept.id, { records: true })
  pages.addRecord(kept.id, 'expenses', { amount: 12 })
  expect(() => pages.addRecord(kept.id, 'expenses', { amount: 'lots' })).toThrow()
  expect(pages.records(kept.id, 'expenses').map((r) => r.data.amount)).toEqual([12])
})

it('refuses a card whose buttons talk to an agent or save to a collection it does not keep', async () => {
  const { interactive } = setup()
  const event = await interactive.preview('s', tracker({ event: { name: 'add' } }))
  expect(event.errors[0]).toContain('has no agent to send events to')
  const unknown = await interactive.preview('s', {
    ...tracker({ functionCall: { '@call': 'addRecord', args: { collection: 'trips', values: {} } } }),
  })
  expect(unknown.errors[0]).toContain("one of the card's records (expenses)")
  await expect(interactive.preview('s', { ...tracker(add), html: '<p>x</p>' })).rejects.toThrow(
    'A card is written in messages',
  )
})
