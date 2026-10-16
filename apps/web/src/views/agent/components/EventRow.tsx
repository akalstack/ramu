import { t as translate, useLanguage } from '../../../i18n'
import { AgentContentView } from '../../../chat/AgentContentView'
import { compactionLabel, compactionCounts } from '@ramu/shared/chat/compaction'
import { Button } from '@/components/desktop-button'
import { CircleAlert, Minimize2 } from 'lucide-react'
import type { Attachment, AgentEvent } from '@ramu/shared/types'
import { ScheduleChatCard } from '../../../Automation'
import { invoke } from '../../../ipc'
import { errorText } from '../../../workspace/TaskPane'
import { ElicitationCard } from '../../../chat/ElicitationCard'
import { QuestionRow } from '../../../chat/QuestionCard'
import { questionState, type QuestionState } from '@ramu/shared/chat/questions'
import { notifyError } from '../../../chat/Notifications'
import { SettingsChange, SwitchBackLabel } from './SettingsChange'
import { AssistantText } from './AssistantText'
import { TurnDiff } from './TurnDiff'
import { ThinkingRow } from './ThinkingRow'
import { UserMessage } from './UserMessage'
import { PlanCard } from './PlanCard'
import { PermissionRequestCard } from './PermissionRequestCard'
import { CONVERSATION_SEPARATOR_CLASS, GHOST_TEXT_BUTTON_CLASS, MSG_CLASS, TURN_END_CLASS } from '../styles'

/** Renders one transcript event by kind: messages, separators, plans, permission and question cards, results and errors. */
export function EventRow({
  event: e,
  sessionId,
  taskId,
  live,
  generating = false,
  outcomes,
  questionStates,
  actions = false,
  latest = false,
  editor,
  onEdit,
  onOpenAgent,
  onOpenQuestion,
}: {
  event: AgentEvent
  sessionId: string
  taskId?: string
  live: boolean
  generating?: boolean
  outcomes: Map<string, string>
  questionStates: Map<string, QuestionState>
  actions?: boolean
  latest?: boolean
  editor?: React.ReactNode
  onEdit?: (text: string, attachments: Attachment[]) => void
  onOpenAgent?: (agentId: string) => void
  onOpenQuestion?: (requestId: string) => void
}) {
  useLanguage()
  switch (e.kind) {
    case 'recovery':
      return (
        <div className={CONVERSATION_SEPARATOR_CLASS} role="status">
          <span>{translate('Continued after restart')}</span>
        </div>
      )
    case 'compaction': {
      if (e.state === 'started') return null
      const counts = compactionCounts(e)
      return (
        <div
          className="compaction-separator my-4 flex items-center gap-3 text-control text-muted-foreground"
          role="status"
        >
          <span className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
          <div className="flex min-w-0 flex-col items-center gap-1 text-center">
            <span className="inline-flex items-center gap-2">
              <Minimize2 size={14} aria-hidden="true" />
              {compactionLabel(e)}
            </span>
            {e.state === 'completed' && (
              <span className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-caption tabular-nums">
                <span>
                  {counts.before === 'Not reported'
                    ? translate('Before: Not reported')
                    : translate('Before: {0} tokens', { '0': counts.before })}
                </span>
                <span>
                  {counts.after === 'Not reported'
                    ? translate('After: Not reported')
                    : translate('After: {0} tokens', { '0': counts.after })}
                </span>
                {counts.window && <span>{translate('Context window: {0} tokens', { '0': counts.window })}</span>}
              </span>
            )}
          </div>
          <span className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
        </div>
      )
    }
    case 'schedule':
      return <ScheduleChatCard schedule={e.schedule} />
    case 'settings':
      return (
        <div className={CONVERSATION_SEPARATOR_CLASS}>
          <span>
            <SettingsChange next={e.settings} previous={e.previous} />
            <small>
              {e.reason}
              {e.handoff ? ' · Conversation context handed over' : ''}
            </small>
            {e.previous && live && (
              <Button
                variant="ghost"
                size="sm"
                className={`${GHOST_TEXT_BUTTON_CLASS} separator-action ml-2 h-[22px] min-h-[22px] p-[0_8px] text-soft`}
                title={translate('Go back to the previous model and settings')}
                onClick={() =>
                  void invoke('agent.configure', sessionId, e.previous!).catch((error) =>
                    notifyError(errorText(error), 'Model'),
                  )
                }
              >
                <SwitchBackLabel previous={e.previous} />
              </Button>
            )}
          </span>
        </div>
      )
    case 'user':
      return (
        <UserMessage
          event={e}
          taskId={taskId}
          latest={latest}
          editor={editor}
          onEdit={onEdit}
          onOpenAgent={onOpenAgent}
        />
      )
    case 'text':
      return (
        <AssistantText
          event={e}
          generating={generating}
          actions={actions}
          taskId={taskId}
          sessionId={sessionId}
        />
      )
    case 'turn-diff':
      return <TurnDiff diff={e.diff} />
    case 'thinking':
      return <ThinkingRow text={e.text} active={generating} />
    case 'content':
      return <AgentContentView content={e.content} taskId={taskId} />
    case 'plan':
      return <PlanCard entries={e.entries} />
    case 'elicitation':
      return (
        <ElicitationCard
          sessionId={sessionId}
          request={e}
          status={questionStates.get(e.requestId) ?? questionState([], e.requestId)}
          pending={live && !outcomes.has(e.requestId)}
        />
      )
    case 'permission-request':
      return (
        <PermissionRequestCard
          event={e}
          sessionId={sessionId}
          pending={live && !outcomes.has(e.requestId)}
          outcome={outcomes.get(e.requestId)}
        />
      )
    case 'question':
      return (
        <QuestionRow
          request={e}
          status={questionStates.get(e.requestId) ?? { answers: {}, drafts: {}, waiting: false }}
          showAnswers={e.responseMode !== 'message' || questionStates.get(e.requestId)?.outcome !== 'answered'}
          pending={(e.responseMode === 'message' || live) && !outcomes.has(e.requestId)}
          onOpen={onOpenQuestion}
        />
      )
    case 'result':
      return e.isError ? (
        <div className={`${TURN_END_CLASS} error text-bad`}>
          <CircleAlert size={13} />
          {translate('The agent reported a failure.')}
        </div>
      ) : null
    case 'file-restore':
      return (
        <div className={TURN_END_CLASS} role="status">
          {translate('Restored {0} files from message {1} and later captured runs.', {
            '0': e.fileCount,
            '1': e.userSeq,
          })}
        </div>
      )
    case 'error':
      return <div className={`${MSG_CLASS} error text-bad`}>{e.message}</div>
    default:
      return null
  }
}
