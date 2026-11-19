import { expect, it } from 'vitest'
import { clipText, clipTextEnd } from '../src/text'

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

it('keeps whole characters at either end of a cut', () => {
  const text = `ab😀cd👨‍👩‍👧‍👦ef`
  for (let max = 1; max < text.length; max++) {
    expect(clipText(text, max)).not.toMatch(LONE_SURROGATE)
    expect(clipTextEnd(text, max)).not.toMatch(LONE_SURROGATE)
    expect(clipTextEnd(text, max).length).toBeLessThanOrEqual(max)
    expect(text.endsWith(clipTextEnd(text, max))).toBe(true)
  }
  expect(clipTextEnd(text, 2)).toBe('ef')
  expect(clipTextEnd('short', 10)).toBe('short')
})
