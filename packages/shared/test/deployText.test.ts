import { describe, expect, it } from 'vitest'
import type { Deployment } from '../src/types/deploy'
import { previewLine } from '../src/deployText'

const t = (key: string, values: Record<string, string> = {}) =>
  key.replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '')

const preview = (patch: Partial<Deployment>): Deployment => ({
  id: 'd1',
  state: 'ready',
  url: 'https://shop-git-fix-me.vercel.app/',
  production: false,
  ref: 'fix',
  commit: 'abc',
  message: null,
  createdAt: 1,
  ...patch,
})

describe('previewLine', () => {
  it('names the preview’s address once it is ready, and how far the build got before that', () => {
    expect(previewLine(preview({}), t)).toEqual({
      text: 'Preview at shop-git-fix-me.vercel.app',
      url: 'https://shop-git-fix-me.vercel.app/',
      tone: 'ok',
    })
    expect(previewLine(preview({ state: 'building' }), t)).toMatchObject({ text: 'Preview building…', url: null })
    expect(previewLine(preview({ state: 'failed' }), t)).toMatchObject({ text: 'Preview failed', tone: 'bad' })
  })

  it('shows nothing without a preview, for a canceled one, or a ready one with no address', () => {
    expect(previewLine(null, t)).toBeNull()
    expect(previewLine(preview({ state: 'canceled' }), t)).toBeNull()
    expect(previewLine(preview({ url: null }), t)).toBeNull()
  })
})
