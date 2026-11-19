import { expect, it } from 'vitest'
import { reviewKeepsBytes, reviewRichKind } from '../src/review/reviewRich'

it('names the drawn view each kind of changed file gets, as GitHub has rich diffs for', () => {
  expect(reviewRichKind('assets/Logo.PNG')).toBe('image')
  expect(reviewRichKind('icon.svg')).toBe('image')
  expect(reviewRichKind('docs/guide.md')).toBe('markdown')
  expect(reviewRichKind('data/people.tsv')).toBe('table')
  expect(reviewRichKind('analysis.ipynb')).toBe('notebook')
  expect(reviewRichKind('scene.glb')).toBe('model')
  expect(reviewRichKind('src/app.ts')).toBeUndefined()
  expect(reviewRichKind('Makefile')).toBeUndefined()
})

it('keeps bytes only for binary files a review draws', () => {
  expect(reviewKeepsBytes('photo.jpg')).toBe(true)
  expect(reviewKeepsBytes('robot.glb')).toBe(true)
  expect(reviewKeepsBytes('report.pdf')).toBe(false)
})
