import { useViewOnly } from '../composer/useViewOnly'
import { MAKE_PAGE_PROMPT } from '@ramu/shared/artifacts'
import { nextMessagePoint } from '@ramu/shared/chat/nextMessage'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { McpStatusDialog } from './agent/components/McpStatusDialog'
import { ComputerActivity, ComputerGrantDialog, useComputerActivity } from '../chat/ComputerActivity'
import { BrowserActivity, useBrowserActivity } from '../chat/BrowserActivity'
import { BackgroundTerminalsSection, useBackgroundTerminals } from '../chat/BackgroundTerminals'
import { ThreadServersSection, useThreadServers } from '../chat/ThreadServers'
import { ConfirmStopDialog } from '../chat/ConfirmStopDialog'
import { helperActive, helperGroups, holdsTurn } from '@ramu/shared/chat/helperPresentation'
import { useDeferredRequests } from './agent/hooks/useDeferredRequests'
import { HelperBreadcrumb } from '../HomeAgents'
import { NO_PROJECT } from '@ramu/shared/types'
import { focusComposer } from '../composer/ComposerInput'
import { Spinner } from '@/components/ui/spinner'
import { quoteSource } from '@ramu/shared/chat/quoteSource'
import { revealFound, revealQuote } from '../lib/revealFound'
import { quoteRange } from '../lib/quoteRange'
import { ChatMentions } from '../chat/ChatReferences'
import { ThreadAgents } from './agent/lib/threadAgents'
import { Archive, CheckCircle2, RotateCcw } from 'lucide-react'
import { timeAgo } from '../Menu'
import { t as translate, useLanguage } from '../i18n'
import { ScrollToLatestButton } from './agent/components/ScrollToLatestButton'
import { contextTokensShort, isCompacting } from '@ramu/shared/chat/compaction'
import { Button } from '@/components/desktop-button'
import { reportedStop } from '@ramu/shared/chat/turnResult'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { TranscriptScrollApi } from './agent/components/TranscriptScrollApi'
import type { FileContext } from '@ramu/shared/types'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, AgentEvent } from '@ramu/shared/types'
import { agentActivityLabel, turnStartedAt } from '@ramu/shared/chat/agentActivity'
import { GoalBar } from '../chat/GoalBar'
import { goalChanges } from '@ramu/shared/chat/goalHistory'
import { AgentControls } from '../chat/AgentControls'
import { useAppSettings } from '../settings/AppSettings'
import { reviewsByTurn } from '@ramu/shared/review/reviewGroups'
import { useReviews } from '../git/reviews'
import { FILE_DRAG_TYPE } from '../composer/ComposerSuggestions'
import { ChatFind } from '../chat/ChatFind'
import { effectiveStatus, latestTasks, parseTaskMessage, parseTaskStop } from '@ramu/shared/chat/agentTasks'
import { draftMentions, type AbilityModels } from '@ramu/shared/chat/helperMentions'
import type { CustomAgent } from '@ramu/shared/customAgents'
import { useModelSets } from '../models/ModelSets'
import type { AgentTask } from '@ramu/shared/types'
import { AutoResumeMenu, ProviderRouteChip } from '../models/ProviderRoute'
import { limitPlaceholder, limitResume } from '../models/limitCopy'
import { ContextMeter, useContextUsage } from '../settings/Usage'
import { CompactBeforeSendToggle, useCompactOffer } from '../chat/CompactBeforeSend'
import { CommentsChip, pendingComments } from '../git/ReviewChip'
import { Composer } from '../composer/Composer'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace, useWorkspaceActions } from '../workspace/workspace'
import { QuestionDock } from '../chat/QuestionCard'
import { parseAnswerMessage } from '@ramu/shared/chat/questions'
import { sideChat } from '@ramu/shared/chat/sideChat'
import { notifyError } from '../chat/Notifications'
import { draftKey, draftStore, loadDraft, saveDraft, useDraftPersistence } from '../composer/drafts'
import { useHost } from '../workspace/HostProvider'
import { RunCommandProvider } from '../chat/runCommand'
import { outbox, useOutbox } from '../composer/outbox'
import { useHostConnection } from '../workspace/HostProvider'
import { HostWaitNote, ProviderWaitNote } from '../models/ProviderWait'
import { ComposerTray } from '../composer/ComposerTray'
import { ComposerStack } from '../composer/ComposerStack'
import { TrayStack } from '../composer/TrayStack'
import { limitTrayView, providerWaitState } from '@ramu/shared/chat/providerWait'
import { useAutoResume } from '../models/useAutoResume'
import { useLimitRetry } from '../models/useLimitRetry'

import { LIVE, RESUME_PROMPT } from './agent/constants'
import { savedChat, useChatPresentation } from './agent/hooks/useChatPresentation'
import { useAgentStream } from './agent/hooks/useAgentStream'
import { useTranscriptScroll } from './agent/hooks/useTranscriptScroll'
import { useChatFind } from './agent/hooks/useChatFind'
import { useSidePanels } from './agent/hooks/useSidePanels'
import { useTurnPaging } from './agent/hooks/useTurnPaging'
import { useContinueInNewChat } from './agent/hooks/useContinueInNewChat'
import { ContinueOnHostDialog } from './agent/components/ContinueOnHostDialog'
import { AgentsSection } from './agent/components/AgentsSection'
import { useModelChange } from './agent/hooks/useModelChange'
import { useJsonDraft } from '../composer/useJsonDraft'
import { sameAgentSettings } from '@ramu/shared/chat/settingsChanges'
import { toBlocks } from './agent/lib/blocks'
import { toTurns } from './agent/lib/turns'
import {
  completedGoalsByTurn,
  outcomesOf,
  pageTurnDate,
  questionStatesOf,
  askedQuestionsOf,
  toolResultsOf,
  nextTurnDate,
  openingLanded,
  turnDatesOf,
} from './agent/lib/derive'
import { outboxFullError, quoteLines, visibleText } from './agent/lib/messages'
import { useThreadViewing } from './agent/lib/threadViewing'
import { withHiddenContext } from '@ramu/shared/chat/visibleMessage'
import { interactiveAttachmentBlock, type InteractiveAttachment } from '@ramu/shared/interactive'
import { interactiveRevisions, interactiveUpdates } from '@ramu/shared/interactiveRevisions'
import {
  addInteractiveAttachment,
  INTERACTIVE_FOLLOWUP_EVENT,
  type InteractiveFollowupDetail,
} from '../interactive/followup'
import { InteractiveAttachmentChip } from '../interactive/InteractiveAttachmentChip'
import { TerminalAttachmentChip } from '../chat/TerminalAttachmentChip'
import { TERMINAL_CONTEXT_EVENT, terminalDraftKey, type TerminalContextDetail } from '../chat/terminalToChat'
import {
  addTerminalAttachment,
  isTerminalAttachmentList,
  terminalAttachmentBlock,
  type TerminalAttachment,
} from '@ramu/shared/chat/terminalContext'
import type { AgentViewDesc, MessageEdit, TranscriptContext } from './agent/types'
import { AgentHeader } from './agent/components/AgentHeader'
import { ContinueChatDialog } from './agent/components/ContinueChatDialog'
import { ModelChangeDialog } from './agent/components/ModelChangeDialog'
import { PendingQuestionsBar } from './agent/components/PendingQuestionsBar'
import { QueuedMessages } from './agent/components/QueuedMessages'
import { QueuedOpening } from './agent/components/QueuedOpening'
import { ErrorNote } from './agent/components/ErrorNote'
import { TranscriptTurn, TurnDate } from './agent/components/TranscriptTurn'
import { OpeningTurn } from './agent/components/StartingThread'
import { useHeldSteers } from './agent/hooks/useHeldSteers'
import {
  COMPOSER_DOCK_CLASS,
  LIVE_ITEM_CLASS,
  TRANSCRIPT_COLUMN_CLASS,
  TRANSCRIPT_VIEWPORT_CLASS,
} from './agent/styles'
import type { StartingThread } from '../workspace/startingThreads'
import { isLiveToolGroup } from './agent/lib/toolThinking'
import { useTranscriptArrival } from './agent/hooks/useTranscriptArrival'
import { ChatStatus, ChatSyncStatus } from '../chat/ChatMotion'
import { useDelayedStatus } from '../lib/useDelayedStatus'
import { AsidePanel } from './agent/components/AsidePanel'
import { AgentTaskPanel } from './agent/components/AgentTaskPanel'
import { SelectionActions } from './agent/components/SelectionActions'
import { EditFromHereDialog } from './agent/components/EditFromHereDialog'
import { MESSAGE_ACTION_EVENT, type MessageActionDetail } from './agent/components/MessageQuoteActions'
import { PendingSettingsChange } from './agent/components/PendingSettingsChange'
import { PendingSubmission } from './agent/components/PendingSubmission'
import { SteeringMessage } from './agent/components/SteeringMessage'
import {
  splitSteering,
  unechoedSubmissions,
  type PendingSubmission as Submission,
  type SubmissionPayload,
} from './agent/lib/pendingSubmission'

/** A chat with an agent: its transcript, the message box and the side panels for sub-agents and asides. */
export const AgentView = memo(function AgentView({
  view,
  history,
  visible = true,
  opening,
  onOpeningLanded,
}: {
  view: AgentViewDesc
  history?: React.ReactNode
  visible?: boolean
  /** The first message of a thread Home just started, drawn where it will stay until the host's copy arrives. */
  opening?: StartingThread
  onOpeningLanded?: () => void
}) {
  useLanguage()
  const host = useHost()
  // Every call of this chat goes to its own host.
  const { invoke } = host
  const viewOnly = useViewOnly()
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
    syncing,
    error,
    setError,
  } = useAgentStream(view.sessionId, visible)
  useThreadViewing(host.id, view.sessionId, visible)
  // Uploaded files wait with the text for the next send, across chat switches and restarts.
  const [attachments, setAttachments] = useJsonDraft<Attachment[]>(
    `files:${view.sessionId}`,
    host.id,
    [],
    (value): value is Attachment[] => Array.isArray(value) && value.every((file) => typeof file?.id === 'string'),
    (files) => files.length === 0,
  )
  const [mcpOpen, setMcpOpen] = useState(false)
  useEffect(() => {
    const open = () => {
      if (root.current?.checkVisibility()) setMcpOpen(true)
    }
    window.addEventListener('ramu:mcp-status', open)
    return () => window.removeEventListener('ramu:mcp-status', open)
  }, [])
  const [draft, setDraft] = useState(
    () => savedChat(view.sessionId, host.id)?.draft ?? loadDraft(draftKey.chat(view.sessionId), draftStore(host.id)),
  )
  const events = useDeferredRequests(sourceEvents, draft)
  const consumeDraft = useDraftPersistence(draftKey.chat(view.sessionId), draft, host.id)
  /** The sent message being edited in place. The composer and its draft are left alone. */
  const [editing, setEditing] = useState<MessageEdit | null>(null)
  // Messages shown the moment they are sent, until the host echoes them; a failed one waits for Retry, Edit or Remove.
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const shownSubmissions = useMemo(
    () => unechoedSubmissions(submissions, sourceEvents, queued),
    [submissions, sourceEvents, queued],
  )
  useEffect(() => {
    if (shownSubmissions.length === submissions.length) return
    const echoed = new Set(submissions.filter((item) => !shownSubmissions.includes(item)).map((item) => item.id))
    setSubmissions((current) => current.filter((item) => !echoed.has(item.id)))
  }, [shownSubmissions, submissions])
  // Reordering the host's queue waits while a send is on its way, so the new message lands where it was sent.
  const configuring = submissions.some((item) => item.state === 'sending')
  const { tray: trayQueued, steering } = splitSteering(queued)
  const landed = openingLanded(sourceEvents, trayQueued)
  const openingShown = opening && !landed ? opening : undefined
  useEffect(() => {
    if (opening && landed) onOpeningLanded?.()
  }, [opening, landed, onOpeningLanded])
  const [dropping, setDropping] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { scroller, stick, onScroll } = useTranscriptScroll({
    root,
    savedStick: savedChat(view.sessionId, host.id)?.stick,
  })
  const scrollToEnd = useRef<(() => void) | null>(null)
  useChatPresentation({ sessionId: view.sessionId, session, events, draft, attachments, scroller, stick })
  const { finding, findRequest, findQuery, openFind, closeFind } = useChatFind(root)

  const outcomes = useMemo(() => outcomesOf(events), [events])
  const questionStates = useMemo(() => questionStatesOf(events), [events])
  const askedQuestions = useMemo(() => askedQuestionsOf(events), [events])
  const interactive = useMemo(
    () => ({ revisions: interactiveRevisions(events), updates: interactiveUpdates(events) }),
    [events],
  )
  const [showQuestions, setShowQuestions] = useState(false)
  // Questions float above the message box; the transcript row opens them.
  const [questionDockOpen, setQuestionDockOpen] = useState(true)
  const [questionFocus, setQuestionFocus] = useState<{ requestId: string; at: number } | null>(null)
  const openQuestion = (requestId: string) => setQuestionFocus({ requestId, at: Date.now() })
  const results = useMemo(() => toolResultsOf(events), [events])
  const blocks = useMemo(() => toBlocks(events), [events])
  const { claim: claimArrival, fresh: freshArrival } = useTranscriptArrival(eventSequences, hydrating)
  // Most chats load before a person would notice; only a slow load earns an indicator.
  const slowHydration = useDelayedStatus(view.sessionId, hydrating || null) !== null
  const goalNotes = useMemo(() => goalChanges(events), [events])
  const latestAssistant = blocks.findLast((block) => block.kind === 'event' && block.event.kind === 'text')
  const live = session ? LIVE.includes(session.state) : false
  const pendingQuestions = events.filter(
    (e): e is Extract<AgentEvent, { kind: 'question' | 'elicitation' | 'secret-request' }> =>
      (e.kind === 'question' || e.kind === 'elicitation' || e.kind === 'secret-request') &&
      !outcomes.has(e.requestId) &&
      (e.kind === 'question' ? e.responseMode === 'message' || live : live),
  )
  const dockQuestions = useMemo(
    () => pendingQuestions.filter((e): e is Extract<AgentEvent, { kind: 'question' }> => e.kind === 'question'),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [events, live, outcomes] by design; the values it reads beyond these are current as of that run
    [events, live, outcomes],
  )
  // A new question opens the dock, even after "Answer later".
  const dockKey = dockQuestions.map((e) => e.requestId).join(',')
  const seenQuestions = useRef(new Set<string>())
  useEffect(() => {
    if (dockQuestions.some((e) => !seenQuestions.current.has(e.requestId))) setQuestionDockOpen(true)
    dockQuestions.forEach((e) => seenQuestions.current.add(e.requestId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [dockKey] by design; the values it reads beyond these are current as of that run
  }, [dockKey])
  const helperSelection = useMemo(() => helperGroups(events), [events])
  const allTasks = useMemo(() => latestTasks(events), [events])
  const tasks = useMemo(() => allTasks.filter((task) => task.taskType !== 'local_bash'), [allTasks])
  const { catalogs } = useModelSets()
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([])
  useEffect(() => {
    if (!viewOnly) void invoke('customAgents.list').then(setCustomAgents, () => {})
  }, [invoke, viewOnly])
  // `@images` and the other ability handles start a helper on whichever model this host picks for that ability.
  const [abilityModels, setAbilityModels] = useState<AbilityModels>({})
  useEffect(() => {
    if (!viewOnly) void invoke('abilities.mentionModels').then(setAbilityModels, () => {})
  }, [invoke, viewOnly, view.sessionId])
  // A device that may only view sends nothing, so it is offered no helpers to mention either.
  const models = useMemo(() => (viewOnly ? [] : catalogs.flatMap((catalog) => catalog.models)), [catalogs, viewOnly])
  const agents = useMemo(() => (viewOnly ? [] : customAgents), [customAgents, viewOnly])
  const composerHelpers = useMemo(
    () => ({ models, agents, mentions: draftMentions(models, agents, abilityModels) }),
    [models, agents, abilityModels],
  )
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
  // Read from the live store, so unarchiving brings the composer back at once.
  const workspace = useWorkspace()
  const thread = workspace.task(session?.taskId ?? '')
  const threadArchived = thread?.status === 'archived'
  const threadDoneAt = thread?.doneAt ?? null
  // A done thread waits on no usage limit: it resumes only when the person reopens it or sends a message.
  const eventsWait = useMemo(() => providerWaitState(events), [events])
  const providerWait = threadDoneAt ? null : eventsWait
  // A done thread's goal is paused with it; its bar shows again when the thread is reopened.
  const liveGoal = goal && goal.status !== 'completed' && !threadDoneAt ? goal : null
  const reportError = useCallback((reason: unknown) => setError(errorText(reason)), [setError])
  const autoResume = useAutoResume(view.sessionId, session?.settings ?? {}, setSession, reportError)
  // Assigned once the pending-settings helpers exist below; a retry sends a just-chosen login before trying.
  const prepareRetry = useRef<() => Promise<void>>(async () => {})
  const prepareLimitRetry = useCallback(() => prepareRetry.current(), [])
  const limitRetry = useLimitRetry(view.sessionId, providerWait, reportError, prepareLimitRetry)
  const runningTasks = helperSelection.selected.filter(helperActive)
  // A model change the host holds until the provider's own sub-agents and background commands finish.
  const heldSettings = useMemo(() => {
    const held = events.findLast((event) => event.kind === 'settings-waiting')
    return held?.kind === 'settings-waiting' ? held.settings : null
  }, [events])
  // The agents working beside the main agent. Commands the agent moved to the background are processes, so they are
  // listed with the background terminals instead.
  const trayAgents = runningTasks
  const act = async (fn: () => Promise<unknown>, propagate = false) => {
    setError(null)
    try {
      if (viewOnly) throw new Error(translate(VIEW_ONLY_WRITE_NOTICE))
      await fn()
    } catch (e) {
      if (propagate) throw e
      setError(errorText(e))
    }
  }
  const backgroundTool = (toolUseId: string) =>
    void act(() => invoke('agent.backgroundTool', view.sessionId, toolUseId))
  const browserActivity = useBrowserActivity(session && !session.parentId ? session.taskId : undefined, visible)
  const backgroundTerminals = useBackgroundTerminals(session?.taskId)
  const threadServers = useThreadServers(session?.taskId, visible)
  const computerActivity = useComputerActivity(session && !session.parentId ? session.taskId : undefined, visible)
  const [stopping, setStopping] = useState<AgentTask | null>(null)
  const runStopTask = (task: AgentTask) => void act(() => invoke('agent.stopTask', view.sessionId, task.agentId))
  // Background commands are processes, so ending one is confirmed; sub-agents stop at once.
  const stopTask = (task: AgentTask) => (task.taskType === 'local_bash' ? setStopping(task) : runStopTask(task))
  const working = session?.state === 'running' || session?.state === 'starting'
  // A predicted next message, asked for only while this thread is open and its last turn ended cleanly.
  const nextPoint = useMemo(
    () => (session && !viewOnly && !hydrating ? (nextMessagePoint(events, session.state)?.at ?? null) : null),
    [events, session, viewOnly, hydrating],
  )
  const [nextMessages, setNextMessages] = useState<string[]>()
  useEffect(() => {
    setNextMessages(undefined)
    if (nextPoint === null) return
    let current = true
    void Promise.resolve(invoke('agent.nextMessages', view.sessionId)).then(
      (list) => current && setNextMessages(list),
      () => {},
    )
    return () => {
      current = false
    }
  }, [nextPoint, view.sessionId, invoke])
  const compacting = session?.state !== 'stopped' && session?.state !== 'failed' && isCompacting(events)
  // From the moment a message is sent, so the end of the chat does not wait for the host to report the turn.
  const activityLabel = compacting
    ? 'Compacting context…'
    : (agentActivityLabel(session?.state) ??
      (shownSubmissions.some((item) => item.state !== 'failed') ? 'Sending…' : null))
  // Until the thread reports more than starting, the line keeps saying what the start is doing (setup, the agent).
  const statusLabel =
    openingShown && (!session || session.state === 'starting')
      ? openingShown.status
      : activityLabel && translate(activityLabel)
  const turns = useMemo(() => toTurns(blocks, events), [blocks, events])
  const heldSteers = useHeldSteers(steering, sourceEvents)
  // The answer is in and nothing was sent since: the host reports the thread idle a moment later, and a status line
  // drawn for that moment flashed under the answer. It shows only when the thread really stays busy (work picked up
  // again, sub-agents still running).
  const afterResult = !!turns.at(-1)?.ended && !shownSubmissions.length && !compacting
  const [stayedBusy, setStayedBusy] = useState(false)
  useEffect(() => {
    if (!afterResult || !statusLabel) return
    const timer = setTimeout(() => setStayedBusy(true), 400)
    return () => {
      clearTimeout(timer)
      setStayedBusy(false)
    }
  }, [afterResult, statusLabel])
  const { hiddenTurns, pageTurns, showEarlierTurns } = useTurnPaging({
    view,
    visible,
    taskId: session?.taskId,
    events,
    eventSequences,
    onOpenQuestion: (requestId) => {
      setQuestionDockOpen(true)
      openQuestion(requestId)
    },
    blocks,
    turns,
    scroller,
    stick,
  })
  const statusGroup =
    working && !turns.at(-1)?.ended ? turns.at(-1)?.items.findLast((block) => block.kind === 'tools') : undefined
  // A live tool group's headline already says what the agent is doing, so it takes the status line's place.
  const liveGroup = !!statusGroup && isLiveToolGroup(statusGroup, statusGroup, turns.at(-1)!.items)
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

  const busyAgent = working || session?.state === 'needs-input'
  // At a usage limit the thread is idle but not stopped: the composer queues messages and offers Try again.
  const limitView =
    providerWait && !busyAgent
      ? limitTrayView(limitRetry.wait ?? providerWait, autoResume.effective.value, dateNow)
      : null
  // A stopped turn can be picked up again: Stop in this view, or a turn the provider reports as interrupted.
  const [interrupted, setInterrupted] = useState(false)
  const lastResult = events.findLast((e) => e.kind === 'result')
  const lastUserIndex = events.findLastIndex((e) => e.kind === 'user')
  const stopped =
    interrupted ||
    (!!lastResult &&
      events.lastIndexOf(lastResult) > lastUserIndex &&
      lastResult.kind === 'result' &&
      reportedStop(lastResult))
  useEffect(() => {
    if (working) setInterrupted(false)
  }, [working])
  const ws = useWorkspaceActions()
  const { offline: hostOffline, name: hostName } = useHostConnection()
  // A thread opened from what this client holds says so while the host catches it up, so a person does not act on
  // a transcript that may be behind. A first load has its spinner, and a host that is away has its own note below.
  const syncShown =
    useDelayedStatus(view.sessionId, syncing && !hydrating && !hostOffline && turns.length > 0 ? 'syncing' : null) !==
    null
  const pending = useOutbox(view.sessionId, host.id)
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
    // At a usage limit nothing is running, but a change is made to get unblocked: it applies at once, so the next try or
    // automatic resume uses it.
    applyNow: busyAgent || !!providerWait,
    warnModelChange: preferences.warnModelChange,
  })
  const context = useContextUsage(view.sessionId)
  const compactTokens = useCompactOffer(
    session?.provider,
    !!session && !busyAgent && !providerWait && !pendingSettings && !hostOffline && !viewOnly,
    context,
  )
  // Keep is chosen per thread for one message; the next idle spell offers Compact again.
  const [keepHistoryFor, setKeepHistoryFor] = useState<string | null>(null)
  // Commands do not reach the thread's own conversation, so there is nothing to compact for.
  const compactOffer = compactTokens !== null && !draft.trim().startsWith('/') ? compactTokens : null
  const compactFirst = compactOffer !== null && keepHistoryFor !== view.sessionId
  const [continueHost, setContinueHost] = useState<string | null>(null)
  const { continuing, confirmContinue, setConfirmContinue, continueInNewChat, canUseWorktree } = useContinueInNewChat({
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
  prepareRetry.current = applyPendingSettings
  /**
   * Leads a quote in the message box back to where it was said: that message scrolls into view and lights up for a
   * moment. A message in turns not drawn yet is found with Find instead, which reaches further back.
   */
  const showQuote = (quote: string) => {
    const blocks = [...(root.current?.querySelectorAll<HTMLElement>('.transcript [data-block-index]') ?? [])]
    const source = quoteSource(
      blocks.map((element) => ({ element, text: element.innerText })),
      quote,
    )
    const range = source && quoteRange(source.element, quote)
    if (range) revealQuote(range)
    else if (source) revealFound(source.element)
    else
      openFind(
        quote
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean)
          ?.slice(0, 80),
      )
  }
  /** Adds a Markdown quote to the message box and puts the cursor after it. */
  const quoteIntoDraft = (text: string) => {
    const quoted = quoteLines(text)
    setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quoted}\n\n` : `${quoted}\n\n`))
    requestAnimationFrame(() => {
      focusComposer(root.current, Number.MAX_SAFE_INTEGER)
    })
  }
  /** Opens New chat in this chat's project with `draft` already in the box. Nothing is sent. */
  const draftIntoNewChat = (draft: string) => {
    const project = ws.task(session?.taskId ?? '')?.projectId ?? NO_PROJECT
    saveDraft(draftKey.newChat(project), draft, draftStore(host.id))
    ws.newTask(project)
  }
  const quoteIntoNewChat = (text: string) => draftIntoNewChat(`${quoteLines(text)}\n\n`)
  // Quote, Ask aside and Quote in new chat from a message's action row (MessageQuoteActions).
  const messageAction = useRef<(detail: MessageActionDetail) => void>(() => {})
  messageAction.current = ({ action, text, from }) => {
    if (action === 'quote') quoteIntoDraft(text)
    else if (action === 'quote-new') quoteIntoNewChat(text)
    else setOpenAside({ quote: text, from })
  }
  useEffect(() => {
    const el = root.current
    const listener = (event: Event) => messageAction.current((event as CustomEvent<MessageActionDetail>).detail)
    el?.addEventListener(MESSAGE_ACTION_EVENT, listener)
    return () => el?.removeEventListener(MESSAGE_ACTION_EVENT, listener)
  }, [])
  /** Interactive Content from "Ask about this" waits as a chip and goes out as hidden context with the next message. */
  const [contentAttachments, setContentAttachments] = useJsonDraft<InteractiveAttachment[]>(
    `interactive:${view.sessionId}`,
    host.id,
    [],
    (value): value is InteractiveAttachment[] => Array.isArray(value),
    (items) => items.length === 0,
  )
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<InteractiveFollowupDetail>).detail
      if (detail?.host === host.id && detail.session === view.sessionId) {
        setContentAttachments((current) => addInteractiveAttachment(current, detail.attachment))
        requestAnimationFrame(() => focusComposer(root.current, Number.MAX_SAFE_INTEGER))
      }
    }
    window.addEventListener(INTERACTIVE_FOLLOWUP_EVENT, receive)
    return () => window.removeEventListener(INTERACTIVE_FOLLOWUP_EVENT, receive)
  }, [host.id, view.sessionId, setContentAttachments])
  /** Terminal output added from a terminal of this thread waits as a chip and goes out as hidden context too. */
  const [terminalAttachments, setTerminalAttachments] = useJsonDraft<TerminalAttachment[]>(
    terminalDraftKey(view.sessionId),
    host.id,
    [],
    isTerminalAttachmentList,
    (items) => items.length === 0,
  )
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<TerminalContextDetail>).detail
      if (viewOnly || detail?.host !== host.id || detail.session !== view.sessionId || detail.taken) return
      detail.taken = true
      setTerminalAttachments((current) => addTerminalAttachment(current, detail.attachment))
      requestAnimationFrame(() => focusComposer(root.current, Number.MAX_SAFE_INTEGER))
    }
    window.addEventListener(TERMINAL_CONTEXT_EVENT, receive)
    return () => window.removeEventListener(TERMINAL_CONTEXT_EVENT, receive)
  }, [host.id, view.sessionId, viewOnly, setTerminalAttachments])

  const recallIntoComposer = (files: Attachment[], text: string) => {
    setAttachments((current) => [...current, ...files.filter((file) => !current.some((entry) => entry.id === file.id))])
    setDraft((current) => (current ? `${current}\n${text}` : text))
  }
  const editMessage = (text: string, files: Attachment[], seq?: number) => {
    if (viewOnly || seq === undefined) return
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
      // One side chat per thread: a typed /aside continues it.
      const latest = asides.find((entry) => entry.id === sideChat(asides).continueId)
      await invoke(
        'aside.ask',
        view.sessionId,
        latest?.id ?? null,
        latest?.quote ?? '',
        latest?.quoteFrom ?? 'assistant',
        question,
        pendingSettings ?? session?.settings,
      )
      const consumed = consumeDraft()
      if (!consumed.persisted)
        notifyError(translate('Message sent, but the local draft could not be cleared.'), 'Draft')
      if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
      setOpenAside({ quote: '', from: 'assistant', keepFocus: true })
    }, true)
  const send = (mode: 'queue' | 'steer' = action, context: FileContext[] = []) => {
    if (draft.trim() === '/mcp') {
      const submitted = draft
      const consumed = consumeDraft()
      if (!consumed.persisted) notifyError(translate('The local draft could not be cleared.'), 'Draft')
      if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
      setMcpOpen(true)
      return
    }
    const side = /^\/(?:aside|btw)\s+(\S[\s\S]*)$/.exec(draft.trim())
    return side && !attachments.length && !attached.length && !contentAttachments.length && !terminalAttachments.length
      ? askAside(side[1]!.trim())
      : sendToAgent(mode, context)
  }
  const sendToAgent = (mode: 'queue' | 'steer', context: FileContext[]) =>
    act(async () => {
      const compacting = compactFirst
      const submitted = draft
      const submittedFiles = attachments
      const submittedContent = contentAttachments
      const submittedTerminal = terminalAttachments
      const hidden = [
        submittedContent.length ? interactiveAttachmentBlock(submittedContent) : '',
        submittedTerminal.length ? terminalAttachmentBlock(submittedTerminal) : '',
      ]
        .filter(Boolean)
        .join('\n')
      const outgoing = withHiddenContext(submitted, hidden)
      const clearContent = () => {
        setContentAttachments((current) => current.filter((item) => !submittedContent.includes(item)))
        setTerminalAttachments((current) => current.filter((item) => !submittedTerminal.includes(item)))
      }
      // Review comments live on the host, so a message carrying them waits for the connection rather than the outbox.
      if (hostOffline && attached.length)
        throw new Error(translate('Review comments send once {0} is back. Your message is kept.', { 0: hostName }))
      if (hostOffline) {
        if (!outbox(host.id).add(view.sessionId, outgoing, submittedFiles, context)) throw outboxFullError(hostName)
        clearContent()
        const consumed = consumeDraft()
        if (!consumed.persisted)
          notifyError(translate('Message queued, but the local draft could not be cleared.'), 'Draft')
        if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
        setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
        stick.current = true
        return
      }
      // The message box clears and the message shows at once; the host's copy replaces it when it arrives.
      const item: Submission = {
        id: crypto.randomUUID(),
        text: submitted,
        attachments: submittedFiles,
        afterEvent: sourceEvents.length,
        queuedIds: queued.map((message) => message.id),
        sentAt: Date.now(),
        state: 'sending',
        payload: {
          outgoing,
          mode,
          context,
          compactFirst: compacting,
          reviews: attached.map((group) => ({ reviewId: group.review.id, ids: group.ids })),
        },
      }
      const consumed = consumeDraft()
      if (!consumed.persisted)
        notifyError(translate('Message sent, but the local draft could not be cleared.'), 'Draft')
      if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
      setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
      clearContent()
      setKeepHistoryFor(null)
      stick.current = true
      scrollToEnd.current?.()
      submissionsRef.current = [...submissionsRef.current, item]
      setSubmissions(submissionsRef.current)
      deliver(item.id)
    }, true)
  const submissionsRef = useRef(submissions)
  submissionsRef.current = submissions
  const updateSubmission = (id: string, patch: Partial<Submission>) => {
    submissionsRef.current = submissionsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    setSubmissions(submissionsRef.current)
  }
  const applySettingsRef = useRef(applyPendingSettings)
  applySettingsRef.current = applyPendingSettings
  const sending = useRef<Promise<void>>(Promise.resolve())
  /** Sends go out one at a time in the order they were written; one held behind a failed send waits with it. */
  const deliver = (id: string) => {
    const run = async () => {
      const list = submissionsRef.current
      const index = list.findIndex((entry) => entry.id === id)
      const item = list[index]
      if (!item || item.state !== 'sending') return
      if (list.slice(0, index).some((entry) => entry.state === 'failed')) {
        updateSubmission(id, { state: 'failed', error: translate('The message before it was not sent.') })
        return
      }
      const payload: SubmissionPayload = item.payload
      const files = item.attachments.map((file) => file.id)
      try {
        await applySettingsRef.current()
        // The message queues behind the compaction and goes out once it finishes, as after a typed /compact.
        if (payload.compactFirst) await invoke('agent.submit', view.sessionId, '/compact', 'queue', [], [])
        if (payload.reviews.length) {
          // Review comments go out with this message, as one request to the agent.
          for (const [at, group] of payload.reviews.entries())
            await invoke(
              'reviews.sendComments',
              group.reviewId,
              group.ids,
              at === 0 ? payload.outgoing : '',
              at === 0 ? files : [],
              at === 0 ? payload.context : [],
            )
        } else await invoke('agent.submit', view.sessionId, payload.outgoing, payload.mode, files, payload.context)
        updateSubmission(id, { state: 'sent' })
      } catch (error) {
        updateSubmission(id, { state: 'failed', error: errorText(error) })
      }
    }
    sending.current = sending.current.then(run, run)
  }
  const retrySubmission = (id: string) => {
    if (viewOnly) return
    updateSubmission(id, {
      state: 'sending',
      error: undefined,
      afterEvent: sourceEvents.length,
      queuedIds: queued.map((message) => message.id),
    })
    deliver(id)
  }
  const removeSubmission = (id: string) => {
    submissionsRef.current = submissionsRef.current.filter((item) => item.id !== id)
    setSubmissions(submissionsRef.current)
  }
  const editSubmission = (item: Submission) => {
    removeSubmission(item.id)
    recallIntoComposer(item.attachments, item.text)
    requestAnimationFrame(() => focusComposer(root.current))
  }

  const transcript: TranscriptContext = {
    sessionId: view.sessionId,
    cwd: session?.cwd ?? '',
    taskId: session?.taskId,
    blocks,
    results,
    outcomes,
    questionStates,
    askedQuestions,
    interactive,
    goalNotes,
    liveText,
    live,
    working,
    needsInput: session?.state === 'needs-input',
    busyAgent,
    statusGroup,
    stopped,
    helpersWorking: allTasks.some(holdsTurn),
    latestAssistant,
    hasSourceSeq: !!view.sourceSeq,
    eventSequences,
    onBackground: session?.provider === 'claude-code' && live ? backgroundTool : undefined,
    claimArrival,
    freshArrival,
    onOpenAgent: setOpenAgent,
    onStopTask: stopTask,
    onOpenQuestion: openQuestion,
    onReviewAccess: () => setMcpOpen(true),
    // While a usage limit holds the thread, the tray above the composer owns trying again; a second button here would race it.
    onRetry:
      viewOnly || providerWait
        ? undefined
        : () => {
            setInterrupted(false)
            stick.current = true
            void act(() => invoke('agent.submit', view.sessionId, RESUME_PROMPT, 'steer', [], []))
          },
    readOnly: viewOnly,
    onEditMessage: viewOnly ? undefined : editMessage,
  }

  return (
    <RunCommandProvider taskId={session?.taskId}>
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
          onToggleAside={toggleAside}
          readOnly={viewOnly}
          agentCount={helperSelection.selected.length}
          onShowAgents={() => setOpenAgent('*')}
          onFind={() => openFind()}
          taskId={session?.taskId}
          canContinue={!!session && events.length > 0}
          continuing={continuing}
          onContinue={() => setConfirmContinue(true)}
          onContinueOnHost={setContinueHost}
          onMakePage={() => void act(() => invoke('agent.submit', view.sessionId, MAKE_PAGE_PROMPT, 'queue', [], []))}
          latestRequest={
            events.findLast(
              (event): event is Extract<typeof event, { kind: 'user' }> =>
                event.kind === 'user' && !event.agentId && !event.from,
            )?.text
          }
        />
        <div className="agent-split [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:flex-none [&_>_.agent-panel]:w-[min(440px,_45%)] [&_>_.agent-panel]:h-auto [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] relative flex flex-1 min-h-0 min-w-0 [container:agent-split_/_inline-size]">
          <div className="agent-main relative flex flex-col [flex:1_1_0] min-w-0 min-h-0">
            {mcpOpen && (
              <McpStatusDialog
                key={`${host.id}:${view.sessionId}:${session?.provider}`}
                sessionId={view.sessionId}
                onClose={() => setMcpOpen(false)}
              />
            )}
            {editing && (
              <EditFromHereDialog
                edit={editing}
                readOnly={viewOnly}
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
                canUseWorktree={canUseWorktree}
                onCancel={() => setConfirmContinue(false)}
                onConfirm={(worktree) => void continueInNewChat(worktree)}
              />
            )}
            {continueHost && session && (
              <ContinueOnHostDialog
                taskId={session.taskId}
                targetId={continueHost}
                onClose={() => setContinueHost(null)}
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
            <ChatMentions.Provider value={composerHelpers.mentions}>
              <ThreadAgents.Provider value={allTasks}>
                <MessageScrollerProvider autoScroll defaultScrollPosition="end">
                  <TranscriptScrollApi apiRef={scrollToEnd} />
                  <div className="transcript-frame [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:flex-none [&_>_.agent-panel]:w-[min(440px,_45%)] [&_>_.agent-panel]:h-auto [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] relative flex-1 min-h-0 min-w-0 flex [container:transcript-frame_/_inline-size] flex-col">
                    <MessageScroller
                      className={`transcript min-h-0 min-w-0 flex-1 ${hydrating && !turns.length && !openingShown ? 'chat-loading' : ''}`}
                    >
                      <MessageScrollerViewport
                        ref={scroller}
                        onScroll={onScroll}
                        aria-label={translate('Conversation')}
                        className={TRANSCRIPT_VIEWPORT_CLASS}
                      >
                        {hiddenTurns > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mx-auto mb-2 flex text-muted-foreground"
                            onClick={showEarlierTurns}
                          >
                            {hiddenTurns === 1
                              ? translate('Show 1 earlier turn')
                              : translate('Show {0} earlier turns', { '0': hiddenTurns })}
                          </Button>
                        )}
                        <MessageScrollerContent
                          className={`${hydrating && !turns.length && !openingShown ? 'justify-center' : ''} ${TRANSCRIPT_COLUMN_CLASS}`}
                        >
                          {/* The window already carries the brand; a chat that opens at once shows nothing, a slow one a
                            small spinner. */}
                          {slowHydration && !turns.length && !openingShown && (
                            <div className="flex items-center justify-center text-muted-foreground">
                              <Spinner aria-label={translate('Loading conversation')} />
                            </div>
                          )}
                          {pageTurns.map((turn, ti) => (
                            <MessageScrollerItem
                              key={turn.key}
                              messageId={String(turn.key)}
                              className={LIVE_ITEM_CLASS}
                            >
                              <TranscriptTurn
                                turn={turn}
                                // A message just sent after a finished turn already starts the next one: until the
                                // host's copy arrives, the thread turning busy must not read as this turn resuming.
                                isLast={ti === pageTurns.length - 1 && !(shownSubmissions.length > 0 && turn.ended)}
                                dateSeparator={pageTurnDate(turnDates, hiddenTurns, ti)}
                                dateNow={dateNow}
                                reviews={turnReviews.get(turn.key)}
                                completedGoals={completedGoals.get(
                                  turn.user?.kind === 'event' ? turn.user.event : null,
                                )}
                                ctx={transcript}
                              />
                            </MessageScrollerItem>
                          ))}
                          {heldSettings && session && (
                            <MessageScrollerItem messageId="held-settings" className={LIVE_ITEM_CLASS}>
                              <PendingSettingsChange
                                next={heldSettings}
                                previous={session.settings}
                                onCancel={() =>
                                  void act(() => invoke('agent.configure', view.sessionId, session.settings))
                                }
                                onApplyNow={() =>
                                  void act(async () =>
                                    setSession(await invoke('agent.configure', view.sessionId, heldSettings, 'now')),
                                  )
                                }
                              />
                            </MessageScrollerItem>
                          )}
                          {pendingSettings &&
                            !heldSettings &&
                            session &&
                            !busyAgent &&
                            !sameAgentSettings(pendingSettings, session.settings) && (
                              <MessageScrollerItem messageId="pending-settings" className={LIVE_ITEM_CLASS}>
                                <PendingSettingsChange
                                  next={pendingSettings}
                                  previous={session.settings}
                                  onCancel={() => setPendingSettings(null)}
                                />
                              </MessageScrollerItem>
                            )}
                          {/* A new thread whose first message the host holds still reads as started. */}
                          {!hydrating &&
                            !events.some((event) => event.kind === 'user') &&
                            trayQueued.map((message) => (
                              <MessageScrollerItem
                                key={message.id}
                                messageId={`queued-opening-${message.id}`}
                                className={LIVE_ITEM_CLASS}
                              >
                                <QueuedOpening message={message} />
                              </MessageScrollerItem>
                            ))}
                          {openingShown && (
                            <OpeningTurn
                              text={openingShown.text}
                              attachments={openingShown.attachments}
                              sentAt={openingShown.sentAt}
                              now={dateNow}
                            />
                          )}
                          {heldSteers.steers.map((message) => (
                            <MessageScrollerItem
                              key={message.id}
                              messageId={`steering-${message.id}`}
                              className={LIVE_ITEM_CLASS}
                            >
                              <SteeringMessage
                                sessionId={view.sessionId}
                                message={message}
                                // One the queue already let go of is only waiting for its message to show.
                                readOnly={viewOnly || !steering.includes(message)}
                                act={act}
                                onRemoved={() => heldSteers.forget(message.id)}
                              />
                            </MessageScrollerItem>
                          ))}
                          {shownSubmissions.map((item, index) => {
                            // Laid out as the turn it becomes, day separator included, so the host's copy lands in
                            // the same place instead of pushing it down.
                            const date = index === 0 ? nextTurnDate(turns, item.sentAt) : undefined
                            return (
                              <MessageScrollerItem
                                key={item.id}
                                messageId={`pending-submission-${item.id}`}
                                className={LIVE_ITEM_CLASS}
                              >
                                <div className="turn flex flex-col gap-3.5 min-w-0">
                                  {date !== undefined && <TurnDate at={date} now={dateNow} />}
                                  <PendingSubmission
                                    submission={item}
                                    onRetry={() => retrySubmission(item.id)}
                                    onEdit={() => editSubmission(item)}
                                    onRemove={() => removeSubmission(item.id)}
                                  />
                                </div>
                              </MessageScrollerItem>
                            )
                          })}
                          {statusLabel && (compacting || !liveGroup) && (!afterResult || stayedBusy) && (
                            <ChatStatus
                              label={statusLabel}
                              compacting={compacting}
                              since={activityLabel === 'Working' ? turnStartedAt(events) : null}
                              // The starting thread's view drew this line already; it stays rather than fading in again.
                              enter={!openingShown}
                            />
                          )}
                          {syncShown && <ChatSyncStatus label={translate('Syncing messages…')} />}
                        </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <ScrollToLatestButton working={working} />
                    </MessageScroller>
                    <SelectionActions
                      scroller={scroller}
                      readOnly={viewOnly}
                      onQuote={quoteIntoDraft}
                      onQuoteNew={quoteIntoNewChat}
                      onAside={(quote, from) => setOpenAside({ quote, from })}
                    />
                  </div>
                </MessageScrollerProvider>
              </ThreadAgents.Provider>
            </ChatMentions.Provider>
            <div className={COMPOSER_DOCK_CLASS}>
              <ComposerStack>
                {error && <ErrorNote message={error} title={translate('That didn’t work')} />}
                <ComputerGrantDialog state={computerActivity} />
                <ConfirmStopDialog
                  command={stopping ? stopping.name : null}
                  onCancel={() => setStopping(null)}
                  onConfirm={() => {
                    if (stopping) runStopTask(stopping)
                    setStopping(null)
                  }}
                />
                {(hostOffline ||
                  backgroundTerminals.terminals.length > 0 ||
                  commands.length > 0 ||
                  threadServers.servers.length > 0 ||
                  browserActivity.tabs.length > 0 ||
                  !!computerActivity.session ||
                  providerWait ||
                  liveGoal ||
                  trayQueued.length > 0 ||
                  pending.length > 0 ||
                  (!!session && trayAgents.length > 0) ||
                  dockQuestions.length > 0) && (
                  <ComposerTray className="chat-tray">
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
                    {hostOffline && <HostWaitNote name={hostName} hostId={host.id} />}
                    {providerWait && (
                      <ProviderWaitNote retry={limitRetry} autoResume={autoResume} readOnly={viewOnly} />
                    )}
                    {/* Live work and the queue are chips in one row; what needs the person stays a full row above. The goal
                        leads: it lasts the whole thread, so it keeps its place while servers and terminals come and go. */}
                    <TrayStack>
                      {liveGoal && (
                        <GoalBar
                          goal={liveGoal}
                          readOnly={viewOnly}
                          onControl={(action) => {
                            void act(() => invoke('agent.goal.control', view.sessionId, action))
                          }}
                          onVerify={(command) => {
                            void act(() => invoke('agent.goal.verify', view.sessionId, command))
                          }}
                        />
                      )}
                      {session && trayAgents.length > 0 && (
                        <AgentsSection
                          agents={trayAgents}
                          readOnly={viewOnly}
                          onOpen={(agentId) => setOpenAgent(agentId)}
                          onOpenAll={helperSelection.selected.length > 0 ? () => setOpenAgent('*') : undefined}
                          onStop={stopTask}
                        />
                      )}
                      {browserActivity.tabs.length > 0 && <BrowserActivity state={browserActivity} />}
                      {computerActivity.taskId && computerActivity.session && (
                        <ComputerActivity state={computerActivity} />
                      )}
                      {threadServers.servers.length > 0 && <ThreadServersSection state={threadServers} />}
                      {(backgroundTerminals.terminals.length > 0 || commands.length > 0) && (
                        <BackgroundTerminalsSection
                          state={backgroundTerminals}
                          commands={commands}
                          readOnly={viewOnly}
                          onOpenCommand={(task) => setOpenAgent(task.agentId)}
                          onStopCommand={stopTask}
                        />
                      )}
                      {(trayQueued.length > 0 || pending.length > 0) && (
                        <QueuedMessages
                          sessionId={view.sessionId}
                          queued={trayQueued}
                          readOnly={viewOnly}
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
                    </TrayStack>
                  </ComposerTray>
                )}
                {threadArchived && !viewOnly ? (
                  // An archived thread takes no messages; it is unarchived first, which is offered here.
                  <div className="mx-auto mb-3 flex w-full max-w-(--chat-column-width) items-center gap-3 rounded-(--radius-l) border border-line bg-card px-4 py-3 text-control">
                    <Archive size={16} className="text-muted-foreground" />
                    <span className="flex-1 text-soft">{translate('This thread is archived.')}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void act(() => invoke('tasks.archive', session!.taskId, false))}
                    >
                      {translate('Unarchive')}
                    </Button>
                  </div>
                ) : (
                  <>
                    {threadDoneAt && !viewOnly && (
                      // A done thread holds automatic turns; sending a message or Reopen continues it.
                      <div className="mx-auto mb-2 flex w-full max-w-(--chat-column-width) items-center gap-2 px-1 text-control text-soft">
                        <CheckCircle2 size={14} className="flex-none text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {translate('This thread is done.')}{' '}
                          <span className="text-muted-foreground">{timeAgo(threadDoneAt)}</span>
                          {queued.length > 0 && (
                            <>
                              {' · '}
                              {translate('{count} queued messages held', { count: queued.length })}
                            </>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void act(() => invoke('tasks.done', session!.taskId, false))}
                        >
                          <RotateCcw size={14} /> {translate('Reopen')}
                        </Button>
                      </div>
                    )}
                    <Composer
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
                        ...limitResume(limitView),
                        active: !busyAgent && !!session && (stopped || limitResume(limitView).active),
                        onResume: () => {
                          if (limitResume(limitView).active) {
                            stick.current = true
                            limitRetry.tryNow()
                            return
                          }
                          setInterrupted(false)
                          stick.current = true
                          void act(() => invoke('agent.submit', view.sessionId, RESUME_PROMPT, 'steer', [], []))
                        },
                      }}
                      value={draft}
                      nextMessages={nextMessages}
                      allowEmpty={attached.length > 0 || terminalAttachments.length > 0}
                      chips={
                        <>
                          {session && (
                            <ProviderRouteChip
                              sessionId={view.sessionId}
                              settings={pendingSettings ?? session.settings}
                              limited={!!providerWait}
                              readOnly={viewOnly}
                              autoResume={autoResume}
                              onSession={setSession}
                            />
                          )}
                          {contentAttachments.map((attachment) => (
                            <InteractiveAttachmentChip
                              key={`${attachment.id}:${attachment.version}`}
                              attachment={attachment}
                              onRemove={() =>
                                setContentAttachments((current) => current.filter((item) => item !== attachment))
                              }
                            />
                          ))}
                          {terminalAttachments.map((attachment) => (
                            <TerminalAttachmentChip
                              key={attachment.id}
                              attachment={attachment}
                              onRemove={() =>
                                setTerminalAttachments((current) => current.filter((item) => item !== attachment))
                              }
                            />
                          ))}
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
                      disabled={!session}
                      controls={
                        session && (
                          <AgentControls
                            settings={pendingSettings ?? session.settings}
                            current={session.settings}
                            onChange={changeSettings}
                            disabled={viewOnly}
                            running={working}
                            trailing={
                              <>
                                {autoResume && <AutoResumeMenu autoResume={autoResume} readOnly={viewOnly} />}
                                <ContextMeter context={context} />
                              </>
                            }
                          />
                        )
                      }
                      onChange={setDraft}
                      onShowQuote={showQuote}
                      onArrowUpEmpty={editing || viewOnly ? undefined : editLast}
                      chat
                      helpers={composerHelpers}
                      onSubmit={(context) => send(action, context)}
                      onAlternateSubmit={
                        busyAgent && supportsSteering && !hostOffline ? (context) => send(opposite, context) : undefined
                      }
                      alternateDisabled={!session}
                      alternateLabel={opposite === 'queue' ? 'Queue' : 'Steer'}
                      placeholder={
                        hostOffline
                          ? translate('Message · sends when {0} is back', { 0: hostName })
                          : limitView
                            ? limitPlaceholder(limitView, autoResume.effective.value)
                            : live || busyAgent
                              ? translate('Reply to the agent')
                              : translate('Message the agent')
                      }
                      actions={
                        compactOffer !== null && (
                          <CompactBeforeSendToggle
                            tokens={compactOffer}
                            compact={compactFirst}
                            disabled={configuring}
                            onChange={(compact) => setKeepHistoryFor(compact ? null : view.sessionId)}
                          />
                        )
                      }
                      submitLabel={
                        hostOffline || limitView
                          ? 'Queue'
                          : busyAgent
                            ? action === 'queue'
                              ? 'Queue'
                              : 'Steer'
                            : compactFirst
                              ? 'Compact and send'
                              : 'Send'
                      }
                      submitTitle={
                        compactFirst && compactOffer !== null
                          ? translate('Summarize {0} tokens of history, then send', {
                              0: contextTokensShort(compactOffer),
                            })
                          : undefined
                      }
                    />
                  </>
                )}
              </ComposerStack>
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
                readOnly={viewOnly}
                open={openAside}
                taskId={session?.taskId}
                settings={pendingSettings ?? session?.settings}
                onClose={() => setOpenAside(null)}
                onQuote={quoteIntoDraft}
                onPromote={draftIntoNewChat}
              />
            )}
            {openAgent && (
              <AgentTaskPanel
                tasks={tasks}
                commands={commands}
                selectedIds={helperSelection.selected.map((task) => task.agentId)}
                openId={openAgent}
                events={events}
                results={results}
                cwd={session?.cwd ?? ''}
                live={live}
                taskId={session?.taskId}
                onSelect={setOpenAgent}
                onClose={() => setOpenAgent(null)}
                onStop={stopTask}
                readOnly={viewOnly}
                onMessage={(task, text) => act(() => invoke('agent.messageTask', view.sessionId, task.agentId, text))}
              />
            )}
          </div>
        </div>
      </div>
    </RunCommandProvider>
  )
})
