import { useEffect, useState } from 'react'
import { elapsedText, type AgentStep } from '@ramu/shared/chat/agentActivity'
import { t, useLanguage } from '../i18n'
import { WorkingText } from '../views/agent/components/WorkingText'

/**
 * The turn's live status, docked above the composer so it never scrolls away: what the agent is doing (the running
 * command or file) and how long the turn has run. The transcript's "Worked for …" divider takes over when it ends.
 */
export function WorkingLine({
  running,
  step,
  since,
}: {
  running: boolean
  step: AgentStep | null
  since: number | null
}) {
  useLanguage()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running || !since) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, since])
  if (!running) return null
  const current = step ?? { label: 'Working' }
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mb-1.5 flex w-fit max-w-full items-center gap-2 rounded-full bg-fill px-3 py-1 text-caption"
    >
      <span aria-hidden className="size-1.5 flex-none animate-pulse rounded-full bg-brand" />
      <WorkingText>{t(current.label)}</WorkingText>
      {current.detail && <code className="min-w-0 truncate text-caption text-foreground">{current.detail}</code>}
      {since ? <span className="flex-none tabular-nums text-muted-foreground">{elapsedText(now - since)}</span> : null}
    </div>
  )
}
