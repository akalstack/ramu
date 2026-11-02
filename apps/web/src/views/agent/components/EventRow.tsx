import { ThreadsStartedCard } from './StartedThreads'
import { ThemeCard } from '../../../theme/ThemeCard'
import { InteractiveContent } from '../../../interactive/InteractiveContent'
import { t as translate, useLanguage } from '../../../i18n'
import { AgentContentView } from '../../../chat/AgentContentView'
import { compactionLabel, compactionCounts } from '@ramu/shared/chat/compaction'
import { Button } from '@/components/desktop-button'
import { ArrowRightLeft, CircleAlert, Minimize2, RotateCcw, Settings2, Undo2 } from 'lucide-react'
import type { Attachment, AgentEvent } from '@ramu/shared/types'
import { ScheduleChatCard } from '../../../Automation'
import { useHost } from '../../../workspace/HostProvider'
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
import { CONVERSATION_SEPARATOR_CLASS, GHOST_TEXT_BUTTON_CLASS, TURN_END_CLASS } from '../styles'
import { ErrorNote } from './ErrorNote'
import { handoffLine } from '../handoffLine'
import { canReviewAccess, omissionsLine } from '../setupOmissions'

const MCP_ATTENTION_LABELS = {
  'approval-needed': 'Approval needed',
  'sign-in-required': 'Sign-in required',
  unsupported: 'Unsupported',
  'not-checked': 'Not checked',
} as const

/** Renders one transcript event by kind: messages, separators, plans, permission and question cards, results and errors. */
export function EventRow({
  event: e,
  sessionId,
  taskId,
  live,
  generating = false,
  assistantActions = false,
  outcomes,
  questionStates,
  latest = false,
  editor,
  onEdit,
  onOpenAgent,
  onOpenQuestion,
  onReviewAccess,
}: {
  event: AgentEvent
  sessionId: string
  taskId?: string
  live: boolean
  generating?: boolean
  assistantActions?: boolean
  outcomes: Map<string, string>
  questionStates: Map<string, QuestionState>
  latest?: boolean
  editor?: React.ReactNode
  onEdit?: (text: string, attachments: Attachment[]) => void
  onOpenAgent?: (agentId: string) => void
  onOpenQuestion?: (requestId: string) => void
  /** Opens the thread's MCP access dialog from a switch notice. */
  onReviewAccess?: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  switch (e.kind) {
    case 'recovery':
      return (
        <div className={CONVERSATION_SEPARATOR_CLASS} role="status">
          <span className="inline-flex items-center gap-2">
            <RotateCcw size={14} aria-hidden="true" />
            {translate('Resumed after restart')}
          </span>
          {omissionsLine(e.setupOmissions, 'resume') && <small>{omissionsLine(e.setupOmissions, 'resume')}</small>}
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
          <span className="h-px min-w-4 flex-1 bg-line" aria-hidden="true" />
          <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
            <Minimize2 size={14} className="flex-none" aria-hidden="true" />
            {e.state === 'completed' ? translate('Context compacted') : compactionLabel(e)}
            {e.state === 'completed' && (
              <span
                className="text-caption tabular-nums"
                title={counts.window ? translate('Context window: {0} tokens', { '0': counts.window }) : undefined}
              >
                {translate('{0} → {1} tokens', {
                  '0': counts.before === 'Not reported' ? translate('Not reported') : counts.before,
                  '1': counts.after === 'Not reported' ? translate('Not reported') : counts.after,
                })}
              </span>
            )}
            {e.state === 'completed' && counts.window && (
              <span className="text-caption tabular-nums">
                · {translate('Context window: {0} tokens', { '0': counts.window })}
              </span>
            )}
          </span>
          <span className="h-px min-w-4 flex-1 bg-line" aria-hidden="true" />
        </div>
      )
    }
    case 'schedule':
      return <ScheduleChatCard schedule={e.schedule} />
    case 'threads-started':
      return <ThreadsStartedCard threads={e.threads} />
    case 'settings':
      return (
        <div className={CONVERSATION_SEPARATOR_CLASS}>
          <span className="min-w-0">
            <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1">
              {e.handoff ? (
                <ArrowRightLeft size={14} className="flex-none" aria-hidden="true" />
              ) : (
                <Settings2 size={14} className="flex-none" aria-hidden="true" />
              )}
              {translate(e.handoff ? 'Context handoff' : 'Settings changed')}
              <SettingsChange next={e.settings} previous={e.previous} />
              {e.previous && live && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={`${GHOST_TEXT_BUTTON_CLASS} separator-action size-[22px] min-h-[22px] p-0 text-soft`}
                  title={translate('Go back to the previous model and settings')}
                  onClick={() =>
                    void invoke('agent.configure', sessionId, e.previous!).catch((error) =>
                      notifyError(errorText(error), 'Model'),
                    )
                  }
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  <span className="sr-only">
                    <SwitchBackLabel previous={e.previous} />
                  </span>
                </Button>
              )}
            </span>
            {e.reason && e.reason !== 'Changed conversation settings' && <small>{e.reason}</small>}
            {e.handoff && handoffLine(e.handoffInfo, translate) && (
              <small>{handoffLine(e.handoffInfo, translate)}</small>
            )}
            {e.mcpAttention && e.mcpAttention.length > 0 && (
              <small role="status">
                {translate('Shared MCP is not ready on this login: {servers}.', {
                  servers: e.mcpAttention
                    .map((entry) => `${entry.name} (${translate(MCP_ATTENTION_LABELS[entry.status])})`)
                    .join(', '),
                })}{' '}
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0 align-baseline"
                  onClick={() => window.dispatchEvent(new Event('ramu:mcp-status'))}
                >
                  {translate('Review access')}
                </Button>
              </small>
            )}
            {omissionsLine(e.setupOmissions) && (
              <small role="status">
                {omissionsLine(e.setupOmissions)}
                {onReviewAccess && canReviewAccess(e.setupOmissions) && (
                  <>
                    {' '}
                    <Button variant="link" size="xs" className="h-auto p-0 align-baseline" onClick={onReviewAccess}>
                      {translate('Review access')}
                    </Button>
                  </>
                )}
              </small>
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
          actions={assistantActions}
          latest={latest}
          taskId={taskId}
          sessionId={sessionId}
        />
      )
    case 'turn-diff':
      return <TurnDiff diff={e.diff} />
    case 'thinking':
      return <ThinkingRow text={e.text} active={generating} />
    case 'interactive':
      return <InteractiveContent key={`${e.reference.id}:${e.reference.version}`} reference={e.reference} />
    case 'theme':
      return <ThemeCard theme={e.theme} />
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
    case 'permission-request': {
      const outcome = outcomes.get(e.requestId)
      if (outcome && (outcome.startsWith('allowed') || outcome === 'approved' || outcome === 'allow')) return null
      return (
        <PermissionRequestCard
          event={e}
          sessionId={sessionId}
          pending={live && !outcomes.has(e.requestId)}
          outcome={outcome}
        />
      )
    }
    case 'question':
      return (
        <QuestionRow
          request={e}
          status={questionStates.get(e.requestId) ?? { answers: {}, drafts: {}, waiting: false }}
          pending={(e.responseMode === 'message' || live) && !outcomes.has(e.requestId)}
          onOpen={onOpenQuestion}
        />
      )
    case 'result':
      return e.isError ? (
        <div className={`${TURN_END_CLASS} error text-bad`}>
          <CircleAlert size={13} />
          {translate('Agent failed')}
        </div>
      ) : null
    case 'background-terminal-stop':
      return (
        <div className={TURN_END_CLASS} role="status">
          {translate('You requested a stop for {0}', { 0: e.command })}
        </div>
      )
    case 'file-restore':
      return (
        <div className={TURN_END_CLASS} role="status">
          <Undo2 size={14} aria-hidden="true" />
          {translate('Restored {0} files · message {1} onward', {
            '0': e.fileCount,
            '1': e.userSeq,
          })}
        </div>
      )
    case 'error':
      return <ErrorNote message={e.message} />
    default:
      return null
  }
}
