/**
 * A chat that finished, failed or is waiting on someone, or a deployed app nearing its plan's limit (`usage`, which
 * opens the project's most recent thread). The host keeps these until a person acts on them, on any device.
 */
export interface InboxNotice {
  /** `agent:<sessionId>`: one per chat, replaced as the chat moves on; `usage:…` for a usage notice. */
  id: string
  taskId: string
  sessionId: string
  kind: 'done' | 'input' | 'failed' | 'usage'
  title: string
  body: string
  at: number
}
