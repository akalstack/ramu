import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BRAND_IDS, forgeBrand } from '../src/brands'
import { SOURCE_DEFAULTS } from '../src/webhooks'

const brandFile = (id: string) => new URL(`../../../apps/web/src/assets/brands/${id}.svg`, import.meta.url)

describe('brand marks', () => {
  it('ships a one-color mark for every brand, so the desktop, phone and site never miss one', () => {
    for (const id of BRAND_IDS) {
      expect(existsSync(brandFile(id)), id).toBe(true)
      // A fixed fill would ignore the theme's color when drawn as a mask tint on the phone.
      expect(readFileSync(brandFile(id), 'utf8'), id).not.toMatch(/fill="#/)
    }
  })

  it('names the mark for every hosting service and webhook source', () => {
    expect(forgeBrand('azure')).toBe('azure-devops')
    expect(forgeBrand('github')).toBe('github')
    expect(SOURCE_DEFAULTS.sentry.brand).toBe('sentry')
    expect(SOURCE_DEFAULTS.generic.brand).toBeNull()
  })
})
