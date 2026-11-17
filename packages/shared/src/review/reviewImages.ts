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

export function reviewImageType(path: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  return extension ? REVIEW_IMAGE_TYPES[extension] : undefined
}
