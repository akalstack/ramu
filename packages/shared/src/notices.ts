/** A chat that finished, failed or is waiting on someone. The host keeps these until a person acts on them, on any device. */
export interface InboxNotice {
  /** `agent:<sessionId>`: one per chat, replaced as the chat moves on. */
  id: string
  taskId: string
  sessionId: string
  kind: 'done' | 'input' | 'failed'
  title: string
  body: string
  at: number
}
