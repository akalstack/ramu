import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forgeSegments } from '../src/runtime/forgeMarkdown.ts'

const markdown = (body) =>
  forgeSegments(body)
    .filter((segment) => segment.kind === 'markdown')
    .map((segment) => segment.text)
    .join('\n\n')

test('hidden comments, line breaks and images read as GitHub shows them, with no raw tags', () => {
  const text = markdown(
    '<!-- bot state: {"a":1} -->\nFirst<br>second<br/>third\n<img width="40" src="https://x.test/a.png" alt="Logo">',
  )
  assert.equal(text.includes('<'), false)
  assert.equal(text.includes('bot state'), false)
  assert.match(text, /First\nsecond\nthird/)
  assert.match(text, /^!\[Logo\]\(https:\/\/x\.test\/a\.png\)$/m)
})

test('inline HTML becomes the Markdown that draws it, and unknown tags keep only their text', () => {
  const text = markdown(
    '<p>See <a href="https://x.test">the <b>docs</b></a>, <sub>small</sub> and H<sup>2</sup>O &amp; <kbd>Ctrl</kbd>&nbsp;C</p><h3>Notes</h3>',
  )
  assert.match(text, /\[the \*\*docs\*\*\]\(https:\/\/x\.test\)/)
  assert.match(text, /small and H2O & Ctrl C/)
  assert.match(text, /^### Notes$/m)
  assert.equal(text.includes('<'), false)
})

test('code keeps its text as written, HTML and all', () => {
  const body = 'Use `<br>` here.\n\n```html\n<details><summary>x</summary></details>\n```'
  assert.equal(forgeSegments(body).length, 1)
  assert.equal(markdown(body), body)
})

test('a suggestion shows the lines it adds, or that it removes them', () => {
  assert.match(markdown('```suggestion\nconst a = 1\n```'), /\*\*Suggested change\*\*\n\n```diff\n\+const a = 1\n```/)
  assert.equal(markdown('```suggestion\n```'), '**Suggests removing these lines**')
  const translated = forgeSegments('```suggestion\nx\n```', (key) => `[${key}]`)
  assert.match(translated[0].text, /\*\*\[Suggested change\]\*\*/)
})

test('details fold with their summary, closed unless opened, nested folds left in their body', () => {
  const segments = forgeSegments(
    'Before\n<details><summary><b>Walkthrough</b></summary>\n\nInside\n<details open><summary>More</summary>Deep</details>\n</details>\nAfter',
  )
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['markdown', 'details', 'markdown'],
  )
  const fold = segments[1]
  assert.equal(fold.summary, 'Walkthrough')
  assert.equal(fold.open, false)
  assert.match(fold.body, /Inside/)
  const inner = forgeSegments(fold.body).find((segment) => segment.kind === 'details')
  assert.equal(inner.summary, 'More')
  assert.equal(inner.open, true)
  assert.equal(markdown(inner.body), 'Deep')
})

test('an unclosed fold runs to the end, and a fold without a summary has none', () => {
  const [fold] = forgeSegments('<details>\nOnly body')
  assert.equal(fold.kind, 'details')
  assert.equal(fold.summary, '')
  assert.equal(markdown(fold.body), 'Only body')
})
