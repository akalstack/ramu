import { expect, it } from 'vitest'
import { isViewOnly, VIEW_ONLY_NOTICE } from '../src/composer/viewerAccess'
import { indonesian } from '@ramu/shared/locales/id'

it('offers sending unless the host reports view-only access', () => {
  expect(isViewOnly({ access: 'viewer' })).toBe(true)
  expect(isViewOnly({ access: 'owner' })).toBe(false)
  expect(isViewOnly({})).toBe(false)
  expect(isViewOnly(null)).toBe(false)
})

it('localizes the view-only explanation', () => {
  expect(indonesian[VIEW_ONLY_NOTICE]).toBeTruthy()
})
