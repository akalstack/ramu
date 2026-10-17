import { useDeferredRequests } from './agent/hooks/useDeferredRequests'
import { HelperBreadcrumb } from '../HomeAgents'
import { NO_PROJECT } from '@ramu/shared/types'
import { focusComposer } from '../composer/ComposerInput'
import { Spinner } from '@/components/ui/spinner'
import { t as translate, useLanguage } from '../i18n'
import { LoadingDots } from '@/components/loading-dots'
import { isCompacting } from '@ramu/shared/chat/compaction'
import { Button } from '@/components/desktop-button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { TranscriptScrollApi } from './agent/components/TranscriptScrollApi'
import type { FileContext } from '@ramu/shared/types'
import { ArrowDown } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, AgentEvent } from '@ramu/shared/types'
import { agentActivityLabel } from '@ramu/shared/chat/agentActivity'
import { GoalBar } from '../chat/GoalBar'
import { goalChanges } from '@ramu/shared/chat/goalHistory'
import { AgentControls } from '../chat/AgentControls'
import { useAppSettings } from '../settings/AppSettings'
import { reviewsByTurn } from '@ramu/shared/review/reviewGroups'
import { useReviews } from '../git/reviews'
import { FILE_DRAG_TYPE } from '../composer/ComposerSuggestions'
import { ChatFind } from '../chat/ChatFind'
import { effectiveStatus, latestTasks, parseTaskMessage, parseTaskStop } from '@ramu/shared/chat/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { ProviderRouteChip } from '../models/ProviderRoute'
import { ContextMeter } from '../settings/Usage'
import { CommentsChip, pendingComments } from '../git/ReviewChip'
import { Composer } from '../composer/Composer'
import { invoke } from '../ipc'
import { errorText } from '../workspace/TaskPane'
import { useWorkspaceActions } from '../workspace/workspace'
import { QuestionDock } from '../chat/QuestionCard'
import { parseAnswerMessage } from '@ramu/shared/chat/questions'
import { notifyError } from '../chat/Notifications'
import { draftKey, loadDraft, saveDraft, useDraftPersistence } from '../composer/drafts'
import { outbox, useOutbox } from '../composer/outbox'
import { useHostConnection } from '../workspace/computers'
import { HostWaitNote, ProviderWaitNote } from '../models/ProviderWait'
import { ComposerTray } from '../composer/ComposerTray'
import { providerWaitOf } from '@ramu/shared/chat/providerWait'

import { LIVE, RESUME_PROMPT } from './agent/constants'
import { savedChat, useChatPresentation } from './agent/hooks/useChatPresentation'
import { useAgentStream } from './agent/hooks/useAgentStream'
import { useTranscriptScroll } from './agent/hooks/useTranscriptScroll'
import { useChatFind } from './agent/hooks/useChatFind'
import { useSidePanels } from './agent/hooks/useSidePanels'
import { useTurnPaging } from './agent/hooks/useTurnPaging'
import { useContinueInNewChat } from './agent/hooks/useContinueInNewChat'
import { useModelChange } from './agent/hooks/useModelChange'
import { useElapsed } from './agent/hooks/useElapsed'
import { toBlocks } from './agent/lib/blocks'
import { toTurns } from './agent/lib/turns'
import {
  completedGoalsByTurn,
  outcomesOf,
  pageTurnDate,
  questionStatesOf,
  toolResultsOf,
  turnDatesOf,
} from './agent/lib/derive'
import { outboxFullError, quoteLines, visibleText } from './agent/lib/messages'
import type { AgentViewDesc, MessageEdit, TranscriptContext } from './agent/types'
import { AgentHeader } from './agent/components/AgentHeader'
import { ContinueChatDialog } from './agent/components/ContinueChatDialog'
import { ModelChangeDialog } from './agent/components/ModelChangeDialog'
import { PendingQuestionsBar } from './agent/components/PendingQuestionsBar'
import { QueuedMessages } from './agent/components/QueuedMessages'
import { TranscriptTurn } from './agent/components/TranscriptTurn'
import { WorkingText } from './agent/components/WorkingText'
import { AsidePanel } from './agent/components/AsidePanel'
import { AgentTaskPanel } from './agent/components/AgentTaskPanel'
import { SelectionActions } from './agent/components/SelectionActions'
import { EditFromHereDialog } from './agent/components/EditFromHereDialog'
import { MESSAGE_ACTION_EVENT, type MessageActionDetail } from './agent/components/MessageQuoteActions'
import { WORKING_CLASS } from './agent/styles'

/** A chat with an agent: its transcript, the message box and the side panels for sub-agents and asides. */
export const AgentView = memo(function AgentView({
  view,
  history,
  visible = true,
}: {
  view: AgentViewDesc
  history?: React.ReactNode
  visible?: boolean
}) {
  useLanguage()
  const { preferences, save } = useAppSettings()
  const { reviews } = useReviews()
  const {
    session,
    setSession,
    events: sourceEvents,
    eventSequences,
    liveText,
    queued,
    queuePaused,
    hydrating,
    error,
    setError,
  } = useAgentStream(view.sessionId)
  const [attachments, setAttachments] = useState<Attachment[]>(() => savedChat(view.sessionId)?.attachments ?? [])
  const [draft, setDraft] = useState(() => savedChat(view.sessionId)?.draft ?? loadDraft(draftKey.chat(view.sessionId)))
  const events = useDeferredRequests(sourceEvents, draft)
  useDraftPersistence(draftKey.chat(view.sessionId), draft)
  /** The sent message being edited in place. The composer and its draft are left alone. */
  const [editing, setEditing] = useState<MessageEdit | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [dropping, setDropping] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { scroller, stick, onScroll } = useTranscriptScroll({ root, savedStick: savedChat(view.sessionId)?.stick })
  const scrollToEnd = useRef<(() => void) | null>(null)
  useChatPresentation({ sessionId: view.sessionId, session, events, draft, attachments, scroller, stick })
  const { finding, findRequest, findQuery, openFind, closeFind } = useChatFind(root)

  const outcomes = useMemo(() => outcomesOf(events), [events])
  const questionStates = useMemo(() => questionStatesOf(events), [events])
  const [showQuestions, setShowQuestions] = useState(false)
  // Questions float above the message box; the transcript row opens them.
  const [questionDockOpen, setQuestionDockOpen] = useState(true)
  const [questionFocus, setQuestionFocus] = useState<{ requestId: string; at: number } | null>(null)
  const openQuestion = (requestId: string) => setQuestionFocus({ requestId, at: Date.now() })
  const results = useMemo(() => toolResultsOf(events), [events])
  const blocks = useMemo(() => toBlocks(events), [events])
  const goalNotes = useMemo(() => goalChanges(events), [events])
  const latestAssistant = blocks.findLast((block) => block.kind === 'event' && block.event.kind === 'text')
  const live = session ? LIVE.includes(session.state) : false
  const pendingQuestions = events.filter(
    (e): e is Extract<AgentEvent, { kind: 'question' | 'elicitation' }> =>
      (e.kind === 'question' || e.kind === 'elicitation') &&
      !outcomes.has(e.requestId) &&
      (e.kind === 'elicitation' ? live : e.responseMode === 'message' || live),
  )
  const dockQuestions = useMemo(
    () => pendingQuestions.filter((e): e is Extract<AgentEvent, { kind: 'question' }> => e.kind === 'question'),
    [events, live, outcomes],
  )
  // A new question opens the dock, even after "Answer later".
  const dockKey = dockQuestions.map((e) => e.requestId).join(',')
  const seenQuestions = useRef(new Set<string>())
  useEffect(() => {
    if (dockQuestions.some((e) => !seenQuestions.current.has(e.requestId))) setQuestionDockOpen(true)
    dockQuestions.forEach((e) => seenQuestions.current.add(e.requestId))
  }, [dockKey])
  const allTasks = useMemo(() => latestTasks(events), [events])
  const tasks = useMemo(() => allTasks.filter((task) => task.taskType !== 'local_bash'), [allTasks])
  const commands = allTasks.filter(
    (task) => task.taskType === 'local_bash' && task.background && effectiveStatus(task, live) === 'running',
  )
  const { dock, openAgent, openAside, asides, panelOpen, setOpenAgent, setOpenAside, toggleAside } = useSidePanels({
    sessionId: view.sessionId,
    root,
    tasks,
  })
  useEffect(() => {
    const openHelper = () => {
      try {
        const value = JSON.parse(sessionStorage.getItem('ramu.open-helper') ?? 'null')
        if (value?.parentId === view.sessionId && typeof value.agentId === 'string') {
          setOpenAgent(value.agentId)
          sessionStorage.removeItem('ramu.open-helper')
        }
      } catch {
        /* Ignore stale navigation. */
      }
    }
    openHelper()
    window.addEventListener('ramu:open-helper', openHelper)
    return () => window.removeEventListener('ramu:open-helper', openHelper)
  }, [view.sessionId, setOpenAgent])
  const goalEvent = events.findLast((event) => event.kind === 'goal')
  const goal = goalEvent?.kind === 'goal' ? goalEvent.goal : null
  const liveGoal = goal && goal.status !== 'completed' ? goal : null
  const providerWait = useMemo(() => providerWaitOf(events), [events])
  const runningTasks = tasks.filter((task) => effectiveStatus(task, live) === 'running')
  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const backgroundTool = (toolUseId: string) =>
    void act(() => invoke('agent.backgroundTool', view.sessionId, toolUseId))
  const stopTask = (task: AgentTask) => void act(() => invoke('agent.stopTask', view.sessionId, task.agentId))
  const working = session?.state === 'running' || session?.state === 'starting'
  const compacting = session?.state !== 'stopped' && session?.state !== 'failed' && isCompacting(events)
  const activityLabel = compacting ? 'Compacting context…' : agentActivityLabel(session?.state, events)
  const turns = useMemo(() => toTurns(blocks, events), [blocks, events])
  const { hiddenTurns, pageTurns, showEarlierTurns } = useTurnPaging({
    view,
    visible,
    taskId: session?.taskId,
    events,
    blocks,
    turns,
    scroller,
    stick,
  })
  const statusGroup =
    working && !turns.at(-1)?.ended ? turns.at(-1)?.items.findLast((block) => block.kind === 'tools') : undefined
  const completedGoals = useMemo(() => completedGoalsByTurn(events), [events])
  const turnReviews = useMemo(
    () =>
      reviewsByTurn(
        reviews,
        view.sessionId,
        turns.map((turn) => ({
          key: turn.key,
          sequences: [...(turn.user ? [turn.user] : []), ...turn.items].flatMap((block) =>
            (block.kind === 'event' ? [block.event] : block.tools).flatMap((event) => {
              const seq = eventSequences.get(event)
              return seq === undefined ? [] : [seq]
            }),
          ),
        })),
      ),
    [reviews, turns, view.sessionId, eventSequences],
  )
  // Relative day labels stay current when a chat remains open across midnight.
  const [dateNow, setDateNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setDateNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const turnDates = useMemo(() => turnDatesOf(turns), [turns])
  const lastUserAt = turns.findLast((turn) => turn.user)?.startedAt
  const elapsed = useElapsed(lastUserAt, working)

  const busyAgent = working || session?.state === 'needs-input'
  // A stopped turn can be picked up again: Stop in this view, or a turn the provider reports as interrupted.
  const [interrupted, setInterrupted] = useState(false)
  const lastResult = events.findLast((e) => e.kind === 'result')
  const lastUserIndex = events.findLastIndex((e) => e.kind === 'user')
  const stopped =
    interrupted ||
    (!!lastResult &&
      events.lastIndexOf(lastResult) > lastUserIndex &&
      /interrupt|abort/i.test(lastResult.kind === 'result' ? lastResult.text : ''))
  useEffect(() => {
    if (working) setInterrupted(false)
  }, [working])
  const ws = useWorkspaceActions()
  const { offline: hostOffline, name: hostName } = useHostConnection()
  const pending = useOutbox(view.sessionId)
  const supportsSteering = !!session
  const action = supportsSteering ? preferences.busyMessageAction : 'queue'
  const opposite = action === 'queue' ? 'steer' : 'queue'
  const {
    pendingSettings,
    setPendingSettings,
    modelWarning,
    setModelWarning,
    dontWarn,
    setDontWarn,
    changeSettings,
    applySettings,
  } = useModelChange({
    sessionId: view.sessionId,
    session,
    setSession,
    events,
    busyAgent,
    warnModelChange: preferences.warnModelChange,
  })
  const { continuing, confirmContinue, setConfirmContinue, continueInNewChat } = useContinueInNewChat({
    session,
    pendingSettings,
    setError,
  })
  const attached = pendingComments(reviews, view.sessionId)
  // Editing keeps history and offers a provider-independent file restore before resending.
  /** Sends a pending settings change to the host before the message that follows it. */
  const applyPendingSettings = async () => {
    if (!pendingSettings) return
    setSession(await invoke('agent.configure', view.sessionId, pendingSettings))
    setPendingSettings(null)
  }
  /** Adds a Markdown quote to the message box and puts the cursor after it. */
  const quoteIntoDraft = (text: string) => {
    const quoted = quoteLines(text)
    setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quoted}\n\n` : `${quoted}\n\n`))
    requestAnimationFrame(() => {
      focusComposer(root.current, Number.MAX_SAFE_INTEGER)
    })
  }
  /** Opens New chat in this chat's project with the quote already in the box. Nothing is sent. */
  const quoteIntoNewChat = (text: string) => {
    const project = ws.task(session?.taskId ?? '')?.projectId ?? NO_PROJECT
    saveDraft(draftKey.newChat(project), `${quoteLines(text)}\n\n`)
    ws.newTask(project)
  }
  // Quote, Ask aside and Quote in new chat from a message's action row (MessageQuoteActions).
  const messageAction = useRef<(detail: MessageActionDetail) => void>(() => {})
  messageAction.current = ({ action, text, from }) => {
    if (action === 'quote') quoteIntoDraft(text)
    else if (action === 'quote-new') quoteIntoNewChat(text)
    else setOpenAside({ id: null, quote: text, from })
  }
  useEffect(() => {
    const el = root.current
    const listener = (event: Event) => messageAction.current((event as CustomEvent<MessageActionDetail>).detail)
    el?.addEventListener(MESSAGE_ACTION_EVENT, listener)
    return () => el?.removeEventListener(MESSAGE_ACTION_EVENT, listener)
  }, [])
  /** Moves a queued message back into the message box. */
  const recallIntoComposer = (files: Attachment[], text: string) => {
    setAttachments((current) => [...current, ...files.filter((file) => !current.some((entry) => entry.id === file.id))])
    setDraft((current) => (current ? `${current}\n${text}` : text))
  }
  const editMessage = (text: string, files: Attachment[], seq?: number) => {
    if (seq === undefined) return
    setEditing({ seq, text, files })
  }
  /** After a rewind the message comes back into the box above anything already typed there, ready to change and send. */
  const editRewound = (text: string, files: Attachment[]) => {
    setEditing(null)
    setAttachments((current) => [...files, ...current.filter((file) => !files.some((entry) => entry.id === file.id))])
    setDraft((current) => (current.trim() ? `${text}\n\n${current}` : text))
    stick.current = true
    requestAnimationFrame(() => focusComposer(root.current, text.length))
  }
  /** The last plain message you sent, for ↑ in an empty message box. */
  const editLast = () => {
    for (const turn of [...turns].reverse()) {
      const event = turn.user?.kind === 'event' ? turn.user.event : null
      if (
        event?.kind !== 'user' ||
        event.agentId ||
        parseAnswerMessage(event.text) ||
        parseTaskStop(event.text) ||
        parseTaskMessage(event.text)
      )
        continue
      editMessage(visibleText(event.text), event.attachments ?? [], eventSequences.get(event))
      return
    }
  }
  /** "/aside question" (or Claude Code's "/btw") asks about the whole chat beside it: the agent keeps working and never sees it. */
  const askAside = (question: string) =>
    act(async () => {
      const submitted = draft
      const aside = await invoke('aside.ask', view.sessionId, null, '', 'assistant', question)
      setDraft((current) => (current === submitted ? '' : current))
      setOpenAside({ id: aside.id, quote: aside.quote, from: aside.quoteFrom, keepFocus: true })
    })
  const send = (mode: 'queue' | 'steer' = action, context: FileContext[] = []) => {
    const side = /^\/(?:aside|btw)\s+(\S[\s\S]*)$/.exec(draft.trim())
    return side && !attachments.length && !attached.length ? askAside(side[1]!.trim()) : sendToAgent(mode, context)
  }
  const sendToAgent = (mode: 'queue' | 'steer', context: FileContext[]) =>
    act(async () => {
      const submitted = draft
      const submittedFiles = attachments
      // Review comments live on the host, so a message carrying them waits for the connection rather than the outbox.
      if (hostOffline && attached.length)
        throw new Error(translate('Review comments send once {0} is back. Your message is kept.', { 0: hostName }))
      if (hostOffline) {
        if (!outbox().add(view.sessionId, submitted, submittedFiles, context)) throw outboxFullError(hostName)
        setDraft((current) => (current === submitted ? '' : current))
        setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
        stick.current = true
        return
      }
      const outgoing = submitted
      setConfiguring(true)
      try {
        await applyPendingSettings()
        if (attached.length) {
          // Review comments go out with this message, as one request to the agent.
          for (const [index, group] of attached.entries())
            await invoke(
              'reviews.sendComments',
              group.review.id,
              group.ids,
              index === 0 ? outgoing : '',
              index === 0 ? submittedFiles.map((file) => file.id) : [],
              index === 0 ? context : [],
            )
        } else
          await invoke(
            'agent.submit',
            view.sessionId,
            outgoing,
            mode,
            submittedFiles.map((file) => file.id),
            context,
          )
        setDraft((current) => (current === submitted ? '' : current))
        setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
        stick.current = true
        scrollToEnd.current?.()
      } finally {
        setConfiguring(false)
      }
    })

  const transcript: TranscriptContext = {
    sessionId: view.sessionId,
    cwd: session?.cwd ?? '',
    taskId: session?.taskId,
    blocks,
    results,
    outcomes,
    questionStates,
    goalNotes,
    liveText,
    live,
    working,
    needsInput: session?.state === 'needs-input',
    busyAgent,
    statusGroup,
    activityLabel,
    stopped,
    elapsed,
    latestAssistant,
    hasSourceSeq: !!view.sourceSeq,
    eventSequences,
    onBackground: session?.provider === 'claude-code' && live ? backgroundTool : undefined,
    onOpenAgent: setOpenAgent,
    onStopTask: stopTask,
    onOpenQuestion: openQuestion,
    onEditMessage: editMessage,
  }

  return (
    <div
      ref={root}
      className={`agent-view [&.dropping::after]:[content:'Drop_to_add_to_the_message'] [&.dropping::after]:absolute [&.dropping::after]:inset-1.5 [&.dropping::after]:z-20 [&.dropping::after]:grid [&.dropping::after]:place-items-center [&.dropping::after]:[border:1px_dashed_var(--line-strong)] [&.dropping::after]:rounded-(--radius-m) [&.dropping::after]:[background:color-mix(in_srgb,_var(--canvas)_78%,_transparent)] [&.dropping::after]:text-foreground [&.dropping::after]:text-control [&.dropping::after]:pointer-events-none flex flex-col flex-1 min-h-0 min-w-0 relative${dropping ? ' dropping' : ''}`}
      data-state={session?.state}
      data-chat-visible={visible || undefined}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(FILE_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(event) => {
        setDropping(false)
        // A drop on the message box is already handled by the box itself.
        if ((event.target as Element).closest?.('.composer')) return
        const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE),
          files = [...event.dataTransfer.files]
        if (!dragged && !files.length) return
        event.preventDefault()
        window.dispatchEvent(
          new CustomEvent('ramu:chat-drop', { detail: { root: event.currentTarget, dragged, files } }),
        )
      }}
    >
      {session?.parentId && <HelperBreadcrumb parentId={session.parentId} />}
      <AgentHeader
        history={history}
        sessionId={view.sessionId}
        state={session?.state}
        pendingQuestionCount={pendingQuestions.length}
        showQuestions={showQuestions}
        onToggleQuestions={() => setShowQuestions((open) => !open)}
        asideOpen={openAside !== null}
        asideCount={asides.length}
        onToggleAside={toggleAside}
        commands={commands}
        onStopTask={stopTask}
        tasks={tasks}
        runningTasks={runningTasks}
        agentsOpen={openAgent !== null}
        onToggleAgents={() =>
          setOpenAgent((current) => (current ? null : runningTasks.length === 1 ? runningTasks[0]!.agentId : '*'))
        }
        onFind={() => openFind()}
        taskId={session?.taskId}
        canContinue={!!session && events.length > 0}
        continuing={continuing}
        onContinue={() => setConfirmContinue(true)}
      />
      <div className="agent-split [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:flex-none [&_>_.agent-panel]:w-[min(440px,_45%)] [&_>_.agent-panel]:h-auto [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] relative flex flex-1 min-h-0 min-w-0 [container:agent-split_/_inline-size]">
        <div className="agent-main relative flex flex-col [flex:1_1_0] min-w-0 min-h-0">
          {editing && (
            <EditFromHereDialog
              edit={editing}
              sessionId={view.sessionId}
              live={live || busyAgent}
              offlineHost={hostOffline ? hostName : undefined}
              onCancel={() => setEditing(null)}
              onRewound={editRewound}
            />
          )}
          {finding && (
            <ChatFind root={scroller} focusRequest={findRequest} initialQuery={findQuery} onClose={closeFind} />
          )}
          {modelWarning && (
            <ModelChangeDialog
              dontWarn={dontWarn}
              onDontWarnChange={setDontWarn}
              onCancel={() => setModelWarning(null)}
              onConfirm={() => {
                const next = modelWarning
                setModelWarning(null)
                if (dontWarn)
                  void save({ ...preferences, warnModelChange: false }).catch((error) =>
                    notifyError(errorText(error), 'Settings'),
                  )
                applySettings(next)
              }}
            />
          )}
          {confirmContinue && (
            <ContinueChatDialog
              busy={continuing}
              onCancel={() => setConfirmContinue(false)}
              onConfirm={() => void continueInNewChat()}
            />
          )}
          {showQuestions && pendingQuestions.length > 0 && (
            <PendingQuestionsBar
              questions={pendingQuestions}
              states={questionStates}
              scroller={scroller}
              onOpenQuestion={openQuestion}
            />
          )}
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <TranscriptScrollApi apiRef={scrollToEnd} />
            <div className="transcript-frame [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:flex-none [&_>_.agent-panel]:w-[min(440px,_45%)] [&_>_.agent-panel]:h-auto [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] relative flex-1 min-h-0 min-w-0 flex [container:transcript-frame_/_inline-size] flex-col">
              <MessageScroller
                className={`transcript min-h-0 min-w-0 flex-1 ${hydrating && !turns.length ? 'chat-loading' : ''}`}
              >
                <MessageScrollerViewport
                  ref={scroller}
                  onScroll={onScroll}
                  aria-label={translate('Conversation')}
                  className="scroll-fade-y px-6 pt-3 pb-7"
                >
                  {hiddenTurns > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mx-auto mb-2 flex text-muted-foreground"
                      onClick={showEarlierTurns}
                    >
                      {translate('Earlier turns ({0} more)', { '0': hiddenTurns })}
                    </Button>
                  )}
                  <MessageScrollerContent
                    className={`${hydrating && !turns.length ? 'justify-center' : ''} transcript-col mx-auto max-w-[var(--chat-column-width)] gap-3.5`}
                  >
                    {hydrating && !turns.length && (
                      <div className="flex items-center justify-center">
                        <Spinner
                          className="size-5 text-muted-foreground"
                          aria-label={translate('Loading conversation')}
                        />
                      </div>
                    )}
                    {pageTurns.map((turn, ti) => (
                      <MessageScrollerItem
                        key={turn.key}
                        messageId={String(turn.key)}
                        className="[content-visibility:visible]"
                      >
                        <TranscriptTurn
                          turn={turn}
                          isLast={ti === pageTurns.length - 1}
                          dateSeparator={pageTurnDate(turnDates, hiddenTurns, ti)}
                          dateNow={dateNow}
                          reviews={turnReviews.get(turn.key)}
                          completedGoals={completedGoals.get(turn.user?.kind === 'event' ? turn.user.event : null)}
                          ctx={transcript}
                        />
                      </MessageScrollerItem>
                    ))}
                    {activityLabel && (compacting || !statusGroup) && (
                      <div
                        className={WORKING_CLASS}
                        role="status"
                        aria-live="polite"
                        data-compacting={compacting || undefined}
                      >
                        <WorkingText>{translate(activityLabel)}</WorkingText>
                      </div>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton
                  variant="outline"
                  behavior="auto"
                  className="rounded-full shadow-sm backdrop-blur-sm"
                  aria-label={working ? translate('Agent is working. Scroll to latest') : translate('Scroll to latest')}
                  title={translate('Scroll to latest')}
                >
                  {working ? <LoadingDots /> : <ArrowDown size={14} />}
                </MessageScrollerButton>
              </MessageScroller>
              <SelectionActions
                scroller={scroller}
                onQuote={quoteIntoDraft}
                onQuoteNew={quoteIntoNewChat}
                onAside={(quote, from) => setOpenAside({ id: null, quote, from })}
              />
            </div>
          </MessageScrollerProvider>
          <div className="composer-dock [&_>_*]:w-full [&_>_*]:max-w-[var(--chat-column-width)] [&_>_*]:ml-auto [&_>_*]:mr-auto [&_.error]:mb-1.5 [&_.error]:text-control [&_.composer]:relative [&_.composer]:z-1 flex-none p-[0_calc(24px_+_var(--chat-scrollbar-width,_0px))_14px_24px]">
            {error && <div className="error text-bad">{error}</div>}
            {(hostOffline ||
              providerWait ||
              liveGoal ||
              queued.length > 0 ||
              pending.length > 0 ||
              dockQuestions.length > 0) && (
              <ComposerTray className="chat-tray [&_.question-dock_+_*]:mt-0.5 [&_.question-dock_+_*]:pt-0.5 [&_.question-dock_+_*]:[border-top:1px_solid_var(--line)] [&_.provider-wait_+_*]:mt-0.5 [&_.provider-wait_+_*]:pt-0.5 [&_.provider-wait_+_*]:[border-top:1px_solid_var(--line)] [&_.message-queue]:gap-0 [&_.message-queue]:p-0 [&_.message-queue]:m-0 [&_.message-queue]:[border:0] [&_.message-queue]:[border-radius:0] [&_.message-queue]:bg-transparent [&_.message-queue]:max-h-[136px] [&_.goal-bar_+_.message-queue]:mt-0.5 [&_.goal-bar_+_.message-queue]:pt-0.5 [&_.goal-bar_+_.message-queue]:[border-top:1px_solid_var(--line)] flex-col">
                {dockQuestions.length > 0 && (
                  <QuestionDock
                    sessionId={view.sessionId}
                    requests={dockQuestions}
                    states={questionStates}
                    open={questionDockOpen}
                    onOpenChange={setQuestionDockOpen}
                    focus={questionFocus}
                  />
                )}
                {hostOffline && <HostWaitNote name={hostName} />}
                {providerWait && <ProviderWaitNote retryAt={providerWait.retryAt} />}
                {liveGoal && (
                  <GoalBar
                    goal={liveGoal}
                    onControl={(action) => {
                      void act(() => invoke('agent.goal.control', view.sessionId, action))
                    }}
                  />
                )}
                {(queued.length > 0 || pending.length > 0) && (
                  <QueuedMessages
                    sessionId={view.sessionId}
                    queued={queued}
                    pending={pending}
                    paused={queuePaused}
                    hostName={hostName}
                    hostOffline={hostOffline}
                    busyAgent={busyAgent}
                    supportsSteering={supportsSteering}
                    configuring={configuring}
                    act={act}
                    onRecall={recallIntoComposer}
                  />
                )}
              </ComposerTray>
            )}
            <Composer
              persistentDraft
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              stop={{
                active: live && busyAgent,
                onStop: () => {
                  setInterrupted(true)
                  void act(() => invoke('agent.interrupt', view.sessionId))
                },
              }}
              resume={{
                active: !busyAgent && !!session && stopped,
                onResume: () => {
                  setInterrupted(false)
                  stick.current = true
                  void act(() => invoke('agent.submit', view.sessionId, RESUME_PROMPT, 'steer', [], []))
                },
              }}
              value={draft}
              allowEmpty={attached.length > 0}
              chips={
                <>
                  {session && (
                    <ProviderRouteChip sessionId={view.sessionId} settings={pendingSettings ?? session.settings} />
                  )}
                  {attached.length > 0 && (
                    <CommentsChip
                      groups={attached}
                      onRemove={() =>
                        void act(async () => {
                          for (const group of attached)
                            await invoke('reviews.select', group.review.id, group.ids, false)
                        })
                      }
                    />
                  )}
                </>
              }
              disabled={configuring || !session}
              controls={
                session && (
                  <>
                    <AgentControls
                      settings={pendingSettings ?? session.settings}
                      current={session.settings}
                      onChange={changeSettings}
                      disabled={false}
                      running={working}
                      trailing={<ContextMeter sessionId={view.sessionId} />}
                    />
                  </>
                )
              }
              onChange={setDraft}
              onArrowUpEmpty={editing ? undefined : editLast}
              chat
              onSubmit={(context) => send(action, context)}
              onAlternateSubmit={
                busyAgent && supportsSteering && !hostOffline ? (context) => send(opposite, context) : undefined
              }
              alternateDisabled={configuring || !session}
              alternateLabel={opposite === 'queue' ? 'Queue' : 'Steer'}
              placeholder={
                hostOffline
                  ? translate('Message · sends when {0} is back', { 0: hostName })
                  : live || busyAgent
                    ? translate('Reply to the agent')
                    : translate('Message the agent')
              }
              submitLabel={hostOffline ? 'Queue' : busyAgent ? (action === 'queue' ? 'Queue' : 'Steer') : 'Send'}
            />
          </div>
        </div>
        <div
          ref={dock}
          className={`agent-dock [&.open]:w-[min(440px,_45cqw)] [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:w-[min(440px,_45cqw)] [&_>_.agent-panel]:h-full [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] flex-none w-0 min-h-0 overflow-hidden ${panelOpen ? ' open' : ''}`}
          inert={!panelOpen}
          aria-hidden={!panelOpen}
        >
          {openAside && (
            <AsidePanel
              sessionId={view.sessionId}
              asides={asides}
              open={openAside}
              taskId={session?.taskId}
              onOpen={setOpenAside}
              onClose={() => setOpenAside(null)}
              onQuote={quoteIntoDraft}
            />
          )}
          {openAgent && (
            <AgentTaskPanel
              tasks={tasks}
              openId={openAgent}
              events={events}
              results={results}
              cwd={session?.cwd ?? ''}
              live={live}
              taskId={session?.taskId}
              onSelect={setOpenAgent}
              onClose={() => setOpenAgent(null)}
              onStop={stopTask}
              onMessage={(task, text) => act(() => invoke('agent.messageTask', view.sessionId, task.agentId, text))}
            />
          )}
        </div>
      </div>
    </div>
  )
})
