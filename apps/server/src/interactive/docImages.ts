// A doc's pictures: PNG or JPEG files kept with its version and named by the relative path its Markdown shows them at.
import type { InteractiveFile } from '@ramu/shared/interactive'
import { imageSize } from './slides'

/** A relative image address as the doc's files name it; null for a web, data or page address. */
export function docImagePath(src: string): string | null {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('#')) return null
  let path = src.split(/[?#]/)[0]!
  try {
    path = decodeURI(path)
  } catch {
    // A stray % stays as written.
  }
  return path.replace(/^(\.\/)+/, '')
}

export interface DocImage {
  content: string
  bytes: Buffer
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

/** The doc's images by path, and the files that are not one. */
export function docImages(files: InteractiveFile[]): { images: Map<string, DocImage>; others: string[] } {
  const images = new Map<string, DocImage>()
  const others: string[] = []
  for (const file of files) {
    const bytes = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : null
    const size = bytes ? imageSize(bytes) : null
    if (bytes && size) images.set(file.path.replace(/^(\.\/)+/, ''), { content: file.content, bytes, ...size })
    else others.push(file.path)
  }
  return { images, others }
}
