import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { copyText } from '../ipc'

/**
 * Copies an address or code, showing a check for a moment once it is on the clipboard. `labelled` shows `label` beside
 * the icon, for a screen's main copy actions; the icon alone suits a row of many.
 */
export function CopyButton({ text, label, labelled = false }: { text: string; label: string; labelled?: boolean }) {
  const [done, setDone] = useState(false)
  const icon = done ? <Check size={14} /> : <Copy size={14} />
  const copy = () =>
    void copyText(text).then(() => {
      setDone(true)
      window.setTimeout(() => setDone(false), 1400)
    })
  return labelled ? (
    <Button variant="secondary" size="sm" className="bg-fill hover:bg-fill-hover" onClick={copy}>
      {icon}
      {label}
    </Button>
  ) : (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={copy}>
      {icon}
    </Button>
  )
}
