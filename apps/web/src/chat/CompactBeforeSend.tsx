import { useEffect, useState } from 'react'
import { History, Minimize2 } from 'lucide-react'
import { compactBeforeSend, compactBeforeSendFrom, contextTokensShort } from '@ramu/shared/chat/compaction'
import type { AgentProvider, ContextUsage } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'

/** The longest delay a browser timer takes; a later expiry is looked at again when this one fires. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * The tokens an idle Claude thread would re-read in full with its next message, once its prompt cache has expired, or
 * null while compacting first would save nothing. Re-checks on its own when the cache runs out with the thread open.
 */
export function useCompactOffer(provider: AgentProvider | undefined, idle: boolean, context: ContextUsage | null) {
  const [now, setNow] = useState(() => Date.now())
  const from = provider ? compactBeforeSendFrom(provider, context) : null
  useEffect(() => {
    if (from === null || now >= from) return
    const wait = from - Date.now()
    if (wait <= 0) {
      setNow(Date.now())
      return
    }
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait, MAX_TIMER_MS))
    return () => window.clearTimeout(timer)
  }, [from, now])
  return provider ? compactBeforeSend({ provider, idle, context, now }) : null
}

/**
 * Beside Send: compact the history first (pressed) or keep it. The label says what the next message does; the tooltip
 * says why it matters now.
 */
export function CompactBeforeSendToggle({
  tokens,
  compact,
  disabled,
  onChange,
}: {
  tokens: number
  compact: boolean
  disabled?: boolean
  onChange: (compact: boolean) => void
}) {
  const size = contextTokensShort(tokens)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-control text-muted-foreground tabular-nums aria-pressed:bg-fill aria-pressed:text-foreground"
      aria-pressed={compact}
      aria-label={t('Compact {0} tokens of history before sending', { 0: size })}
      title={
        compact
          ? t(
              'This thread has been idle past its prompt cache, so the next message re-reads all {0} tokens. Compacting summarizes them first, and later replies read less. Click to keep the full history.',
              { 0: size },
            )
          : t('The next message re-reads all {0} tokens of history. Click to compact them first.', { 0: size })
      }
      disabled={disabled}
      onClick={() => onChange(!compact)}
    >
      {compact ? <Minimize2 size={13} aria-hidden="true" /> : <History size={13} aria-hidden="true" />}
      {compact ? t('Compact · {0}', { 0: size }) : t('Keep · {0}', { 0: size })}
    </Button>
  )
}
