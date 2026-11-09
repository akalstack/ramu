import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BRAND_IDS, forgeBrand } from '../src/brands'
import { SOURCE_DEFAULTS } from '../src/webhooks'

const brandFile = (id: string) => new URL(`../../../apps/web/src/assets/brands/${id}.svg`, import.meta.url)

describe('brand marks', () => {
  it('ships every brand’s own full-color mark, with a version for dark surfaces where the mark is black', () => {
    for (const id of BRAND_IDS) {
      expect(existsSync(brandFile(id)), id).toBe(true)
      const svg = readFileSync(brandFile(id), 'utf8')
      // The files are drawn as images on the desktop, the phone and the site: nothing in them may run or load.
      expect(svg, id).not.toMatch(/<script|<foreignObject|\son[a-z]+=|href="(?!#)/i)
      // A mark with no color of its own would draw black, unreadable on dark surfaces, unless a dark version ships.
      const colored =
        /fill(?:="|:)\s*#(?!0{3}\b|0{6}\b|000020\b|1b1f23\b)|stop-color|linearGradient|radialGradient/i.test(svg)
      expect(colored || existsSync(brandFile(`${id}-dark`)), id).toBe(true)
    }
  })

  it('names the mark for every hosting service and webhook source', () => {
    expect(forgeBrand('azure')).toBe('azure-devops')
    expect(forgeBrand('github')).toBe('github')
    expect(SOURCE_DEFAULTS.sentry.brand).toBe('sentry')
    expect(SOURCE_DEFAULTS.generic.brand).toBeNull()
  })
})
