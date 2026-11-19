import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { t, useLanguage } from '../../i18n'

export function InlineEdit({
  value,
  onDone,
  readOnly = false,
}: {
  value: string
  onDone: (v: string | null) => void
  readOnly?: boolean
}) {
  useLanguage()
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <Input
      ref={ref}
      className="inline-edit flex-1 min-w-0 p-[2px_6px] [font:inherit] bg-canvas [border-color:var(--line-strong)]"
      aria-label={t('Name')}
      maxLength={200}
      value={v}
      readOnly={readOnly}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (!readOnly) onDone(v.trim() || null)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (!readOnly && e.key === 'Enter') onDone(v.trim() || null)
        if (e.key === 'Escape') onDone(null)
      }}
    />
  )
}
