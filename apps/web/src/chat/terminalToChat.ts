import {
  addTerminalAttachment,
  isTerminalAttachmentList,
  type TerminalAttachment,
} from '@ramu/shared/chat/terminalContext'
import { loadJsonDraft, saveJsonDraft } from '../composer/drafts'

/** A terminal asks a chat's message box to carry captured output with the next message. */
export const TERMINAL_CONTEXT_EVENT = 'ramu:terminal-context'

export interface TerminalContextDetail {
  host: string
  session: string
  attachment: TerminalAttachment
  /** Set by the chat that took it; nobody taking it means the chat is not on screen. */
  taken?: boolean
}

/** Where a chat keeps terminal output waiting to be sent, beside its message text. */
export const terminalDraftKey = (sessionId: string) => `terminal:${sessionId}`

/**
 * Adds captured output to a chat's message box. A chat on screen takes it straight away; otherwise it waits in that
 * chat's saved draft and shows once the chat opens. Returns whether a chat on screen took it.
 */
export function sendTerminalToChat(host: string, session: string, attachment: TerminalAttachment): boolean {
  const detail: TerminalContextDetail = { host, session, attachment }
  window.dispatchEvent(new CustomEvent<TerminalContextDetail>(TERMINAL_CONTEXT_EVENT, { detail }))
  if (detail.taken) return true
  const key = terminalDraftKey(session)
  const current = loadJsonDraft(key, host, isTerminalAttachmentList, [])
  saveJsonDraft(key, host, addTerminalAttachment(current, attachment), (items) => items.length === 0)
  return false
}

/** Output for a message box that has no attachments of its own (New chat): a fenced block the person can edit. */
export function terminalAttachmentMarkdown(attachment: TerminalAttachment): string {
  const fence = '`'.repeat(Math.max(3, ...[...attachment.text.matchAll(/`{3,}/g)].map((run) => run[0].length + 1)))
  return `${fence}text\n${attachment.text}\n${fence}`
}
