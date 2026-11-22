import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyInlineUi, inlineUiActionMessage } from '../../../packages/shared/src/chat/inlineUi.ts'
import { transcript } from '../src/runtime/transcript.ts'

const card = () => {
  const result = applyInlineUi(new Map(), [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'ok',
        components: [
          { id: 'root', component: 'Column', children: ['label', 'go'] },
          { id: 'label', component: 'Text', text: 'Ship it?' },
          { id: 'go_text', component: 'Text', text: 'Ship' },
          {
            id: 'go',
            component: 'Button',
            child: 'go_text',
            action: { event: { name: 'ship', userMessage: 'Ship it' } },
          },
        ],
      },
    },
  ])
  assert.ok(result.ok)
  return result.surfaces[0]
}

test('a card appears once at its newest version, and a pressed button reads as what the person did', () => {
  const first = card()
  const second = { ...first, revision: 2 }
  const pressed = inlineUiActionMessage({
    name: 'ship',
    surfaceId: 'ok',
    sourceComponentId: 'go',
    timestamp: new Date(0).toISOString(),
    context: {},
    userMessage: 'Ship it',
  })
  const items = transcript([
    { kind: 'inline-ui', surface: first },
    { kind: 'user', text: pressed },
    { kind: 'inline-ui', surface: second },
  ])
  const cards = items.filter((item) => item.kind === 'inline-ui')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].surface.revision, 2)
  const note = items.find((item) => item.kind === 'note')
  assert.equal(note.title, 'From a card')
  assert.equal(note.detail, 'Ship it')
  assert.equal(
    items.some((item) => item.kind === 'user'),
    false,
  )
})

test('a deleted card leaves no row', () => {
  const first = card()
  const items = transcript([
    { kind: 'inline-ui', surface: first },
    { kind: 'inline-ui', surface: { ...first, revision: 2, components: [], deleted: true } },
  ])
  assert.equal(
    items.some((item) => item.kind === 'inline-ui'),
    false,
  )
})
