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
