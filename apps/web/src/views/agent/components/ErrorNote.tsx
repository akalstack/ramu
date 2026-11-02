import { useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { agentErrorView } from '@ramu/shared/chat/agentErrorView'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../../i18n'
import { openModelList } from '../../../models/modelPickerRequest'
import { CopyButton } from './CopyButton'

const LONG = 240

/**
 * An error the agent or a tool reported, in the transcript. A quiet card like the rest of the thread: the mark carries
 * the color so the words stay readable, it says what happened in plain terms, and it offers the step that fixes it.
 */
export function ErrorNote({ message }: { message: string }) {
  useLanguage()
  const card = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const { title, action } = agentErrorView(message)
  const providers = () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } }))
  const chooseModel = () => {
    const trigger = card.current?.closest('.agent-view')?.querySelector<HTMLElement>('.model-bar-trigger')
    if (trigger) openModelList(trigger)
    else providers()
  }
  return (
    <div ref={card} role="alert" className="my-2 flex items-start gap-2.5 rounded-(--radius-m) bg-fill p-[10px_12px]">
      <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-bad" />
      <div className="min-w-0 flex-1">
        <div className="text-control font-medium text-foreground">{t(title)}</div>
        <p
          className={`m-0 mt-0.5 text-control leading-[1.5] text-muted-foreground break-words ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}
        >
          {message}
        </p>
        {message.length > LONG && (
          <Button variant="ghost" size="xs" className="-ml-2 mt-0.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? t('Show less') : t('Show more')}
          </Button>
        )}
      </div>
      <div className="flex flex-none items-center gap-1">
        {action === 'model' && (
          <Button variant="secondary" size="sm" onClick={chooseModel}>
            {t('Change model')}
          </Button>
        )}
        {action === 'providers' && (
          <Button variant="secondary" size="sm" onClick={providers}>
            {t('Open providers')}
          </Button>
        )}
        <CopyButton text={message} />
      </div>
    </div>
  )
}
