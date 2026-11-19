import type { AgentContent } from '@ramu/shared/types'
import type { ToolUse } from '../types'

export const isViewImageTool = (name: string) => /(?:^|[_.])view_image$/i.test(name)

/** Prefer the actual source filename, including its extension, over provider-generated prose. */
export function toolImageName(tool: ToolUse): string | undefined {
  for (const text of [tool.input, tool.summary]) {
    if (!text) continue
    try {
      const input = JSON.parse(text)
      const path = input.path ?? input.file_path ?? input.filePath ?? input.image_path
      if (typeof path === 'string' && path.trim()) return basename(path)
    } catch {
      if (/\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|svg)$/i.test(text.trim())) return basename(text.trim())
    }
  }
  const path = tool.locations?.[0]?.path
  return path ? basename(path) : undefined
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

/**
 * Some providers answer a Read of an image with text or nothing. The preview then comes from the file itself, which the
 * workspace serves under the same boundary as the explorer.
 */
export function readImageContent(path: string): AgentContent | undefined {
  const mimeType = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? '']
  return mimeType ? { type: 'image', mimeType, uri: path, alt: basename(path) } : undefined
}
