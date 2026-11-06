import { rankHosts } from '@ramu/shared/continuation'
import { useComputers } from '../../../workspace/computers'
import { useHostOverviews } from '../../../workspace/hostOverview'
import { useHost } from '../../../workspace/HostProvider'
import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import {
  AppWindow,
  Bot,
  ArrowUpRight,
  GitFork,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Search,
  ShieldQuestion,
} from 'lucide-react'
import type { AgentSessionState } from '@ramu/shared/types'
import { formatKeys } from '../../../commands'
import { CommitPushButton } from '../../../git/CommitPushButton'
import { Menu } from '../../../Menu'
import { SessionChangesButton } from '../../../Changes'
import { SessionCheckpointButton } from '../../../chat/SessionCheckpoint'
import { STATE_LABEL } from '../constants'
import { ThreadOriginChip } from './StartedThreads'
import { GHOST_TEXT_BUTTON_CLASS, ICON_BUTTON_CLASS } from '../styles'

/**
 * The toolbar above a chat: thread-level actions only (changes, checkpoint, state, Questions while any wait, Aside,
 * find and more). Live helpers and background work are in the composer tray, beside the message box.
 */
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
  readOnly = false,
  agentCount,
  onShowAgents,
  onFind,
  taskId,
  canContinue,
  continuing,
  onContinue,
  onContinueOnHost,
  onMakePage,
  latestRequest,
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
  readOnly?: boolean
  /** Every helper the thread has had; the live ones are in the composer tray. */
  agentCount: number
  onShowAgents: () => void
  onFind: () => void
  /** The chat's checkout, for Changes and Commit & push. */
  taskId?: string
  canContinue: boolean
  continuing: boolean
  onContinue: () => void
  onContinueOnHost: (hostId: string) => void
  /** Asks the agent to turn this thread's results into a page to keep. */
  onMakePage?: () => void
  /** The person's latest message, for suggesting a host whose platform it names. */
  latestRequest?: string
  /** Absent when this device may only view. */
}) {
  useLanguage()
  const host = useHost()
  const computers = useComputers()
  const connected = (computers?.computers ?? []).filter(
    (computer) => computer.id !== host.id && computer.status === 'connected',
  )
  const overviews = useHostOverviews(connected.map((computer) => computer.id))
  const otherHosts = rankHosts(
    connected.map((computer, index) => ({ ...computer, resources: overviews[index]?.data?.resources })),
    latestRequest ?? '',
  )
  const continueItems = [
    {
      key: 'continue',
      disabled: readOnly || continuing,
      label: (
        <>
          <GitFork size={13} /> {translate('Continue in new thread')}
        </>
      ),
      onSelect: onContinue,
    },
    ...otherHosts.map(({ host: computer, suggested, low }) => ({
      key: `continue:${computer.id}`,
      disabled: readOnly,
      label: (
        <>
          <ArrowUpRight size={13} /> {translate('Continue on {0}', { 0: computer.name })}
          {computer.resources?.platform && (
            <span className="text-muted-foreground">
              {' '}
              · {[computer.resources.platform, ...(computer.resources.testDevices ?? [])].join(', ')}
            </span>
          )}
          {suggested && <span className="text-muted-foreground"> · {translate('Suggested')}</span>}
          {low && <span className="text-warn"> · {translate('Low memory')}</span>}
        </>
      ),
      onSelect: () => onContinueOnHost(computer.id),
    })),
  ]
  return (
    <div className="agent-header [&_.path]:flex-1 [&:not(:has(>_:not(.grow)))]:hidden [&_.grow]:hidden [&_.state]:mr-auto [&_.small]:gap-1.5 [&_.small]:text-soft [&_>_*]:flex-none [&_>_*]:whitespace-nowrap flex items-center flex-none text-control min-w-0 justify-end h-auto min-h-[36px] p-[4px_10px_0] gap-1.5 flex-wrap gap-y-1 pb-1">
      {history}
      <SessionChangesButton sessionId={sessionId} taskId={taskId} />
      {taskId && !readOnly && <CommitPushButton taskId={taskId} />}
      <SessionCheckpointButton sessionId={sessionId} />
      <ThreadOriginChip taskId={taskId} />
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
        size="icon-xs"
        className={`${ICON_BUTTON_CLASS} asides-chip relative aria-pressed:bg-hover aria-pressed:text-foreground`}
        aria-pressed={asideOpen}
        aria-label={asideCount > 0 ? translate('Asides · {0}', { 0: asideCount }) : translate('Aside')}
        title={`${translate('Side questions about this thread')} (${formatKeys('mod+shift+a')})`}
        onClick={onToggleAside}
      >
        <MessageCircle size={14} />
        {asideCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 grid min-w-3.5 h-3.5 place-items-center rounded-full bg-fill px-0.5 text-[10px] leading-none tabular-nums text-foreground"
          >
            {asideCount}
          </span>
        )}
      </Button>
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
      {(canContinue || agentCount > 0) && (
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
            ...(agentCount > 0
              ? [
                  {
                    key: 'agents',
                    label: (
                      <>
                        <Bot size={13} /> {translate('All agents · {0}', { 0: agentCount })}
                      </>
                    ),
                    onSelect: onShowAgents,
                  },
                ]
              : []),
            ...(canContinue ? continueItems : []),
            ...(canContinue && onMakePage && !readOnly
              ? [
                  {
                    key: 'make-page',
                    label: (
                      <>
                        <AppWindow size={13} /> {translate('Make a page from this thread')}
                      </>
                    ),
                    onSelect: onMakePage,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  )
}
