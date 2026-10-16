import { chatCodeComponents } from '../../../chat/ChatCodeBlock'
import { ChatLink } from '../../../chat/ChatReferences'
import { parseThreadReference, remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { useLanguage } from '../../../i18n'
import { Children, memo, useEffect, useMemo, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentEvent } from '@ramu/shared/types'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { MessageTime } from './MessageTime'
import { CopyButton } from './CopyButton'
import { MessageQuoteActions } from './MessageQuoteActions'
import { MSG_ACTIONS_CLASS, MSG_CLASS } from '../styles'

// Streamed words fade in on the compositor: each is a CSS animation, so nothing runs in JavaScript per frame. Words that arrive
// together are staggered with an animation-delay so they flow in rather than landing as one block; the cap keeps a big chunk prompt.
const STAGGER_MS = 28
const STAGGER_CAP_MS = 400
// A message already this long when it first appears (a chat opened mid-stream) shows what it has and fades only what follows.
const SETTLED_CHARS = 160

/** Where the words of the message stand: `plan[i]` is word i's delay (ms), or -1 when it is shown without a fade. */
interface WordPlan {
  plan: number[]
  /** Index of the next word in this render, and of the first word that is new in it. */
  next: number
  batch: number
  settle: boolean
}

/** Words that arrive while the agent is writing fade in, so the newest few read dimmer. A word's delay is decided once, so later renders never restart it. */
function fadeIn(children: React.ReactNode, words: WordPlan): React.ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string'
      ? child.split(/(\s+)/).map((part, i) => {
          if (part === '' || /^\s+$/.test(part)) return part
          const at = words.next++
          let delay = words.plan[at]
          if (delay === undefined) {
            delay = words.settle ? -1 : Math.min((at - words.batch) * STAGGER_MS, STAGGER_CAP_MS)
            words.plan[at] = delay
          }
          return delay < 0 ? (
            part
          ) : (
            <span key={i} className="stream-word" style={{ animation: `stream-in 0.6s ease-out ${delay}ms both` }}>
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
  const words = useRef<WordPlan>({ plan: [], next: 0, batch: 0, settle: e.text.length > SETTLED_CHARS })
  words.current.next = 0
  words.current.batch = words.current.plan.length
  useEffect(() => {
    words.current.settle = false
  }, [])
  // The last words keep fading for a moment after the reply ends, instead of snapping to full.
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    if (generating) {
      setLingering(true)
      return
    }
    const timer = setTimeout(() => setLingering(false), 800)
    return () => clearTimeout(timer)
  }, [generating])
  const fading = generating || lingering
  // Stable component identities: a fresh `a` function every tick would remount every link (and replay its fade) on each typewriter step.
  const components = useMemo<Components>(
    () => ({
      ...chatCodeComponents,
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
    <div className={`${MSG_CLASS} assistant${generating ? ' generating' : ''}`}>
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
      {actions && !generating && (
        <div className={`${MSG_ACTIONS_CLASS}${latest ? ' always' : ''}`}>
          <MessageTime at={e.at} />
          <CopyButton text={e.text} />
          <MessageQuoteActions text={e.text} />
        </div>
      )}
    </div>
  )
})
