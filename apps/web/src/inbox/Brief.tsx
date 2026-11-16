import { useMemo, useState } from 'react'
import { stageLabel } from '../git/PullRequestIcon'
import { ChevronRight, CircleCheck } from 'lucide-react'
import {
  blockerTally,
  blockerTallyLine,
  BRIEF_ROWS,
  briefRowHost,
  briefRowLook,
  briefRows,
  finishedSince,
  TALLY_MIN_THREADS,
  type BriefRow,
  type InboxBlocker,
} from '@ramu/shared/hostInbox'
import { retryThread, stopIdleThreads } from '@ramu/shared/chat/threadActions'
import { gigabytes } from '@ramu/shared/resources'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { timeAgo } from '../Menu'
import { BriefMarkIcon, TONE_TEXT } from './InboxParts'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { notifyError } from '../chat/Notifications'
import { useViewOnly } from '../composer/useViewOnly'
import { PendingInput } from '../HomeAgents'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { HostProvider, useHost } from '../workspace/HostProvider'
import { useHostSelection } from '../workspace/HostSelection'
import { invokeOn } from '../ipc'
import { showInboxTab } from './navigation'
import { useInboxModel } from './useBrief'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>

export function blockerLabel(blocker: InboxBlocker): string {
  const count = blocker.count ?? 1
  switch (blocker.kind) {
    case 'approval':
      return t(count === 1 ? '1 approval needed' : '{0} approvals needed', { 0: count })
    case 'connector':
      return t(count === 1 ? 'Sign in to 1 connector' : 'Sign in to {0} connectors', { 0: count })
    case 'question':
      return t(count === 1 ? '1 question to answer' : '{0} questions to answer', { 0: count })
    case 'verification-failed':
      return blocker.reason ? t('Goal check failed: {0}', { 0: blocker.reason }) : t('Goal check failed')
    case 'goal-blocked':
      return blocker.reason ? t('Goal blocked: {0}', { 0: blocker.reason }) : t('Goal blocked')
    case 'turn-limit':
      return t('Goal reached its turn limit')
    case 'goal-paused':
      return t('Goal paused')
  }
}

interface RowContent {
  taskId?: string
  sessionId?: string | null
  /** The request Open scrolls to, in `sessionId`. */
  requestId?: string
  title: string
  detail: string
  /** When it last changed, for the row's age. */
  at?: number
}

function BriefRowView({
  row,
  content,
  where,
  online,
  onDone,
}: {
  row: BriefRow
  content: RowContent
  where: string
  online: boolean
  onDone: () => void
}) {
  useLanguage()
  const { id: hostId, invoke } = useHost()
  const viewOnly = useViewOnly()
  const { select } = useHostSelection()
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const run = (work: () => Promise<unknown>) => {
    setBusy(true)
    void work()
      .then(onDone, (error) => notifyError(errorText(error)))
      .finally(() => setBusy(false))
  }
  const open = () =>
    content.taskId
      ? select(hostId, {
          kind: 'task',
          taskId: content.taskId,
          ...(content.sessionId ? { sessionId: content.sessionId } : {}),
          ...(content.sessionId && content.requestId ? { requestId: content.requestId } : {}),
        })
      : showInboxTab('running')
  const request =
    row.kind === 'blocker' && (row.blocker.kind === 'approval' || row.blocker.kind === 'question')
      ? row.chat.inputSummary?.requests[0]
      : undefined
  const disabled = busy || !online
  const actions = viewOnly ? null : row.kind === 'failure' ? (
    <>
      <Button
        size="xs"
        disabled={disabled}
        onClick={() => run(() => retryThread(invokeOn as unknown as Invoke, { hostId, taskId: row.chat.taskId }))}
      >
        {t('Retry')}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => run(() => invoke('tasks.done', row.chat.taskId, true))}
      >
        {t('Mark done')}
      </Button>
    </>
  ) : row.kind === 'low-memory' ? (
    row.memory.low.idleThreads.length > 0 && (
      <Button
        size="xs"
        disabled={disabled}
        onClick={() => run(() => stopIdleThreads(invokeOn as unknown as Invoke, hostId, row.memory.low.idleThreads))}
      >
        {t('Stop idle')}
      </Button>
    )
  ) : row.kind === 'recap' ? (
    <Button
      variant="ghost"
      size="xs"
      disabled={disabled}
      onClick={() => run(() => invoke('recaps.act', row.recap.item.id, 'done'))}
    >
      {t('Mark done')}
    </Button>
  ) : request?.kind === 'approval' ? (
    <Button
      size="xs"
      disabled={disabled}
      onClick={() =>
        run(() => invoke('agent.replyPermission', request.sessionId, request.requestId, true, undefined, 'once'))
      }
    >
      {t('Allow once')}
    </Button>
  ) : request?.choices ? (
    request.choices.options.map((option) => (
      <Button
        key={option}
        variant="secondary"
        size="xs"
        disabled={disabled}
        onClick={() =>
          run(() =>
            invoke('agent.replyQuestion', request.sessionId, request.requestId, { [request.choices!.key]: option }),
          )
        }
      >
        {option}
      </Button>
    ))
  ) : request ? (
    <Button variant="secondary" size="xs" disabled={!online} onClick={() => setExpanded((value) => !value)}>
      {expanded ? t('Hide') : t('Answer')}
    </Button>
  ) : null
  const look = briefRowLook(row)
  // The row opens its thread; actions beside it finish the step without leaving the Inbox.
  return (
    <article className="flex flex-col transition-colors hover:bg-hover">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pr-3">
        <RowButton
          size="lg"
          className="group min-w-60 flex-1 basis-60 rounded-none px-3 py-2.5 hover:bg-transparent! focus-visible:bg-hover"
          disabled={!online}
          focusableWhenDisabled
          aria-disabled={!online}
          title={online ? t('Open') : undefined}
          onClick={() => online && open()}
        >
          <BriefMarkIcon mark={look.mark} tone={look.tone} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{content.title}</span>
            <span className="block truncate text-caption">
              <span className={TONE_TEXT[look.tone]}>{content.detail}</span>
              {where && <span className="text-muted-foreground"> · {where}</span>}
            </span>
          </span>
          {content.at ? (
            <span className="flex-none text-caption text-muted-foreground tabular-nums">{timeAgo(content.at)}</span>
          ) : null}
          <ChevronRight
            size={14}
            aria-hidden
            className="flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </RowButton>
        {actions && <div className="flex flex-none flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {expanded && request && (
        <div className="px-2.5 pt-1 pb-2">
          <PendingInput sessionId={request.sessionId} />
        </div>
      )}
    </article>
  )
}

/** Inbox's first tab: the one list that answers "what needs me?", most urgent first, across every connected host. */
export function Brief() {
  useLanguage()
  const { model, hosts, computers, visit } = useInboxModel()
  const [all, setAll] = useState(false)
  const rows = useMemo(() => briefRows(model), [model])
  const shown = all ? rows : rows.slice(0, BRIEF_ROWS)
  const finished = finishedSince(model, visit)
  const pc = (id: string) => computers?.computers.find((computer) => computer.id === id)
  const data = (id: string) => hosts.find((entry) => entry.id === id)?.data
  const task = (hostId: string, taskId: string) => data(hostId)?.tasks.find((entry) => entry.id === taskId)
  const where = (hostId: string, taskId: string) => {
    const project = data(hostId)?.projects.find((entry) => entry.id === task(hostId, taskId)?.projectId)
    return [project?.name, (computers?.computers.length ?? 0) > 1 ? pc(hostId)?.name : ''].filter(Boolean).join(' · ')
  }
  const content = (row: BriefRow): RowContent => {
    if (row.kind === 'low-memory') {
      const { computerId, low } = row.memory
      const host = pc(computerId)?.name ?? ''
      return {
        title: t('{0} is low on memory', { 0: host }),
        detail: low.idleThreads.length
          ? t('{0} idle threads use {1} GB', { 0: low.idleThreads.length, 1: gigabytes(low.idleBytes) })
          : t('{0} GB free', { 0: gigabytes(low.availableBytes) }),
      }
    }
    if (row.kind === 'recap') {
      const { item } = row.recap
      return {
        taskId: item.taskId,
        sessionId: item.sessionId,
        title: item.title,
        detail: item.detail,
        at: item.updatedAt,
      }
    }
    const title = task(row.chat.computerId, row.chat.taskId)?.title ?? ''
    const base = { taskId: row.chat.taskId, sessionId: row.chat.sessionId, title, at: row.chat.lastActiveAt }
    if (row.kind === 'failure') return { ...base, detail: t('Failed') }
    if (row.kind === 'pull-request') {
      const pr = row.chat.pullRequest!
      return {
        ...base,
        detail: `#${pr.number} · ${stageLabel(pr.stage)}`,
      }
    }
    const request = row.chat.inputSummary?.requests[0]
    // A helper's request belongs to the helper's session; Open goes there and to the request itself.
    return {
      ...base,
      ...(request ? { sessionId: request.sessionId, requestId: request.requestId } : {}),
      detail: request?.title || blockerLabel(row.blocker),
    }
  }
  const refetch = (hostId: string) => () => void hosts.find((entry) => entry.id === hostId)?.refetch()
  const keyOf = (row: BriefRow) =>
    JSON.stringify([
      briefRowHost(row),
      row.kind,
      row.kind === 'recap' ? row.recap.item.id : row.kind === 'low-memory' ? '' : row.chat.taskId,
    ])
  return (
    <div className="flex flex-col gap-5">
      {rows.length > 0 ? (
        // The tab already counts these, so the list needs no heading; only facts the count leaves out get a line.
        <section className="flex flex-col gap-2" aria-label={t('Needs you')}>
          {(finished > 0 || model.waiting.length >= TALLY_MIN_THREADS) && (
            <p className="m-0 text-caption text-muted-foreground" role="status">
              {[
                model.waiting.length >= TALLY_MIN_THREADS ? blockerTallyLine(blockerTally(model.waiting), t) : '',
                finished ? t('{0} finished since your last visit.', { 0: finished }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <div className="flex flex-col divide-y divide-(--line) overflow-hidden rounded-(--radius-m) bg-card">
            {shown.map((row) => {
              const hostId = briefRowHost(row)
              return (
                <HostProvider key={keyOf(row)} hostId={hostId}>
                  <BriefRowView
                    row={row}
                    content={content(row)}
                    where={
                      row.kind === 'low-memory'
                        ? ''
                        : where(hostId, row.kind === 'recap' ? row.recap.item.taskId : row.chat.taskId)
                    }
                    online={pc(hostId)?.status === 'connected'}
                    onDone={refetch(hostId)}
                  />
                </HostProvider>
              )
            })}
          </div>
          {rows.length > shown.length && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-caption text-muted-foreground"
              onClick={() => setAll(true)}
            >
              {t('See all')} · {rows.length}
              <ChevronRight size={12} />
            </Button>
          )}
        </section>
      ) : (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheck />
            </EmptyMedia>
            <EmptyTitle>{t('You are all caught up')}</EmptyTitle>
            <EmptyDescription>
              {finished
                ? t('{0} finished since your last visit.', { 0: finished })
                : t('Questions, approvals, failures and recaps that need a decision show up here.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
