import { t as translate, useLanguage, currentLanguage, formatLocale } from '../../../i18n'
import { type ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
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
import { ToolGroup } from './ToolGroup'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { TurnSummary } from './TurnSummary'
import { turnThinking } from '../lib/turnThinking'
import { groupToolThinking, type ToolEntry } from '../lib/toolThinking'
import { useLayoutEffect, useRef } from 'react'
import { reducedMotion } from '../../../workspace/panelMotion'

type TurnReview = React.ComponentProps<typeof TurnChanges>['review']

/** One block of the transcript, wrapped in the element that carries its `data-block-index`. */
function TranscriptBlock({
  block: b,
  ctx,
  turn,
  finished,
  assistantActions,
  latest = false,
  toolEntries,
  children,
}: {
  block: Block
  ctx: TranscriptContext
  turn: Turn
  /** The turn is done, so its tool rows no longer show live activity. */
  finished: boolean
  assistantActions: boolean
  latest?: boolean
  toolEntries?: ToolEntry[]
  children?: React.ReactNode
}) {
  const index = blockIndex(b, ctx.blocks)
  const row = useRef<HTMLDivElement>(null)
  // A run arrives with its first entry, which may be a thought that was on screen before the calls joined it.
  const event = toolEntries?.[0] ?? (b.kind === 'tools' ? b.tools[0] : b.event)
  const { claimArrival } = ctx
  useLayoutEffect(() => {
    if (!event || !claimArrival?.(event) || reducedMotion()) return
    row.current?.classList.add('transcript-arrival')
  }, [event, claimArrival])
  return (
    <div ref={row} data-block-index={index}>
      {children ??
        (b.kind === 'tools' ? (
          <ToolGroup
            tools={b.tools}
            entries={toolEntries}
            results={ctx.results}
            cwd={ctx.cwd}
            active={ctx.busyAgent && !finished}
            live={
              b === ctx.statusGroup ||
              (ctx.statusGroup?.kind === 'tools' && ctx.statusGroup.tools.some((tool) => b.tools.includes(tool)))
            }
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
              sessionId={ctx.sessionId}
              onOpen={() => ctx.onOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)}
            />
          ) : (
            <AgentTaskCard
              task={b.event}
              live={ctx.live}
              onOpen={() => ctx.onOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)}
              onStop={ctx.onStopTask}
              readOnly={ctx.readOnly}
            />
          )
        ) : (
          <EventRow
            event={relativize(b.event, ctx.cwd)}
            taskId={ctx.taskId}
            sessionId={ctx.sessionId}
            live={ctx.live}
            assistantActions={assistantActions}
            generating={
              ctx.working && (b.event === ctx.liveText || (b.event.kind === 'thinking' && b === turn.items.at(-1)))
            }
            fresh={ctx.freshArrival?.(b.event)}
            outcomes={ctx.outcomes}
            questionStates={ctx.questionStates}
            interactive={ctx.interactive}
            latest={latest}
            onEdit={
              ctx.onEditMessage && ctx.eventSequences.has(b.event)
                ? (text, files) => ctx.onEditMessage?.(text, files, ctx.eventSequences.get(b.event))
                : undefined
            }
            onOpenAgent={ctx.onOpenAgent}
            onOpenQuestion={ctx.onOpenQuestion}
            onReviewAccess={ctx.onReviewAccess}
            onRetry={
              !ctx.busyAgent &&
              !ctx.needsInput &&
              !ctx.blocks
                .slice(index + 1)
                .some((later) => later.kind === 'tools' || ['user', 'text'].includes(later.event.kind))
                ? ctx.onRetry
                : undefined
            }
          />
        ))}
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
  const { folded, kept, answer } = turnThinking(turn.items, finished, ctx.outcomes, ctx.results)
  const renderBlock = (b: Block, latest = false, toolEntries?: ToolEntry[], first: Block = b) => (
    <TranscriptBlock
      key={blockIndex(first, blocks)}
      block={b}
      toolEntries={toolEntries}
      ctx={ctx}
      turn={turn}
      finished={finished}
      assistantActions={finished && answer.includes(b)}
      latest={latest}
    />
  )
  // Several sub-agents in a row read as one line with a summary, expanding to their cards.
  const renderList = (list: Block[]) =>
    groupToolThinking(groupAgentRuns(list)).map((item) =>
      Array.isArray(item) ? (
        <TranscriptBlock
          key={blockIndex(item[0]!, blocks)}
          block={item[0]!}
          ctx={ctx}
          turn={turn}
          finished={finished}
          assistantActions={false}
        >
          <AgentGroup
            tasks={item.map(agentOf)}
            live={ctx.live}
            onOpen={ctx.onOpenAgent}
            onStop={ctx.onStopTask}
            readOnly={ctx.readOnly}
          />
        </TranscriptBlock>
      ) : item.kind === 'work' ? (
        renderBlock(item.block, false, item.entries, item.first)
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
        <Marker className="mt-5 mb-6 justify-center text-control [.turn:first-child_&]:mt-1">
          <MarkerContent>
            <time
              className="text-muted-foreground"
              dateTime={new Date(dateSeparator).toISOString()}
              title={new Date(dateSeparator).toLocaleString(formatLocale())}
            >
              {formatChatDate(dateSeparator, dateNow, currentLanguage())}
            </time>
          </MarkerContent>
        </Marker>
      )}
      {turn.user && renderBlock(turn.user, isLast && !answer.length && !kept.length && !folded.length)}
      {/* A running turn's status is the line above the composer; a stopped one keeps its duration here. */}
      {finished && (!turn.ended || turn.interrupted) && !folded.length && (
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
                  finished && turn.ended && !turn.interrupted && !(isLast && ctx.stopped)
                    ? 'Worked for {0}'
                    : 'Working for {0}',
                  { '0': formatDuration(duration) },
                )
              : translate(
                  finished && turn.ended && !turn.interrupted && !(isLast && ctx.stopped) ? 'Worked' : 'Working',
                )
          }
          sourceIndex={ctx.hasSourceSeq ? blockIndex(folded[0]!, blocks) : undefined}
        >
          {renderList(folded)}
        </TurnSummary>
      )}
      {renderList(kept)}
      {answer.map((b) => renderBlock(b, b === ctx.latestAssistant))}
      {reviews?.map((review) => (
        <TurnChanges key={review.id} review={review} />
      ))}
      {completedGoals?.map((done) => (
        <GoalDone key={done.id} goal={done} />
      ))}
    </div>
  )
}
