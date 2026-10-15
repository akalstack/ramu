import { chatCodeComponents } from '../../../chat/ChatCodeBlock'
import { ChatLink } from '../../../chat/ChatReferences'
import { remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chat/chatReferences'
import { useLanguage } from '../../../i18n'
import { Children, memo, useMemo } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentEvent } from '@ramu/shared/types'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { useTypewriter } from '../hooks/useTypewriter'
import { MessageTime } from './MessageTime'
import { CopyButton } from './CopyButton'
import { MSG_ACTIONS_CLASS, MSG_CLASS } from '../styles'

/** Words that arrive while the agent is writing fade in, so the newest few read dimmer. */
function fadeIn(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string'
      ? child.split(/(\s+)/).map((part, i) =>
          part === '' || /^\s+$/.test(part) ? (
            part
          ) : (
            <span key={i} className="stream-word [animation:stream-in_1.1s_ease-out_both]">
              {part}
            </span>
          ),
        )
      : child,
  )
}
const STREAMING: Components = {
  p: ({ children }) => <p>{fadeIn(children)}</p>,
  li: ({ children }) => <li>{fadeIn(children)}</li>,
  strong: ({ children }) => <strong>{fadeIn(children)}</strong>,
  em: ({ children }) => <em>{fadeIn(children)}</em>,
  h1: ({ children }) => <h1>{fadeIn(children)}</h1>,
  h2: ({ children }) => <h2>{fadeIn(children)}</h2>,
  h3: ({ children }) => <h3>{fadeIn(children)}</h3>,
}

/** Memoized: the markdown parse is the costliest part of a transcript, and layout changes re-render the chat without changing a message. */
export const AssistantText = memo(function AssistantText({
  event: e,
  generating,
  actions,
  latest = false,
  taskId,
  sessionId,
}: {
  event: Extract<AgentEvent, { kind: 'text' }>
  generating: boolean
  actions: boolean
  latest?: boolean
  taskId?: string
  sessionId?: string
}) {
  useLanguage()
  const text = useTypewriter(e.text, generating)
  // Stable component identities: a fresh `a` function every tick would remount every link (and replay its fade) on each typewriter step.
  const components = useMemo<Components>(
    () => ({
      ...chatCodeComponents,
      ...(generating ? STREAMING : {}),
      a: ({ href, children }) => (
        <ChatLink href={href} taskId={taskId}>
          {children}
        </ChatLink>
      ),
    }),
    [generating, taskId],
  )
  return (
    <div className={`${MSG_CLASS} assistant${generating ? ' generating' : ''}`}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkChatReferences]}
        urlTransform={(url) =>
          url.startsWith(SKILL_REFERENCE_PREFIX) || localFileLink(url) ? url : defaultUrlTransform(url)
        }
        components={components}
      >
        {text}
      </Markdown>
      {actions && !generating && (
        <div className={`${MSG_ACTIONS_CLASS}${latest ? ' always' : ''}`}>
          <MessageTime at={e.at} />
          <CopyButton text={e.text} />
        </div>
      )}
    </div>
  )
})
