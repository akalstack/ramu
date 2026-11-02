import { expect, it } from 'vitest'
import { markdownRuns } from '../src/chat/markdownRuns'

const styled = (source: string) =>
  markdownRuns(source)
    .filter((run) => run.marks.length)
    .map((run) => [run.text, run.marks.join('+')])

it('keeps every character, so the draft that is sent never changes', () => {
  const source = '# Title\n\n- **bold** and `code`\n> quote\n```ts\nconst a = 1\n```\n[link](https://a.dev) ~~gone~~'
  expect(
    markdownRuns(source)
      .map((run) => run.text)
      .join(''),
  ).toBe(source)
})

it('styles inline marks with dim markers', () => {
  expect(styled('a **b** c')).toEqual([
    ['**', 'marker'],
    ['b', 'strong'],
    ['**', 'marker'],
  ])
  expect(styled('*b*')[1]).toEqual(['b', 'emphasis'])
  expect(styled('[docs](x.md)')[1]).toEqual(['docs', 'link'])
})

it('styles line starts', () => {
  expect(styled('## Plan')).toEqual([
    ['## ', 'marker'],
    ['Plan', 'heading'],
  ])
  expect(styled('- item')).toEqual([['- ', 'marker']])
  expect(styled('> said')[1]).toEqual(['said', 'quote'])
})

it('leaves ordinary text and code contents alone', () => {
  expect(styled('use snake_case_name and 2 * 3 * 4')).toEqual([])
  expect(styled('`**not bold**`').map(([, marks]) => marks)).toEqual(['marker+code', 'code', 'marker+code'])
  expect(styled('```\n**x**\n```')).toEqual([['```\n**x**\n```', 'code']])
  expect(styled('```\nstill typing **x**')).toEqual([['```\nstill typing **x**', 'code']])
})

it('leaves a very long paste unstyled', () => {
  const source = `**${'a'.repeat(30_000)}**`
  expect(markdownRuns(source)).toEqual([{ text: source, marks: [] }])
})
