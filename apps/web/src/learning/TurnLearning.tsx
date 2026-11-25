import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { learningLine, reviewForTurn } from '@ramu/shared/learningReviews'
import type { AgentEvent } from '@ramu/shared/types'
import type { ChatBlock } from '@ramu/shared/chat/chatFolding'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useLearningSnapshot } from './learningQueries'
import { LearningReviewActions } from './LearningReviewActions'
import { learningLineText, undoKeptText } from './learningText'

/** The event seq of the result that ended a turn, which is what a learning review records as its turn. */
function endingResultSeq(items: ChatBlock[], sequences: Map<AgentEvent, number>): number | undefined {
  const result = items.findLast(
    (block) => block.kind === 'event' && block.event.kind === 'result' && !block.event.agentId,
  )
  return result?.kind === 'event' ? sequences.get(result.event) : undefined
}

/**
 * One quiet line under the turn a learning review learned from: what it saved or would save, and what to do about it.
 * Nothing shows for a turn no review learned from, or while its review is still running.
 */
export function TurnLearning({
  sessionId,
  items,
  sequences,
  readOnly,
}: {
  sessionId: string
  items: ChatBlock[]
  sequences: Map<AgentEvent, number>
  readOnly?: boolean
}) {
  useLanguage()
  const { id: host } = useHost()
  const seq = endingResultSeq(items, sequences)
  const jobs = useLearningSnapshot(host, seq !== undefined)?.jobs
  const [kept, setKept] = useState<{ job: string; count: number } | null>(null)
  const job = jobs && seq !== undefined ? reviewForTurn(jobs, sessionId, seq) : undefined
  const line = job ? learningLine(job) : null
  if (!job || !line) return null
  return (
    <div
      role="group"
      className="turn-learning flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground"
      aria-label={t('What Ramu learned')}
    >
      <Sparkles size={12} className="flex-none" aria-hidden />
      <span className={line.state === 'undone' ? 'opacity-70' : undefined}>{learningLineText(line)}</span>
      {line.state === 'undone' && kept?.job === job.id && kept.count > 0 && (
        <span role="status">{undoKeptText(kept.count)}</span>
      )}
      {line.state !== 'undone' && (
        <LearningReviewActions
          host={host}
          job={job}
          line={line}
          readOnly={readOnly}
          className="text-caption text-muted-foreground hover:text-foreground"
          onUndone={(count) => setKept({ job: job.id, count })}
        />
      )}
    </div>
  )
}
