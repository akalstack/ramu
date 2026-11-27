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

/**
 * What each file this phone just uploaded is (name and type), by the id the host gave it, so a message still on its
 * way shows its files as the host's copy will. The message keeps them, so they show again after a restart.
 */
const files = new Map<string, import('@ramu/shared/types').Attachment>()

export function keepAttachment(file: import('@ramu/shared/types').Attachment) {
  files.delete(file.id)
  files.set(file.id, file)
  while (files.size > KEEP) files.delete(files.keys().next().value!)
}

export const attachmentsOf = (ids: readonly string[] | undefined) =>
  (ids ?? []).flatMap((id) => (files.has(id) ? [files.get(id)!] : []))
