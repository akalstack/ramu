/** Images a run's review can show before and after, by extension, with the type a data URL needs. */
const REVIEW_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

/** Larger images keep only their size and digest, so a run full of assets cannot fill the host's disk. */
export const MAX_REVIEW_IMAGE_BYTES = 10 * 1024 * 1024

export function reviewImageType(path: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  return extension ? REVIEW_IMAGE_TYPES[extension] : undefined
}
