import { expect, it } from 'vitest'
import { modelDisplayName } from '../src/models/modelNames'

it('drops a provider prefix only when the name repeats it, and keeps one that tells routes apart', () => {
  expect(modelDisplayName('9router/9Router Auto')).toBe('9Router Auto')
  expect(modelDisplayName('opencode/Tidepool Alpha')).toBe('opencode/Tidepool Alpha')
  expect(modelDisplayName('gpt-6-luna')).toBe('GPT-6 Luna')
})
