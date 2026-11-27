import { VIEW_ONLY_WRITE_NOTICE } from '../../../composer/viewerAccess'
import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { MessageCircle, MessageSquarePlus, Paperclip, Quote, X, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgentSettings, Aside, Attachment } from '@ramu/shared/types'
import { asideDraft } from '@ramu/shared/chat/asideDraft'
import { quotedQuestion, sideChat } from '@ramu/shared/chat/sideChat'
import { Composer } from '../../../composer/Composer'
import { focusComposer } from '../../../composer/ComposerInput'
import { ModelChoice, type ModelChoiceValue } from '../../../settings/ModelChoice'
import { useAppSettings } from '../../../settings/AppSettings'
import { errorText } from '../../../lib/errors'
import { useHost } from '../../../workspace/HostProvider'
import { type AsideTarget } from '../types'
import { ChatStatus } from '../../../chat/ChatMotion'
import { AssistantText } from './AssistantText'
import { CopyButton } from './CopyButton'
import {
  GHOST_TEXT_BUTTON_CLASS,
  ICON_BUTTON_CLASS,
  PANEL_BODY_CLASS,
  PANEL_HEADER_CLASS,
  PANEL_LABEL_CLASS,
  PANEL_TITLE_CLASS,
} from '../styles'
import { Message, MessageContent } from '@/components/ui/message'
import { UserBubble } from './UserMessage'

const QUOTE_CLASS =
  'aside-quote m-0 p-[8px_12px] [border-left:2px_solid_var(--line-strong)] text-soft text-control leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[160px] overflow-auto'

/**
 * The thread's one side chat, like Claude's /btw: questions about the work that the agent never sees, answered
 * read-only, kept in one conversation as on the phone. A passage picked in the thread rides with the next question;
 * the whole chat is cleared with the trash button or carried into a new thread.
 */
export function AsidePanel({
  sessionId,
  asides,
  open,
  taskId,
  settings,
  onClose,
  onQuote,
  onPromote,
  readOnly = false,
}: {
  readOnly?: boolean
  sessionId: string
  /** The model chosen in the thread's composer, which answers the aside unless one is picked for it. */
  settings?: AgentSettings
  asides: Aside[]
  open: AsideTarget
  taskId?: string
  onClose: () => void
  onQuote: (text: string) => void
  /** Opens a new thread whose message box holds the aside, so it can carry on as work of its own. */
  onPromote: (draft: string) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const { messages, continueId, waiting } = sideChat(asides)
  const latest = asides.find((entry) => entry.id === continueId)
  const [draft, setDraft] = useState('')
  // The passage the next question is about; it leaves with that question.
  const [passage, setPassage] = useState(open.quote)
  const [error, setError] = useState<string | null>(null)
  const composer = useRef<HTMLDivElement>(null),
    body = useRef<HTMLDivElement>(null)
  const [files, setFiles] = useState<Attachment[]>([])
  // The model that answers starts as the one Settings names for asides; empty means the thread's own. A pick here
  // lasts while the panel is open, so a follow-up keeps the model the person chose.
  const asideModel = useAppSettings().preferences.asideModel ?? null
  const [picked, setPicked] = useState<ModelChoiceValue>(asideModel)
  useEffect(() => {
    setPassage(open.quote)
    setError(null)
    if (!open.keepFocus) requestAnimationFrame(() => focusComposer(composer.current))
    // Each Ask aside is a new target, even on the same passage.
  }, [open])
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
  }, [messages.length, passage])
  // The composer shows a failed send itself and keeps the text, as the thread's does.
  const send = async () => {
    const question = draft.trim() || (files.length ? translate('What is in the attached files?') : '')
    if (readOnly || !question || waiting) return
    setError(null)
    // The first question carries its passage natively; later ones continue the same aside with the passage inline.
    await invoke(
      'aside.ask',
      sessionId,
      latest?.id ?? null,
      latest ? latest.quote : passage,
      latest ? latest.quoteFrom : open.from,
      latest ? quotedQuestion(question, passage) : question,
      settings,
      {
        ...(picked ? { model: picked } : {}),
        ...(files.length ? { attachmentIds: files.map((file) => file.id) } : {}),
      },
    )
    setDraft('')
    setPassage('')
    setFiles([])
  }
  const clear = () => {
    if (readOnly) return
    void Promise.all(asides.map((entry) => invoke('aside.delete', sessionId, entry.id))).catch((e) =>
      setError(errorText(e)),
    )
  }
  const carried = asideDraft(messages)
  return (
    <aside
      className="agent-panel absolute inset-[0_0_0_auto] z-6 w-[min(440px,_100%)] flex flex-col bg-canvas [box-shadow:-16px_0_32px_rgba(0,_0,_0,_0.28)] [animation:fade_0.12s_var(--ease)] [box-sizing:border-box] min-w-0 max-w-full overflow-hidden [border-left:var(--pane-border-width)_solid_var(--pane-border-color)] aside-panel"
      aria-label={translate('Aside')}
    >
      <header className={PANEL_HEADER_CLASS}>
        <MessageCircle size={14} />
        <span className={PANEL_TITLE_CLASS}>{translate('Aside')}</span>
        <span className="grow flex-1 min-w-0 text-left" />
        {carried && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            disabled={readOnly}
            aria-label={translate('Continue in a new thread')}
            title={translate('Continue in a new thread. The aside stays here, and nothing is sent until you send it.')}
            onClick={() => onPromote(carried)}
          >
            <MessageSquarePlus size={14} />
          </Button>
        )}
        {asides.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            disabled={readOnly}
            aria-label={translate('Delete aside')}
            title={translate('Delete aside')}
            onClick={clear}
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
      <div ref={body} className={PANEL_BODY_CLASS}>
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div key={message.id} className="flex flex-col gap-2">
              {message.quote && <blockquote className={QUOTE_CLASS}>{message.quote}</blockquote>}
              <Message align="end">
                <MessageContent className="items-end">
                  {message.attachments?.length ? (
                    <span className="flex max-w-full flex-wrap justify-end gap-1">
                      {message.attachments.map((file) => (
                        <span
                          key={file.id}
                          className="inline-flex min-w-0 max-w-full items-center gap-1 text-caption text-muted-foreground"
                        >
                          <Paperclip size={12} className="flex-none" />
                          <span className="truncate">{file.name}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <UserBubble>{message.text}</UserBubble>
                </MessageContent>
              </Message>
            </div>
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
                    onClick={() => onQuote(`${messages[index - 1]?.text ?? ''}\n\n${message.text}`)}
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
        {!messages.length && !passage && (
          <p className="muted text-muted-foreground small text-caption">
            {translate('Ask without interrupting the thread. Replies stay in this aside.')}
          </p>
        )}
        {passage && (
          <blockquote className={`${QUOTE_CLASS} relative pr-8`}>
            <span className={PANEL_LABEL_CLASS}>
              {open.from === 'user' ? translate('You wrote') : translate('From the thread')}
            </span>
            {passage}
            <Button
              variant="ghost"
              size="icon-xs"
              className={`${ICON_BUTTON_CLASS} absolute top-1 right-1`}
              aria-label={translate('Remove quote')}
              title={translate('Remove quote')}
              onClick={() => setPassage('')}
            >
              <X size={12} />
            </Button>
          </blockquote>
        )}
      </div>
      {readOnly && (
        <p role="status" className="px-3 text-caption text-muted-foreground">
          {translate(VIEW_ONLY_WRITE_NOTICE)}
        </p>
      )}
      {error && <p className="error text-bad small text-caption aside-error m-[0_14px_6px]">{error}</p>}
      {/* The thread's own composer, with its files and a model of its own, without the queue an aside has no use for. */}
      <div ref={composer} className="aside-composer flex-none min-w-0 p-[0_10px_10px]">
        <Composer
          value={draft}
          scopeId={taskId}
          onChange={setDraft}
          onSubmit={send}
          placeholder={messages.length ? translate('Follow up…') : translate('Ask about this…')}
          submitLabel={translate('Ask aside')}
          disabled={readOnly || waiting}
          attachments={files}
          onAttachmentsChange={readOnly ? undefined : setFiles}
          allowEmpty={files.length > 0}
          controls={<ModelChoice label={translate('Aside model')} value={picked} onChange={setPicked} />}
        />
      </div>
    </aside>
  )
}
