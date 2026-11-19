import type { AgentContent } from '@ramu/shared/types'

/** Separate visual results from text and metadata within the same tool disclosure. */
export function splitToolContent(content: AgentContent[] = []) {
  const images: AgentContent[] = []
  const details: AgentContent[] = []
  for (const item of content) {
    if (item.type === 'image' || (item.type === 'resource' && item.mimeType?.startsWith('image/') && item.blob))
      images.push(item)
    else details.push(item)
  }
  return { images, details }
}
