import { expect, it } from 'vitest'
import { coveredBy } from '../src/lib/floatingScrollbars'

/** A stand-in node: it contains itself and the nodes listed. */
const node = (...inside: object[]) => {
  const self: { contains: (other: Node | null) => boolean } = {
    contains: (other) => other === (self as unknown as Node) || inside.includes(other as object),
  }
  return self
}

it('a scroll area under an open menu or dialog draws no thumb over it; its own content does not hide it', () => {
  const row = node()
  const sidebar = node(row)
  const thumb = node()
  const layer = node(thumb)
  const menu = node()
  const hits = (...list: object[]) => list as unknown as Element[]
  // The menu is topmost where the sidebar's thumb would be: hidden.
  expect(coveredBy(sidebar, hits(menu, row, sidebar), layer)).toBe(true)
  // Only the sidebar's own row there, under the thumbs' layer: shown.
  expect(coveredBy(sidebar, hits(thumb, row, sidebar), layer)).toBe(false)
  // A menu that scrolls is itself on top, so its thumb shows above everything.
  expect(coveredBy(menu, hits(menu, row, sidebar), layer)).toBe(false)
})
