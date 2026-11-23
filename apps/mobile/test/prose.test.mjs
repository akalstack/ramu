import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneProse } from '../src/runtime/prose.ts'

const sizes = { body: 15, control: 13 }

test('a reply reads at the body size with roomy lines and code a step smaller', () => {
  const reply = phoneProse('reply', 1, sizes)
  assert.equal(reply.size, 15)
  assert.equal(reply.lineHeight, 24)
  assert.equal(reply.code, 13)
  assert.ok(reply.headings[0].size > reply.size)
  assert.equal(reply.headings[5].size, reply.size)
})

test('a card reads at the control size, with tighter spacing than a reply', () => {
  const card = phoneProse('compact', 1, sizes)
  assert.equal(card.size, 13)
  assert.ok(card.blockGap < phoneProse('reply', 1, sizes).blockGap)
})

test('the in-app text size grows every part of rendered Markdown, not only the paragraphs', () => {
  const base = phoneProse('reply', 1, sizes)
  const larger = phoneProse('reply', 1.25, sizes)
  for (const key of ['size', 'lineHeight', 'blockGap', 'code', 'codeLineHeight', 'small']) {
    assert.ok(larger[key] > base[key], key)
  }
  assert.ok(larger.headings[0].size > base.headings[0].size)
})

test('a Markdown file gets the larger document headings', () => {
  assert.ok(phoneProse('document', 1, sizes).headings[0].size > phoneProse('reply', 1, sizes).headings[0].size)
})
