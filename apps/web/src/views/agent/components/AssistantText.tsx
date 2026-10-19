import { chatMarkdownComponents } from '../../../chat/ChatMarkdown'
import { ChatLink } from '../../../chat/ChatReferences'
import { parseThreadReference, remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { useLanguage } from '../../../i18n'
import { Children, memo, useEffect, useMemo, useRef } from 'react'
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

// Only newly received words fade briefly. No stagger or typing queue: text is readable as soon as it arrives.
const WORD_FADE_MS = 120
// A message already this long when it first appears (a chat opened mid-stream) shows what it has and fades only what follows.
const SETTLED_CHARS = 160

/** Where the words of the message stand: `plan[i]` is word i's delay (ms), or -1 when it is shown without a fade. */
interface WordPlan {
  plan: number[]
  /** Index of the next word in this render. */
  next: number
  settle: boolean
}

/** Previously rendered words stay settled; only new words get the brief fade. */
function fadeIn(children: React.ReactNode, words: WordPlan): React.ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string'
      ? child.split(/(\s+)/).map((part, i) => {
          if (part === '' || /^\s+$/.test(part)) return part
          const at = words.next++
          let delay = words.plan[at]
          const existing = delay !== undefined
          if (delay === undefined) {
            delay = words.settle ? -1 : 0
            words.plan[at] = delay
          }
          return existing || delay < 0 ? (
            part
          ) : (
            <span key={i} className="stream-word" style={{ animation: `stream-in ${WORD_FADE_MS}ms ease-out both` }}>
              {part}
            </span>
          )
        })
      : child,
  )
}
const streaming = (words: WordPlan): Components => ({
  p: ({ children }) => <p>{fadeIn(children, words)}</p>,
  li: ({ children }) => <li>{fadeIn(children, words)}</li>,
  strong: ({ children }) => <strong>{fadeIn(children, words)}</strong>,
  em: ({ children }) => <em>{fadeIn(children, words)}</em>,
  h1: ({ children }) => <h1>{fadeIn(children, words)}</h1>,
  h2: ({ children }) => <h2>{fadeIn(children, words)}</h2>,
  h3: ({ children }) => <h3>{fadeIn(children, words)}</h3>,
})

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
  const words = useRef<WordPlan>({ plan: [], next: 0, settle: e.text.length > SETTLED_CHARS })
  words.current.next = 0
  useEffect(() => {
    words.current.settle = false
  }, [])
  const fading = generating
  // Stable component identities: a fresh `a` function every tick would remount every link (and replay its fade) on each typewriter step.
  const components = useMemo<Components>(
    () => ({
      ...chatMarkdownComponents,
      ...(fading ? streaming(words.current) : {}),
      a: ({ href, children }) => (
        <ChatLink href={href} taskId={taskId}>
          {children}
        </ChatLink>
      ),
    }),
    [fading, taskId],
  )
  return (
    <Message>
      <MessageContent className="gap-0">
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className={`${MSG_CLASS} assistant${generating ? ' generating' : ''} w-full overflow-visible`}>
            <Markdown
              remarkPlugins={[remarkGfm, remarkChatReferences]}
              urlTransform={(url) =>
                url.startsWith(SKILL_REFERENCE_PREFIX) || parseThreadReference(url) || localFileLink(url)
                  ? url
                  : defaultUrlTransform(url)
              }
              components={components}
            >
              {e.text}
            </Markdown>
          </BubbleContent>
        </Bubble>
        {actions && !generating && (
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
