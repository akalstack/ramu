import { VIEW_ONLY_WRITE_NOTICE } from '../../../composer/viewerAccess'
import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { ArrowLeft, Plus, MessageCircle, Quote, Send, X, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Aside } from '@ramu/shared/types'
import { Textarea } from '@/components/ui/textarea'
import { useHost } from '../../../workspace/HostProvider'
import { errorText } from '../../../workspace/TaskPane'
import { type AsideTarget } from '../types'
import { ChatStatus } from '../../../chat/ChatMotion'
import { AssistantText } from './AssistantText'
import { CopyButton } from './CopyButton'
import {
  ASIDE_ROW_QUOTE_CLASS,
  GHOST_TEXT_BUTTON_CLASS,
  ICON_BUTTON_CLASS,
  PANEL_BODY_CLASS,
  PANEL_HEADER_CLASS,
  PANEL_LABEL_CLASS,
  PANEL_TITLE_CLASS,
} from '../styles'
import { Message, MessageContent } from '@/components/ui/message'
import { UserBubble } from './UserMessage'

/** Side questions about the chat. Answers come from the chat's model, read-only, and never join the conversation. */
export function AsidePanel({
  sessionId,
  asides,
  open,
  taskId,
  onOpen,
  onClose,
  onQuote,
  readOnly = false,
}: {
  readOnly?: boolean
  sessionId: string
  asides: Aside[]
  open: AsideTarget | '*'
  taskId?: string
  onOpen: (value: AsideTarget | '*' | null) => void
  onClose: () => void
  onQuote: (text: string) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const aside = open === '*' ? undefined : open.id ? asides.find((entry) => entry.id === open.id) : undefined
  const quote = aside?.quote ?? (open === '*' ? '' : open.quote)
  const from = aside?.quoteFrom ?? (open === '*' ? 'assistant' : open.from)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null),
    body = useRef<HTMLDivElement>(null)
  const openKey = open === '*' ? '*' : (open.id ?? `new:${open.quote}`)
  useEffect(() => {
    setDraft('')
    setError(null)
    if (open === '*' || !open.keepFocus) requestAnimationFrame(() => input.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [openKey])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [aside?.messages.length])
  const waiting = aside?.messages.at(-1)?.role === 'user'
  const send = async () => {
    const question = draft.trim()
    if (readOnly || !question || sending || waiting) return
    setSending(true)
    setError(null)
    try {
      const next = await invoke('aside.ask', sessionId, aside?.id ?? null, quote, from, question)
      setDraft('')
      if (!aside) onOpen({ id: next.id, quote: next.quote, from: next.quoteFrom })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSending(false)
    }
  }
  const remove = (id: string) => {
    if (readOnly) return
    void invoke('aside.delete', sessionId, id).then(
      () => {
        if (aside?.id === id) onOpen(asides.length > 1 ? '*' : null)
      },
      (e) => setError(errorText(e)),
    )
  }
  const firstLine = (text: string) =>
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  return (
    <aside
      className="agent-panel absolute inset-[0_0_0_auto] z-6 w-[min(440px,_100%)] flex flex-col bg-canvas [box-shadow:-16px_0_32px_rgba(0,_0,_0,_0.28)] [animation:fade_0.12s_var(--ease)] [box-sizing:border-box] min-w-0 max-w-full overflow-hidden [border-left:var(--pane-border-width)_solid_var(--pane-border-color)] aside-panel"
      aria-label={translate('Aside')}
    >
      <header className={PANEL_HEADER_CLASS}>
        {open !== '*' && asides.length > 1 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={translate('All asides')}
            title={translate('All asides')}
            onClick={() => onOpen('*')}
          >
            <ArrowLeft size={14} />
          </Button>
        )}
        <MessageCircle size={14} />
        <span className={PANEL_TITLE_CLASS}>{open === '*' ? translate('Asides') : translate('Aside')}</span>
        {open !== '*' && quote && (
          <span
            className="aside-title-quote min-w-0 flex-initial overflow-hidden text-ellipsis whitespace-nowrap text-caption muted text-muted-foreground"
            title={quote}
          >
            {firstLine(quote)}
          </span>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {aside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={translate('New aside')}
            title={translate('New aside')}
            disabled={readOnly}
            onClick={() => onOpen({ id: null, quote: '', from: 'assistant' })}
          >
            <Plus size={14} />
          </Button>
        )}
        {aside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            disabled={readOnly}
            aria-label={translate('Delete aside')}
            title={translate('Delete aside')}
            onClick={() => remove(aside.id)}
          >
            <Trash2 size={13} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON_CLASS}
          aria-label={translate('Close aside')}
          title={translate('Close (Esc)')}
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </header>
      {open === '*' ? (
        <div className={`${PANEL_BODY_CLASS} agent-panel-list gap-2 pt-3`}>
          <Button
            variant="secondary"
            type="button"
            className="bg-fill hover:bg-fill-hover aside-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border-color:var(--line)] flex flex-col items-start justify-start gap-0.5 h-auto p-[8px_10px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised text-left whitespace-normal aside-new"
            disabled={readOnly}
            onClick={() => onOpen({ id: null, quote: '', from: 'assistant' })}
          >
            <span className={ASIDE_ROW_QUOTE_CLASS}>
              <Plus size={13} />
              {translate('New aside')}
            </span>
            <span className="muted text-muted-foreground small text-caption">
              {translate('Ask about the whole thread without interrupting it.')}
            </span>
          </Button>
          {asides.map((entry) => (
            <Button
              variant="secondary"
              key={entry.id}
              type="button"
              className="bg-fill hover:bg-fill-hover aside-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border-color:var(--line)] flex flex-col items-start justify-start gap-0.5 h-auto p-[8px_10px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised text-left whitespace-normal"
              onClick={() => onOpen({ id: entry.id, quote: entry.quote, from: entry.quoteFrom })}
            >
              <span className={ASIDE_ROW_QUOTE_CLASS}>{firstLine(entry.quote) || translate('Whole thread')}</span>
              <span className="muted text-muted-foreground small text-caption">
                {firstLine(entry.messages[0]?.text ?? '')}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <>
          <div ref={body} className={PANEL_BODY_CLASS}>
            {quote && (
              <blockquote className="aside-quote m-0 p-[8px_12px] [border-left:2px_solid_var(--line-strong)] text-soft text-control leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[160px] overflow-auto">
                <span className={PANEL_LABEL_CLASS}>
                  {from === 'user' ? translate('You wrote') : translate('From the thread')}
                </span>
                {quote}
              </blockquote>
            )}
            {aside?.messages.map((message) =>
              message.role === 'user' ? (
                <Message key={message.id} align="end">
                  <MessageContent className="items-end">
                    <UserBubble>{message.text}</UserBubble>
                  </MessageContent>
                </Message>
              ) : (
                <div
                  key={message.id}
                  className={`aside-answer flex flex-col gap-0.5${message.error ? ' error text-bad' : ''}`}
                >
                  {message.error ? (
                    <p className="error text-bad small text-caption">{message.text}</p>
                  ) : (
                    <AssistantText
                      event={{ kind: 'text', text: message.text, at: message.at }}
                      generating={false}
                      actions={false}
                      taskId={taskId}
                    />
                  )}
                  {!message.error && (
                    <div className="aside-answer-actions [&_.ghost.small]:text-muted-foreground [&_.ghost.small]:gap-[5px] flex items-center gap-0.5 ml-[-8px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={GHOST_TEXT_BUTTON_CLASS}
                        onClick={() => onQuote(message.text)}
                      >
                        <Quote size={12} />
                        {translate('Quote in message')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={GHOST_TEXT_BUTTON_CLASS}
                        onClick={() =>
                          onQuote(
                            `${aside.messages[aside.messages.indexOf(message) - 1]?.text ?? ''}\n\n${message.text}`,
                          )
                        }
                      >
                        {translate('Add Q&A to message')}
                      </Button>
                      <CopyButton text={message.text} />
                    </div>
                  )}
                </div>
              ),
            )}
            {waiting && <ChatStatus label={translate('Thinking aside')} />}
            {!aside && (
              <p className="muted text-muted-foreground small text-caption">
                {translate('Ask without interrupting the thread. Replies stay in this aside.')}
              </p>
            )}
          </div>
          {readOnly && (
            <p role="status" className="px-3 text-caption text-muted-foreground">
              {translate(VIEW_ONLY_WRITE_NOTICE)}
            </p>
          )}
          {error && <p className="error text-bad small text-caption aside-error m-[0_14px_6px]">{error}</p>}
          <form
            className="agent-panel-compose [&_textarea]:min-h-[56px] [&_textarea]:max-h-[160px] [&_textarea]:p-[10px_48px_10px_14px] [&_textarea]:border [&_textarea]:border-line [&_textarea]:rounded-(--radius-l) [&_textarea]:bg-fill [&_textarea]:resize-none [&_textarea]:text-control [&_textarea]:leading-[1.5] [&_textarea]:shadow-none [&_textarea]:ring-0 [&_textarea]:[transition:border-color_140ms_ease] [&_textarea:focus-visible]:border-line-strong [&_textarea:focus-visible]:ring-0 relative flex-none m-[0_10px_10px] min-w-0"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <Textarea
              ref={input}
              aria-label={translate('Ask aside')}
              placeholder={aside ? translate('Follow up…') : translate('Ask about this…')}
              disabled={readOnly}
              value={draft}
              rows={2}
              maxLength={20000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <Button
              variant="secondary"
              size="icon-sm"
              type="submit"
              className="icon p-0 size-(--action-size) flex-none justify-center agent-panel-send [&:hover:not(:disabled)]:[border:0] absolute right-2 bottom-2 w-7 h-7 rounded-full bg-primary text-primary-foreground [border:0] [transition:background-color_140ms_ease,opacity_140ms_ease] hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
              aria-label={translate('Ask')}
              title={translate('Ask aside')}
              disabled={readOnly || !draft.trim() || sending || waiting}
            >
              <Send size={14} />
            </Button>
          </form>
        </>
      )}
    </aside>
  )
}
