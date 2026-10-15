import type { AgentContent } from '../types'

const MAX_MEDIA = 28 * 1024 * 1024
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}

/** Normalize ACP content and the equivalent MCP/Claude content blocks without flattening media. */
export function agentContent(value: unknown): AgentContent[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  return (Array.isArray(value) ? value : value == null ? [] : [value]).flatMap((raw): AgentContent[] => {
    const b = object(raw)
    if (b.type === 'content') return agentContent(b.content)
    if (b.type === 'text' && typeof b.text === 'string') return [{ type: 'text', text: b.text }]
    if (b.type === 'image') {
      const source = object(b.source)
      const mimeType = str(b.mimeType) ?? str(source.media_type) ?? 'image/png'
      const data = str(b.data) ?? str(source.data)
      const uri = str(b.uri) ?? str(b.url) ?? str(source.url)
      const inline = uri && /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri)
      if (inline && !data) return agentContent({ type: 'image', mimeType: inline[1], data: inline[2], alt: b.alt })
      if (data && data.length > MAX_MEDIA)
        return [{ type: 'unsupported', label: 'Image too large to display', detail: mimeType }]
      return [
        {
          type: 'image',
          mimeType,
          ...(data ? { data } : {}),
          ...(uri ? { uri } : {}),
          ...(str(b.alt) ? { alt: b.alt } : {}),
        },
      ]
    }
    if (b.type === 'audio' && typeof b.data === 'string' && typeof b.mimeType === 'string') {
      return b.data.length <= MAX_MEDIA
        ? [{ type: 'audio', data: b.data, mimeType: b.mimeType }]
        : [{ type: 'unsupported', label: 'Audio too large to display' }]
    }
    if (b.type === 'diff' && typeof b.path === 'string' && typeof b.newText === 'string')
      return [{ type: 'diff', path: b.path, oldText: str(b.oldText) ?? null, newText: b.newText }]
    if (b.type === 'terminal' && typeof b.terminalId === 'string')
      return [{ type: 'terminal', terminalId: b.terminalId, ...(str(b.output) ? { output: b.output } : {}) }]
    if (b.type === 'resource' || b.type === 'resource_link') {
      const r = b.type === 'resource' ? object(b.resource) : b
      const uri = str(r.uri) ?? ''
      const blob = str(r.blob)
      if (blob && blob.length > MAX_MEDIA)
        return [{ type: 'unsupported', label: 'Resource too large to display', detail: uri }]
      return [
        {
          type: 'resource',
          uri,
          name: str(b.title) ?? str(b.name) ?? uri.split('/').at(-1) ?? 'Resource',
          ...(str(r.mimeType) ? { mimeType: r.mimeType } : {}),
          ...(str(r.text) !== undefined ? { text: r.text } : {}),
          ...(blob ? { blob } : {}),
          ...(str(b.description) ? { description: b.description } : {}),
        },
      ]
    }
    return [{ type: 'unsupported', label: `Unsupported content: ${str(b.type) ?? 'unknown'}` }]
  })
}

export function contentSummary(content: AgentContent[]): string {
  return content
    .map((b) =>
      b.type === 'text'
        ? b.text
        : b.type === 'diff'
          ? b.path
          : b.type === 'resource'
            ? b.name
            : b.type === 'terminal'
              ? (b.output ?? `Terminal ${b.terminalId}`)
              : b.type === 'unsupported'
                ? b.label
                : b.type === 'image'
                  ? (b.alt ?? b.uri ?? 'Image')
                  : 'Audio',
    )
    .join('\n')
}

/** Only inline raster/audio data is embedded; remote URIs remain explicit links. */
export function inlineMedia(mimeType: string, data: string | undefined, kind: 'image' | 'audio'): string | undefined {
  const allowed =
    kind === 'image'
      ? /^image\/(png|jpeg|jpg|gif|webp|avif|bmp)$/i
      : /^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|aac|mp4|flac)$/i
  return data && data.length <= MAX_MEDIA && allowed.test(mimeType) && /^[A-Za-z0-9+/=\s]+$/.test(data)
    ? `data:${mimeType};base64,${data}`
    : undefined
}

export function resourceDownload(blob: string | undefined): string | undefined {
  return blob && blob.length <= MAX_MEDIA && /^[A-Za-z0-9+/=\s]+$/.test(blob)
    ? `data:application/octet-stream;base64,${blob}`
    : undefined
}
