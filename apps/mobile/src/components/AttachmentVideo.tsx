import type { Attachment } from '@ramu/shared/types'

export interface AttachmentVideoProps {
  file: Attachment
  computerId: string
}

/** The browser companion has no player for attachments; the file stays a chip there. */
export default function AttachmentVideo(_props: AttachmentVideoProps) {
  return null
}
