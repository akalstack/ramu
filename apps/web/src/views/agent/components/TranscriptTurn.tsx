import { t as translate, useLanguage, currentLanguage, formatLocale } from '../../../i18n'
import { foldChatTurn as foldTurn, type ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import { formatChatDate } from '@ramu/shared/chat/chatDates'
import type { ChatGoal } from '@ramu/shared/types'
import { GoalDone, GoalNote } from '../../../chat/GoalBar'
import { TurnChanges } from '../../../Changes'
import { agentOf, blockAt, blockIndex, groupAgentRuns, relativize } from '../lib/blocks'
import { formatDuration } from '../lib/format'
import type { Turn, TranscriptContext } from '../types'
import { AdvisorActivity } from './AdvisorActivity'
import { AgentGroup } from './AgentGroup'
import { AgentTaskCard } from './AgentTaskCard'
import { EventRow } from './EventRow'
import { InlineMessageEdit } from './InlineMessageEdit'
import { ToolGroup } from './ToolGroup'
import { TurnSummary } from './TurnSummary'

type TurnReview = React.ComponentProps<typeof TurnChanges>['review']

/** One block of the transcript, wrapped in the element that carries its `data-block-index`. */
function TranscriptBlock({
  block: b,
  ctx,
  turn,
  finished,
  actions = false,
  latest = false,
}: {
  block: Block
  ctx: TranscriptContext
  turn: Turn
  /** The turn is done, so its tool rows no longer show live activity. */
  finished: boolean
  actions?: boolean
  latest?: boolean
}) {
  const index = blockIndex(b, ctx.blocks)
  const { editing } = ctx
  return (
    <div data-block-index={index}>
      {b.kind === 'tools' ? (
        <ToolGroup
          tools={b.tools}
          results={ctx.results}
          cwd={ctx.cwd}
          active={ctx.busyAgent && !finished}
          activity={b === ctx.statusGroup ? translate(ctx.activityLabel ?? 'Working') : undefined}
          taskId={ctx.taskId}
          onBackground={ctx.onBackground}
        />
      ) : b.event.kind === 'goal' ? (
        ctx.goalNotes.has(b.event) ? (
          <GoalNote change={ctx.goalNotes.get(b.event)!} />
        ) : null
      ) : b.event.kind === 'agent' ? (
        b.event.taskType === 'advisor' ? (
          <AdvisorActivity
            task={b.event}
            live={ctx.live}
            onOpen={() => ctx.onOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)}
          />
        ) : (
          <AgentTaskCard
            task={b.event}
            live={ctx.live}
            onOpen={() => ctx.onOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)}
            onStop={ctx.onStopTask}
          />
        )
      ) : (
        <EventRow
          event={relativize(b.event, ctx.cwd)}
          taskId={ctx.taskId}
          sessionId={ctx.sessionId}
          live={ctx.live}
          generating={
            ctx.working && (b.event === ctx.liveText || (b.event.kind === 'thinking' && b === turn.items.at(-1)))
          }
          outcomes={ctx.outcomes}
          questionStates={ctx.questionStates}
          actions={actions}
          latest={latest}
          editor={
            editing && ctx.eventSequences.get(b.event) === editing.seq ? (
              <InlineMessageEdit
                key={editing.seq}
                original={editing.text}
                files={editing.files}
                sessionId={ctx.sessionId}
                seq={editing.seq}
                busy={ctx.configuring}
                offlineHost={ctx.offlineHost}
                onCancel={ctx.onCancelEdit}
                onSubmit={ctx.onSubmitEdit}
              />
            ) : undefined
          }
          onEdit={
            ctx.eventSequences.has(b.event)
              ? (text, files) => ctx.onEditMessage(text, files, ctx.eventSequences.get(b.event))
              : undefined
          }
          onOpenAgent={ctx.onOpenAgent}
          onOpenQuestion={ctx.onOpenQuestion}
        />
      )}
    </div>
  )
}

/**
 * One turn of the transcript: an optional day separator, the user's message, the work the agent did (folded into
 * "Worked for 35s" once it is done), its answer, and the file changes and goals that belong to the turn.
 */
export function TranscriptTurn({
  turn,
  isLast,
  dateSeparator,
  dateNow,
  reviews,
  completedGoals,
  ctx,
}: {
  turn: Turn
  isLast: boolean
  /** When set, a day separator for this time is drawn above the turn. */
  dateSeparator: number | undefined
  dateNow: number
  reviews: TurnReview[] | undefined
  completedGoals: ChatGoal[] | undefined
  ctx: TranscriptContext
}) {
  useLanguage()
  const { blocks, working, needsInput } = ctx
  // A turn is done when the agent reported a result, a later message exists, or nothing is running any more.
  const finished = turn.ended || !isLast || (!working && !needsInput)
  const { folded, kept, answer } = finished
    ? foldTurn(turn.items, ctx.outcomes, ctx.results)
    : { folded: [] as Block[], kept: turn.items, answer: [] as Block[] }
  const renderBlock = (b: Block, actions = false, latest = false) => (
    <TranscriptBlock
      key={blockIndex(b, blocks)}
      block={b}
      ctx={ctx}
      turn={turn}
      finished={finished}
      actions={actions}
      latest={latest}
    />
  )
  // Several sub-agents in a row read as one line with a summary, expanding to their cards.
  const renderList = (list: Block[]) =>
    groupAgentRuns(list).map((item) =>
      Array.isArray(item) ? (
        <div key={blockIndex(item[0]!, blocks)} data-block-index={blockIndex(item[0]!, blocks)}>
          <AgentGroup tasks={item.map(agentOf)} live={ctx.live} onOpen={ctx.onOpenAgent} onStop={ctx.onStopTask} />
        </div>
      ) : (
        renderBlock(item)
      ),
    )
  const startedAt = turn.startedAt ?? (folded[0] ? blockAt(folded[0]) : undefined)
  const endedAt =
    turn.endedAt ?? (finished || needsInput ? turn.items.map(blockAt).findLast((at) => at !== undefined) : undefined)
  const duration = startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined
  const { elapsed } = ctx
  return (
    <div className="turn [&_>_[data-block-index]:has(.msg.user)]:flex [&_>_[data-block-index]:has(.msg.user)]:justify-end flex flex-col gap-3.5 min-w-0">
      {dateSeparator !== undefined && (
        <time
          className="chat-date [.turn:first-child_&]:mt-1 block self-center w-full m-[18px_0_24px] text-center text-muted-foreground text-control font-normal leading-[1.5]"
          dateTime={new Date(dateSeparator).toISOString()}
          title={new Date(dateSeparator).toLocaleString(formatLocale())}
        >
          {formatChatDate(dateSeparator, dateNow, currentLanguage())}
        </time>
      )}
      {turn.user && renderBlock(turn.user, false, isLast && !answer.length && !kept.length && !folded.length)}
      {((!finished && isLast && (working || needsInput)) ||
        (finished && (!turn.ended || turn.interrupted) && !folded.length)) && (
        <div className="turn-working text-muted-foreground tabular-nums" role="status">
          <span>
            {(elapsed ?? duration) !== null && (elapsed ?? duration) !== undefined
              ? translate('Working for {0}', { '0': formatDuration((elapsed ?? duration)!) })
              : translate('Working')}
          </span>
        </div>
      )}
      {folded.length > 0 && (
        <TurnSummary
          label={
            duration !== undefined
              ? translate(
                  turn.ended && !turn.interrupted && !(isLast && ctx.stopped) ? 'Worked for {0}' : 'Working for {0}',
                  { '0': formatDuration(duration) },
                )
              : translate(turn.ended && !turn.interrupted && !(isLast && ctx.stopped) ? 'Worked' : 'Working')
          }
          sourceIndex={ctx.hasSourceSeq ? blockIndex(folded[0]!, blocks) : undefined}
        >
          {renderList(folded)}
        </TurnSummary>
      )}
      {renderList(kept)}
      {answer.map((b) => renderBlock(b, finished && b === ctx.latestAssistant, b === ctx.latestAssistant))}
      {reviews?.map((review) => (
        <TurnChanges key={review.id} review={review} />
      ))}
      {completedGoals?.map((done) => (
        <GoalDone key={done.id} goal={done} />
      ))}
    </div>
  )
}
