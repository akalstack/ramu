import { expect, it } from 'vitest'
import { modelTags } from '../src/providers/modelTags'

const now = Date.parse('2026-11-03T12:00:00Z')

it('tags a model new for two weeks after release, never when legacy, and a retirement only when it is near', () => {
  expect(modelTags({ releasedAt: '2026-10-28' }, now)).toEqual({ legacy: false, isNew: true, retires: null })
  expect(modelTags({ releasedAt: '2026-10-01' }, now).isNew).toBe(false)
  expect(modelTags({ releasedAt: '2026-12-01' }, now).isNew).toBe(false)
  expect(modelTags({ releasedAt: '2026-10-28', isLegacy: true }, now)).toMatchObject({ legacy: true, isNew: false })
  expect(modelTags({ retiresAt: '2026-11-30' }, now).retires).toBe('2026-11-30')
  expect(modelTags({ retiresAt: '2027-06-01' }, now).retires).toBeNull()
  expect(modelTags({}, now)).toEqual({ legacy: false, isNew: false, retires: null })
})
