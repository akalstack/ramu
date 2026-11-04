import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '../../../ipc'
import { markdownHtml } from '../../../chat/richCopy'
import { errorText } from '../../../workspace/TaskPane'
import { notifyError } from '../../../chat/Notifications'
import { ICON_BUTTON_CLASS } from '../styles'

/**
 * Copies `text` and shows a check for a moment. With `markdown`, the rendered form goes along as HTML, so a reply
 * pasted into a document keeps its tables, lists and links, and plain-text targets still get the Markdown.
 */
export function CopyButton({ text, markdown = false }: { text: string; markdown?: boolean }) {
  useLanguage()
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={`${ICON_BUTTON_CLASS} copy-btn`}
      aria-label={translate('Copy')}
      title={translate('Copy')}
      onClick={() => {
        void copyText(text, markdown ? markdownHtml(text) : undefined).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          },
          (error) => notifyError(errorText(error), 'Copy message'),
        )
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}
