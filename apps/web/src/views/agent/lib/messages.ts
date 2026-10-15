import { t as translate } from '../../../i18n'
import { OUTBOX_LIMIT } from '../../../composer/outbox'

/** Separates what you typed from the hidden context Ramu appends to a message for the agent. */
export const CONTEXT_MARKER = '\n\n<ramu-context>\n'

/** The part of a sent message you wrote, without the hidden context. */
export const visibleText = (text: string): string => text.split(CONTEXT_MARKER)[0] ?? ''

/** Markdown block quote of `text`, one `> ` per line. */
export const quoteLines = (text: string): string =>
  text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

/** The error for a full outbox: messages wait on this device while the host is unreachable, up to a limit. */
export const outboxFullError = (hostName: string) =>
  new Error(
    translate('{0} messages are already waiting. Remove one or wait for {1} to reconnect.', {
      0: OUTBOX_LIMIT,
      1: hostName,
    }),
  )
