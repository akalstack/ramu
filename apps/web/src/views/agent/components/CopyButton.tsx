import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '../../../ipc'
import { errorText } from '../../../TaskPane'
import { notifyError } from '../../../Notifications'
import { ICON_BUTTON_CLASS } from '../styles'

/** Copies `text` and shows a check for a moment. */
export function CopyButton({ text }: { text: string }) {
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
        void copyText(text).then(
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
