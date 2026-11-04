import { chatMarkdownComponents } from '../../../chat/ChatMarkdown'
import { ChatLink } from '../../../chat/ChatReferences'
import { parseThreadReference, remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { useLanguage } from '../../../i18n'
import { memo, useMemo, useRef } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentEvent } from '@ramu/shared/types'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { MessageTime } from './MessageTime'
import { CopyButton } from './CopyButton'
import { MessageQuoteActions } from './MessageQuoteActions'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { MessageActions } from './MessageActions'
import { MSG_CLASS } from '../styles'
import { noteArrival, rehypeStreamWords, streamClock } from '../lib/streamWords'
import { useSmoothText } from '../hooks/useSmoothText'

/** Memoized: the markdown parse is the costliest part of a transcript, and layout changes re-render the chat without changing a message. */
export const AssistantText = memo(function AssistantText({
  event: e,
  generating,
  actions = true,
  latest = false,
  taskId,
}: {
  event: Extract<AgentEvent, { kind: 'text' }>
  generating: boolean
  actions?: boolean
  latest?: boolean
  taskId?: string
  sessionId?: string
}) {
  useLanguage()
  // Written out at a steady pace while it streams; what has arrived but is not shown yet keeps the message live.
  const text = useSmoothText(e.text, generating)
  const writing = generating || text.length < e.text.length
  const clock = useRef(streamClock(text))
  noteArrival(clock.current, text)
  const rehypePlugins = useMemo(() => [rehypeStreamWords(clock.current)], [])
  // Stable component identities: a fresh `a` function every tick would remount every link.
  const components = useMemo<Components>(
    () => ({
      ...chatMarkdownComponents,
      a: ({ href, children }) => (
        <ChatLink href={href} taskId={taskId}>
          {children}
        </ChatLink>
      ),
    }),
    [taskId],
  )
  return (
    <Message>
      <MessageContent className="gap-0">
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className={`${MSG_CLASS} assistant${writing ? ' generating' : ''} w-full overflow-visible`}>
            <Markdown
              remarkPlugins={[remarkGfm, remarkChatReferences]}
              rehypePlugins={writing ? rehypePlugins : undefined}
              urlTransform={(url) =>
                url.startsWith(SKILL_REFERENCE_PREFIX) || parseThreadReference(url) || localFileLink(url)
                  ? url
                  : defaultUrlTransform(url)
              }
              components={components}
            >
              {text}
            </Markdown>
          </BubbleContent>
        </Bubble>
        {actions && !writing && (
          <MessageActions latest={latest} className="mt-2">
            <MessageTime at={e.at} />
            <CopyButton text={e.text} />
            <MessageQuoteActions text={e.text} />
          </MessageActions>
        )}
      </MessageContent>
    </Message>
  )
})
