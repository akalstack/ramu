import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { copyText } from '../ipc'

/** Copies an address or code, showing a check for a moment once it is on the clipboard. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={() =>
        void copyText(text).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1400)
        })
      }
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}
