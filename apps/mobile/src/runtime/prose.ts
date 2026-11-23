import { PROSE, proseMetrics, type ProseDensity, type ProseMetrics } from '@ramu/shared/prose'

export interface PhoneProse extends ProseMetrics {
  /** Table cells and other secondary text inside a block, a step below body text. */
  small: number
  smallLineHeight: number
}

/**
 * The shared reading scale in points for this phone: the density's body size from the app's type scale, grown by the
 * in-app text size. The OS text size is applied by the native text views on top of this.
 */
export function phoneProse(
  density: ProseDensity,
  textScale: number,
  sizes: { readonly body: number; readonly control: number },
): PhoneProse {
  const scale = PROSE[density]
  const base = (scale.size === 'control' ? sizes.control : sizes.body) * textScale
  const small = Math.round(sizes.control * textScale)
  return { ...proseMetrics(base, density), small, smallLineHeight: Math.round(small * 1.45) }
}
