import { ChatMarkdownImage } from '../../../chat/ChatImage'
import { chatMarkdownComponents } from '../../../chat/ChatMarkdown'
import { ChatLink } from '../../../chat/ChatReferences'
import { parseThreadReference, remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { useLanguage } from '../../../i18n'
import { memo, useMemo, useState } from 'react'
import { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownText } from '../../../chat/MarkdownText'
import type { AgentEvent } from '@ramu/shared/types'
import { inlineCodeFileLink, localFileLink } from '@ramu/shared/workspace/fileLinks'
import { MessageTime } from './MessageTime'
import { CopyButton } from './CopyButton'
import { MessageQuoteActions } from './MessageQuoteActions'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { MessageActions } from './MessageActions'
import { MSG_CLASS } from '../styles'

const JUST_ARRIVED_MS = 5000

/** Memoized: the markdown parse is the costliest part of a transcript, and layout changes re-render the chat without changing a message. */
export const AssistantText = memo(function AssistantText({
  event: e,
  generating,
  fresh = false,
  actions = true,
  latest = false,
  taskId,
}: {
  event: Extract<AgentEvent, { kind: 'text' }>
  generating: boolean
  /** Arrived while this chat was open, so its blocks fade in even when it came in one piece. */
  fresh?: boolean
  actions?: boolean
  latest?: boolean
  taskId?: string
  sessionId?: string
}) {
  useLanguage()
  // Shown as it arrives, a top-level block at a time, each new block fading in once, as T3 Code does. A reply that came
  // in one piece just as the turn ended fades in too, but only while it is new: a row shown again later (a folded turn
  // opened) appears settled.
  const [justArrived] = useState(() => fresh && e.at !== undefined && Date.now() - e.at < JUST_ARRIVED_MS)
  // Stable component identities: a fresh `a` function every tick would remount every link.
  const components = useMemo<Components>(
    () => ({
      ...chatMarkdownComponents,
      a: ({ href, children }) => (
        <ChatLink href={href} taskId={taskId}>
          {children}
        </ChatLink>
      ),
      // A workspace image is fetched from the host, and any image opens larger, as on the phone.
      img: ({ src, alt }) => (
        <ChatMarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} taskId={taskId} />
      ),
      // Agents name files in backticks far more often than as links; a path there opens like a linked one. Code
      // blocks go through pre, which reads its source itself, so only inline code reaches here.
      code: ({ node, className, children }) => {
        const text = node?.children.map((child) => (child.type === 'text' ? child.value : '')).join('') ?? ''
        const path = !className ? inlineCodeFileLink(text) : null
        return path ? (
          <ChatLink href={path} taskId={taskId}>
            {path}
          </ChatLink>
        ) : (
          // A short name such as `--primary-light` stays whole: a hyphen inside it is no place to break a line. Long code
          // still wraps, so it never pushes past the column.
          <code className={!className && text.length <= 48 ? 'whitespace-nowrap' : className}>{children}</code>
        )
      },
    }),
    [taskId],
  )
  return (
    <Message>
      <MessageContent className="gap-0">
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className={`${MSG_CLASS} assistant${generating ? ' generating' : ''} w-full overflow-visible`}>
            <MarkdownText
              remarkPlugins={[remarkGfm, remarkChatReferences]}
              streaming={generating || justArrived}
              urlTransform={(url) =>
                url.startsWith(SKILL_REFERENCE_PREFIX) || parseThreadReference(url) || localFileLink(url)
                  ? url
                  : defaultUrlTransform(url)
              }
              components={components}
            >
              {e.text}
            </MarkdownText>
          </BubbleContent>
        </Bubble>
        {actions && !generating && (
          <MessageActions latest={latest} className="mt-2">
            <MessageTime at={e.at} />
            <CopyButton text={e.text} markdown />
            <MessageQuoteActions text={e.text} />
          </MessageActions>
        )}
      </MessageContent>
    </Message>
  )
})
