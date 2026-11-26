/**
 * The picture this phone just picked, by the id the host gave its upload. The composer and the sent message show it
 * at once from the phone's own copy, instead of a file name while the host's thumbnail is fetched. Kept for the
 * session only, and only the most recent few.
 */
const previews = new Map<string, string>()
const KEEP = 40

export function keepAttachmentPreview(id: string, uri: string) {
  previews.delete(id)
  previews.set(id, uri)
  while (previews.size > KEEP) previews.delete(previews.keys().next().value!)
}

export const attachmentPreview = (id: string): string | null => previews.get(id) ?? null
