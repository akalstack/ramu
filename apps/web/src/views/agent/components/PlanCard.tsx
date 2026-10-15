import { t as translate, useLanguage } from '../../../i18n'
import { BookOpen } from 'lucide-react'
import type { AgentEvent } from '@ramu/shared/types'

/** The agent's plan as a checklist; finished steps are struck through. */
export function PlanCard({ entries }: { entries: Extract<AgentEvent, { kind: 'plan' }>['entries'] }) {
  useLanguage()
  return (
    <div className="agent-plan space-y-2 text-control">
      <span className="inline-flex gap-2 items-center font-medium text-soft">
        <BookOpen size={14} />
        {translate('Plan')}
      </span>
      <ol className="m-0 pl-5 space-y-2">
        {entries.map((entry, i) => (
          <li key={i} className={entry.status === 'completed' ? 'text-muted-foreground line-through' : 'text-soft'}>
            <span>{entry.content}</span>
            <span className="ml-2 text-caption text-muted-foreground">
              {translate(
                entry.status === 'in_progress' ? 'In progress' : entry.status === 'completed' ? 'Completed' : 'Pending',
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
