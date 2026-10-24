import type { ChatGoal } from '@ramu/shared/types'
import { goalFacts } from '@ramu/shared/chat/goalHistory'
import { t, useLanguage } from '../i18n'
import { checkOutcomeCopy } from './goalLabels'

const FILES_SHOWN = 8
const code = 'font-mono text-caption [overflow-wrap:anywhere] select-text'

/**
 * What a goal knows beyond its objective: the verification command and its latest result (a failure shows the command,
 * how it ended and the end of its output), and the evidence the agent gave for completion.
 */
export function GoalFacts({ goal }: { goal: ChatGoal }) {
  useLanguage()
  const { verify, check, evidence } = goalFacts(goal)
  if (!verify && !check && !evidence) return null
  const files = evidence?.changedFiles ?? []
  return (
    <div className="goal-facts flex flex-col gap-1.5 text-caption text-soft">
      {verify && (
        <p className="goal-verify m-0 [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">{t('Verification')}</span> <code className={code}>{verify}</code>
        </p>
      )}
      {check &&
        (check.ok ? (
          <p className="goal-check m-0 [overflow-wrap:anywhere]">
            <span className="text-ok">{t('Verified')}</span> <code className={code}>{check.command}</code>
          </p>
        ) : (
          <div className="goal-check goal-check-failed flex flex-col gap-1">
            <p className="m-0 [overflow-wrap:anywhere]">
              <span className="text-warn">{t('Verification failed')}</span> · {t(...checkOutcomeCopy(check.outcome))}
              {' · '}
              <code className={code}>{check.command}</code>
            </p>
            {check.tail && (
              <pre className="goal-check-output m-0 max-h-40 overflow-auto whitespace-pre-wrap rounded-(--radius-s) bg-fill p-1.5 font-mono text-caption select-text [overflow-wrap:anywhere]">
                {check.tail}
              </pre>
            )}
          </div>
        ))}
      {evidence && evidence.checks.length > 0 && (
        <div className="goal-evidence-checks flex flex-col gap-0.5">
          <span className="text-muted-foreground">{t('Checks')}</span>
          {evidence.checks.map((item, index) => (
            <span key={index} className={`[overflow-wrap:anywhere] ${item.passed ? '' : 'text-warn'}`}>
              {item.passed ? '✓' : '✗'} {item.name}
            </span>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="goal-evidence-files flex flex-col gap-0.5">
          <span className="text-muted-foreground">{t('Changed files')}</span>
          <code className={code}>{files.slice(0, FILES_SHOWN).join(', ')}</code>
          {files.length > FILES_SHOWN && (
            <span className="text-muted-foreground">{t('+{0} more', { '0': files.length - FILES_SHOWN })}</span>
          )}
        </div>
      )}
    </div>
  )
}
