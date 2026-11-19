import { expect, it } from 'vitest'
import { addInteractiveAttachment } from '../src/interactive/followup'

const item = (version: number, text: string) => ({
  id: 'c',
  version,
  title: 'Deploy health',
  detail: 'Current scenario',
  text,
})

it('keeps one attachment per version, with the newest capture winning', () => {
  const first = addInteractiveAttachment([], item(1, 'old'))
  const replaced = addInteractiveAttachment(first, item(1, 'new'))
  expect(replaced).toEqual([item(1, 'new')])
  expect(addInteractiveAttachment(replaced, item(2, 'other')).map((entry) => entry.version)).toEqual([1, 2])
})
