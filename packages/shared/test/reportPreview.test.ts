import { expect, it } from 'vitest'
import { reportPreview } from '../src/chat/helperPresentation'

it('reads a report’s first paragraph as plain text', () => {
  expect(
    reportPreview(
      '**Verdict: yes, this project is in good shape.** The caveat is that I only\nskimmed `src/`.\n\n## Strengths\n\n- One',
    ),
  ).toBe('Verdict: yes, this project is in good shape. The caveat is that I only skimmed src/.')
})

it('skips leading headings and keeps a list item’s text', () => {
  expect(reportPreview('## Findings\n\n- Fix the [login](https://x.test) _redirect_\n- Two')).toBe(
    'Fix the login redirect',
  )
  expect(reportPreview('```ts\nconst a = 1\n```\n\nDone.')).toBe('Done.')
  expect(reportPreview('')).toBe('')
})

it('leaves snake_case and arithmetic alone', () => {
  expect(reportPreview('Renamed user_id in a*b checks')).toBe('Renamed user_id in a*b checks')
})
