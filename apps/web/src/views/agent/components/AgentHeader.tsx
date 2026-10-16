import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { Bot, GitFork, LoaderCircle, MessageCircle, MoreHorizontal, Search, ShieldQuestion, Square } from 'lucide-react'
import type { AgentSessionState, AgentTask } from '@ramu/shared/types'
import { formatKeys } from '../../../commands'
import { CommitPushButton } from '../../../git/CommitPushButton'
import { Menu } from '../../../Menu'
import { SessionChangesButton } from '../../../Changes'
import { SessionCheckpointButton } from '../../../chat/SessionCheckpoint'
import { STATE_LABEL } from '../constants'
import { GHOST_TEXT_BUTTON_CLASS, ICON_BUTTON_CLASS } from '../styles'

/** The toolbar above a chat: changes, checkpoint and state, then the Questions, Aside, background command and Agents chips, find and more actions. */
export function AgentHeader({
  history,
  sessionId,
  state,
  pendingQuestionCount,
  showQuestions,
  onToggleQuestions,
  asideOpen,
  asideCount,
  onToggleAside,
  commands,
  onStopTask,
  tasks,
  runningTasks,
  agentsOpen,
  onToggleAgents,
  onFind,
  taskId,
  canContinue,
  continuing,
  onContinue,
}: {
  history?: React.ReactNode
  sessionId: string
  state: AgentSessionState | undefined
  pendingQuestionCount: number
  showQuestions: boolean
  onToggleQuestions: () => void
  asideOpen: boolean
  asideCount: number
  onToggleAside: () => void
  commands: AgentTask[]
  onStopTask: (task: AgentTask) => void
  tasks: AgentTask[]
  runningTasks: AgentTask[]
  agentsOpen: boolean
  onToggleAgents: () => void
  onFind: () => void
  /** The chat's checkout, for Changes and Commit & push. */
  taskId?: string
  canContinue: boolean
  continuing: boolean
  onContinue: () => void
}) {
  useLanguage()
  return (
    <div className="agent-header [&_.path]:flex-1 [&:not(:has(>_:not(.grow)))]:hidden [&_.grow]:hidden [&_.state]:mr-auto [&_.small]:gap-1.5 [&_.small]:text-soft [&_>_*]:flex-none [&_>_*]:whitespace-nowrap flex items-center flex-none text-control min-w-0 justify-end h-auto min-h-[36px] p-[4px_10px_0] gap-1.5 flex-wrap gap-y-1 pb-1">
      {history}
      <SessionChangesButton sessionId={sessionId} taskId={taskId} />
      {taskId && <CommitPushButton taskId={taskId} />}
      <SessionCheckpointButton sessionId={sessionId} />
      {state && STATE_LABEL[state] && (
        <span
          className={`state [&.running]:text-brand [&.starting]:text-brand [&.needs-input]:text-warn [&.failed]:text-bad [&::before]:[content:''] [&::before]:w-1.5 [&::before]:h-1.5 [&::before]:rounded-full [&::before]:[background:var(--muted)] [&.idle::before]:[background:var(--ok)] [&.running::before]:[background:var(--accent)] [&.running::before]:[animation:pulse_1.6s_ease-in-out_infinite] [&.starting::before]:[background:var(--accent)] [&.starting::before]:[animation:pulse_1.6s_ease-in-out_infinite] [&.needs-input::before]:[background:var(--warn)] [&.failed::before]:[background:var(--bad)] [&:empty]:hidden tabular-nums text-muted-foreground whitespace-nowrap inline-flex items-center gap-1.5 p-[2px_9px_2px_8px] rounded-full bg-hover text-caption ${state}`}
        >
          {STATE_LABEL[state]}
        </span>
      )}
      <span className="grow flex-1 min-w-0 text-left" />
      {pendingQuestionCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={GHOST_TEXT_BUTTON_CLASS}
          aria-pressed={showQuestions}
          onClick={onToggleQuestions}
        >
          <ShieldQuestion size={14} />
          {translate('Questions · ')}
          {pendingQuestionCount}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={`${GHOST_TEXT_BUTTON_CLASS} asides-chip gap-1.5 text-soft`}
        aria-pressed={asideOpen}
        title={`${translate('Side questions about this chat')} (${formatKeys('mod+shift+a')})`}
        onClick={onToggleAside}
      >
        <MessageCircle size={13} />
        {asideCount > 0 ? `${translate('Aside')} · ${asideCount}` : translate('Aside')}
      </Button>
      {commands.length > 0 && (
        <Menu
          label={translate('Background commands')}
          icon={
            <>
              <LoaderCircle size={13} className="spin [animation:spin_0.9s_linear_infinite]" />
              {translate('{0} background {1}', {
                '0': commands.length,
                '1': commands.length === 1 ? 'command' : 'commands',
              })}
            </>
          }
          className={`${GHOST_TEXT_BUTTON_CLASS} agents-chip [&.running]:text-foreground [&.running]:bg-hover gap-1.5 text-soft running`}
          align="end"
          items={commands.map((task) => ({
            key: task.agentId,
            label: (
              <>
                <Square size={12} /> {translate('Stop')} · {task.name}
              </>
            ),
            onSelect: () => onStopTask(task),
          }))}
        />
      )}
      {tasks.length > 0 && (
        <Button
          variant="secondary"
          className={`${GHOST_TEXT_BUTTON_CLASS} agents-chip [&.running]:text-foreground [&.running]:bg-hover gap-1.5 text-soft${runningTasks.length ? ' running' : ''}`}
          aria-pressed={agentsOpen}
          title={
            runningTasks.length
              ? translate('Sub-agents still working; they can keep going after the turn ends')
              : translate('Sub-agents in this chat')
          }
          onClick={onToggleAgents}
        >
          {runningTasks.length ? (
            <LoaderCircle size={13} className="spin [animation:spin_0.9s_linear_infinite]" />
          ) : (
            <Bot size={14} />
          )}
          {runningTasks.length
            ? translate('{0} {1} running', {
                '0': runningTasks.length,
                '1': runningTasks.length === 1 ? 'agent' : 'agents',
              })
            : translate('Agents · {0}', { '0': tasks.length })}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON_CLASS}
        aria-label={translate('Find in conversation')}
        title={translate('Find in conversation ({0})', { '0': formatKeys('mod+f') })}
        onClick={onFind}
      >
        <Search size={14} />
      </Button>
      {canContinue && (
        <Menu
          label={translate('More actions')}
          icon={
            continuing ? (
              <LoaderCircle size={14} className="spin [animation:spin_0.9s_linear_infinite]" />
            ) : (
              <MoreHorizontal size={14} />
            )
          }
          className={ICON_BUTTON_CLASS}
          align="end"
          items={[
            {
              key: 'continue',
              label: (
                <>
                  <GitFork size={13} /> {translate('Continue in new chat')}
                </>
              ),
              onSelect: onContinue,
            },
          ]}
        />
      )}
    </div>
  )
}
