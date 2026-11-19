import { reviewImageType } from './reviewImages'

/** How a changed file can be shown besides its text diff, as GitHub's rich diffs do. */
export type ReviewRichKind = 'image' | 'markdown' | 'table' | 'notebook' | 'model'

export function reviewRichKind(path: string): ReviewRichKind | undefined {
  if (reviewImageType(path)) return 'image'
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return 'markdown'
  if (extension === 'csv' || extension === 'tsv') return 'table'
  if (extension === 'ipynb') return 'notebook'
  if (extension === 'glb' || extension === 'gltf') return 'model'
  return undefined
}

/** Larger files keep only their size and digest, so a run full of assets cannot fill the host's disk. */
export const MAX_REVIEW_KEPT_BYTES = 25 * 1024 * 1024

/** Binary files whose bytes a run keeps, so their review can draw them before and after. */
export function reviewKeepsBytes(path: string): boolean {
  const kind = reviewRichKind(path)
  return kind === 'image' || kind === 'model'
}
