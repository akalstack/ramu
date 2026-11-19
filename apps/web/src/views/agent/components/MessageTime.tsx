import { useLanguage, formatLocale } from '../../../i18n'
import { memo } from 'react'
import { timeFormat } from '../lib/format'

/** The time a message was sent; the title has the full date. */
export const MessageTime = memo(function MessageTime({ at }: { at?: number }) {
  useLanguage()
  if (!at) return null
  const date = new Date(at),
    formats = timeFormat(formatLocale())
  return (
    <time
      className="msg-time text-muted-foreground tabular-nums text-caption leading-[24px] p-[0_4px]"
      dateTime={date.toISOString()}
      title={formats.full.format(date)}
    >
      {formats.time.format(date)}
    </time>
  )
})
