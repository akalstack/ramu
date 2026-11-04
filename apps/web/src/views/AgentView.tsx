import { useViewOnly } from '../composer/useViewOnly'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { McpStatusDialog } from './agent/components/McpStatusDialog'
import { ComputerActivity, ComputerGrantDialog, useComputerActivity } from '../chat/ComputerActivity'
import { BrowserActivity, useBrowserActivity } from '../chat/BrowserActivity'
import { BackgroundTerminalsSection, useBackgroundTerminals } from '../chat/BackgroundTerminals'
import { ConfirmStopDialog } from '../chat/ConfirmStopDialog'
import { helperActive, helperGroups } from '@ramu/shared/chat/helperPresentation'
import { useDeferredRequests } from './agent/hooks/useDeferredRequests'
import { HelperBreadcrumb } from '../HomeAgents'
import { NO_PROJECT } from '@ramu/shared/types'
import { focusComposer } from '../composer/ComposerInput'
import { Spinner } from '@/components/ui/spinner'
import { quoteSource } from '@ramu/shared/chat/quoteSource'
import { revealFound } from '../lib/revealFound'
import { ChatMentions } from '../chat/ChatReferences'
import { ThreadAgents } from './agent/lib/threadAgents'
import { t as translate, useLanguage } from '../i18n'
import { ScrollToLatestButton } from './agent/components/ScrollToLatestButton'
import { isCompacting } from '@ramu/shared/chat/compaction'
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
import { agentActivityLabel } from '@ramu/shared/chat/agentActivity'
import { GoalBar } from '../chat/GoalBar'
import { goalChanges } from '@ramu/shared/chat/goalHistory'
import { AgentControls } from '../chat/AgentControls'
import { useAppSettings } from '../settings/AppSettings'
import { reviewsByTurn } from '@ramu/shared/review/reviewGroups'
import { useReviews } from '../git/reviews'
import { FILE_DRAG_TYPE } from '../composer/ComposerSuggestions'
import { ChatFind } from '../chat/ChatFind'
import {
  activeTeammates,
  effectiveStatus,
  latestTasks,
  parseTaskMessage,
  parseTaskStop,
} from '@ramu/shared/chat/agentTasks'
import { draftMentions, modelHandle, resolveMention, teammateSettings } from '@ramu/shared/chat/teammateMentions'
import type { CustomAgent } from '@ramu/shared/customAgents'
import { useModelSets } from '../models/ModelSets'
import type { AgentTask } from '@ramu/shared/types'
import { ProviderRouteChip } from '../models/ProviderRoute'
import { limitPlaceholder, limitResume } from '../models/limitCopy'
import { ContextMeter } from '../settings/Usage'
import { CommentsChip, pendingComments } from '../git/ReviewChip'
import { Composer } from '../composer/Composer'
import { errorText } from '../workspace/TaskPane'
import { useWorkspaceActions } from '../workspace/workspace'
import { QuestionDock } from '../chat/QuestionCard'
import { parseAnswerMessage } from '@ramu/shared/chat/questions'
import { notifyError } from '../chat/Notifications'
import { draftKey, draftStore, loadDraft, saveDraft, useDraftPersistence } from '../composer/drafts'
import { useHost } from '../workspace/HostProvider'
import { outbox, useOutbox } from '../composer/outbox'
import { useHostConnection } from '../workspace/computers'
import { HostWaitNote, ProviderWaitNote } from '../models/ProviderWait'
import { ComposerTray } from '../composer/ComposerTray'
import { ComposerStack } from '../composer/ComposerStack'
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
import {
  RecipientChip,
  TeammatesSection,
  TeammateJoinControls,
  useJoiningTeammate,
} from './agent/components/TeammateControls'
import { useModelChange } from './agent/hooks/useModelChange'
import { useJsonDraft } from '../composer/useJsonDraft'
import { settingsMatch } from './agent/settingsMatch'
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
import { CONTEXT_MARKER, outboxFullError, quoteLines, visibleText } from './agent/lib/messages'
import { interactiveAttachmentBlock, type InteractiveAttachment } from '@ramu/shared/interactive'
import {
  addInteractiveAttachment,
  INTERACTIVE_FOLLOWUP_EVENT,
  type InteractiveFollowupDetail,
} from '../interactive/followup'
import { InteractiveAttachmentChip } from '../interactive/InteractiveAttachmentChip'
import type { AgentViewDesc, MessageEdit, TranscriptContext } from './agent/types'
import { AgentHeader } from './agent/components/AgentHeader'
import { ContinueChatDialog } from './agent/components/ContinueChatDialog'
import { ModelChangeDialog } from './agent/components/ModelChangeDialog'
import { PendingQuestionsBar } from './agent/components/PendingQuestionsBar'
import { QueuedMessages } from './agent/components/QueuedMessages'
import { ErrorNote } from './agent/components/ErrorNote'
import { TranscriptTurn } from './agent/components/TranscriptTurn'
import { useTranscriptArrival } from './agent/hooks/useTranscriptArrival'
import { ChatStatus } from '../chat/ChatMotion'
import { AsidePanel } from './agent/components/AsidePanel'
import { AgentTaskPanel } from './agent/components/AgentTaskPanel'
import { SelectionActions } from './agent/components/SelectionActions'
import { EditFromHereDialog } from './agent/components/EditFromHereDialog'
import { MESSAGE_ACTION_EVENT, type MessageActionDetail } from './agent/components/MessageQuoteActions'
import { PendingSettingsChange } from './agent/components/PendingSettingsChange'
import { PendingSubmission } from './agent/components/PendingSubmission'
import { pendingSubmissionVisible, type PendingSubmission as Submission } from './agent/lib/pendingSubmission'

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
    error,
    setError,
  } = useAgentStream(view.sessionId, visible)
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
  const [configuring, setConfiguring] = useState(false)
  const [pendingSubmission, setPendingSubmission] = useState<Submission | null>(null)
  const showingSubmission = pendingSubmissionVisible(pendingSubmission, sourceEvents, queued)
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
  const [showQuestions, setShowQuestions] = useState(false)
  // Questions float above the message box; the transcript row opens them.
  const [questionDockOpen, setQuestionDockOpen] = useState(true)
  const [questionFocus, setQuestionFocus] = useState<{ requestId: string; at: number } | null>(null)
  const openQuestion = (requestId: string) => setQuestionFocus({ requestId, at: Date.now() })
  const results = useMemo(() => toolResultsOf(events), [events])
  const blocks = useMemo(() => toBlocks(events), [events])
  const claimArrival = useTranscriptArrival(eventSequences, hydrating)
  // Most chats load before a person would notice; only a slow load earns an indicator.
  const [slowHydration, setSlowHydration] = useState(false)
  useEffect(() => {
    setSlowHydration(false)
    if (!hydrating) return
    const timer = window.setTimeout(() => setSlowHydration(true), 400)
    return () => window.clearTimeout(timer)
  }, [hydrating])
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
  const teammates = useMemo(() => activeTeammates(allTasks), [allTasks])
  // Kept on this device for this thread: after talking to a teammate, plain messages keep going to it.
  const [recipientId, setRecipientId] = useState<string | null>(null)
  const recipient = teammates.find((task) => task.agentId === recipientId) ?? null
  const { catalogs } = useModelSets()
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([])
  useEffect(() => {
    if (!viewOnly) void invoke('customAgents.list').then(setCustomAgents, () => {})
  }, [invoke, viewOnly])
  // A device that may only view can talk to no one, so it is offered nothing to bring in either.
  const models = useMemo(() => (viewOnly ? [] : catalogs.flatMap((catalog) => catalog.models)), [catalogs, viewOnly])
  const agents = useMemo(() => (viewOnly ? [] : customAgents), [customAgents, viewOnly])
  // Adding a teammate starts a message to the thread's own model; the composer then shows its settings to change.
  const startTeammate = () => {
    const own =
      session && models.find((m) => m.provider === session.settings.provider && m.id === session.settings.model)
    const model = own ?? models.find((m) => !m.isLegacy) ?? models[0]
    if (!model) return
    const rest = draft.replace(/^@\S+\s*/, '')
    const next = `@${modelHandle(model)} ${rest}`
    setDraft(next)
    requestAnimationFrame(() => focusComposer(root.current, next.length))
  }
  const composerTeammate = useMemo(
    () => ({
      teammates: teammates.map((task) => ({ name: task.name, mode: task.teammate ?? ('review' as const) })),
      models,
      agents,
      mentions: draftMentions(teammates, models, agents),
      ...(viewOnly ? {} : { onAdd: startTeammate }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startTeammate reads the draft and session current at the click
    [teammates, models, agents, viewOnly],
  )
  const joining = useJoiningTeammate({
    draft,
    setDraft,
    base: viewOnly ? undefined : session?.settings,
    teammates,
    models,
    agents,
  })
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
  const providerWait = useMemo(() => providerWaitState(events), [events])
  const reportError = useCallback((reason: unknown) => setError(errorText(reason)), [setError])
  const autoResume = useAutoResume(view.sessionId, session?.settings ?? {}, setSession, reportError)
  // Assigned once the pending-settings helpers exist below; a retry sends a just-chosen login before trying.
  const prepareRetry = useRef<() => Promise<void>>(async () => {})
  const prepareLimitRetry = useCallback(() => prepareRetry.current(), [])
  const limitRetry = useLimitRetry(view.sessionId, providerWait, reportError, prepareLimitRetry)
  const runningTasks = helperSelection.selected.filter(helperActive)
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
  const computerActivity = useComputerActivity(session && !session.parentId ? session.taskId : undefined, visible)
  const [stopping, setStopping] = useState<AgentTask | null>(null)
  const runStopTask = (task: AgentTask) => void act(() => invoke('agent.stopTask', view.sessionId, task.agentId))
  // Background commands are processes, so ending one is confirmed; sub-agents stop at once.
  const stopTask = (task: AgentTask) => (task.taskType === 'local_bash' ? setStopping(task) : runStopTask(task))
  const working = session?.state === 'running' || session?.state === 'starting'
  const compacting = session?.state !== 'stopped' && session?.state !== 'failed' && isCompacting(events)
  const activityLabel = compacting ? 'Compacting context…' : agentActivityLabel(session?.state, events)
  const turns = useMemo(() => toTurns(blocks, events), [blocks, events])
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
  const [continueHost, setContinueHost] = useState<string | null>(null)
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
    if (source) revealFound(source.element)
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
  /** Opens New chat in this chat's project with the quote already in the box. Nothing is sent. */
  const quoteIntoNewChat = (text: string) => {
    const project = ws.task(session?.taskId ?? '')?.projectId ?? NO_PROJECT
    saveDraft(draftKey.newChat(project), `${quoteLines(text)}\n\n`, draftStore(host.id))
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
      const aside = await invoke('aside.ask', view.sessionId, null, '', 'assistant', question)
      const consumed = consumeDraft()
      if (!consumed.persisted)
        notifyError(translate('Message sent, but the local draft could not be cleared.'), 'Draft')
      if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
      setOpenAside({ id: aside.id, quote: aside.quote, from: aside.quoteFrom, keepFocus: true })
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
    // `@lead` (or `@main`) goes to the main agent and makes it the recipient again.
    const lead = /^@(?:lead|main)\s+([\s\S]+)$/i.exec(draft.trim())
    if (lead) setRecipientId(null)
    // `@name` at the start talks to a teammate here, or brings that model or custom agent in with this message;
    // without a mention, a teammate chosen as the recipient gets it.
    const mention = session && !attachments.length && !lead ? resolveMention(draft, teammates, models, agents) : null
    const target =
      mention ??
      (session && recipient && !lead && !attachments.length && draft.trim() && !draft.trim().startsWith('/')
        ? ({ kind: 'teammate', task: recipient, body: draft.trim() } as const)
        : null)
    if (session && target)
      return act(async () => {
        const submitted = draft
        if (target.kind === 'teammate') {
          await invoke('agent.messageTask', view.sessionId, target.task.agentId, target.body)
          setRecipientId(target.task.agentId)
        } else {
          // What the composer showed for this teammate is what it joins with.
          const join = joining && joining.target.kind === target.kind ? joining : null
          const settings =
            join?.settings ??
            (target.kind === 'model' ? teammateSettings(session.settings, target.model) : session.settings)
          const mode = join?.mode ?? (target.kind === 'agent' && !target.agent.readOnly ? 'take-over' : 'review')
          const brief = target.kind === 'agent' ? `${target.agent.instructions}\n\n${target.body}` : target.body
          const joined = await invoke('agent.addTeammate', view.sessionId, settings, mode, brief)
          setRecipientId(joined.agentId)
        }
        const consumed = consumeDraft()
        if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
      }, true)
    const side = /^\/(?:aside|btw)\s+(\S[\s\S]*)$/.exec(draft.trim())
    return side && !attachments.length && !attached.length && !contentAttachments.length
      ? askAside(side[1]!.trim())
      : sendToAgent(mode, context)
  }
  const sendToAgent = (mode: 'queue' | 'steer', context: FileContext[]) =>
    act(async () => {
      const submitted = draft
      const submittedFiles = attachments
      const submittedContent = contentAttachments
      const outgoing = submittedContent.length
        ? `${submitted}${CONTEXT_MARKER}${interactiveAttachmentBlock(submittedContent)}\n</ramu-context>`
        : submitted
      const clearContent = () =>
        setContentAttachments((current) => current.filter((item) => !submittedContent.includes(item)))
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
      stick.current = true
      scrollToEnd.current?.()
      setPendingSubmission({
        text: submitted,
        attachments: submittedFiles,
        afterEvent: sourceEvents.length,
        queuedIds: queued.map((message) => message.id),
      })
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
        const consumed = consumeDraft()
        if (!consumed.persisted)
          notifyError(translate('Message sent, but the local draft could not be cleared.'), 'Draft')
        if (consumed.unchanged) setDraft((current) => (current === submitted ? '' : current))
        setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
        clearContent()
        stick.current = true
      } finally {
        setPendingSubmission(null)
        setConfiguring(false)
      }
    }, true)

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
    claimArrival,
    onOpenAgent: setOpenAgent,
    onStopTask: stopTask,
    onOpenQuestion: openQuestion,
    onReviewAccess: () => setMcpOpen(true),
    onRetry: viewOnly
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
        readOnly={viewOnly}
        tasks={helperSelection.selected}
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
        onContinueOnHost={setContinueHost}
        latestRequest={
          events.findLast(
            (event): event is Extract<typeof event, { kind: 'user' }> => event.kind === 'user' && !event.agentId,
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
              onCancel={() => setConfirmContinue(false)}
              onConfirm={() => void continueInNewChat()}
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
          <ChatMentions.Provider value={composerTeammate.mentions}>
            <ThreadAgents.Provider value={allTasks}>
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
                      className={`scroll-fade-y px-6 pt-3 pb-7 ${showingSubmission ? 'motion-safe:scroll-smooth' : ''}`}
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
                        className={`${hydrating && !turns.length ? 'justify-center' : ''} transcript-col mx-auto max-w-[var(--chat-column-width)] gap-3.5`}
                      >
                        {/* The window already carries the brand; a chat that opens at once shows nothing, a slow one a
                            small spinner. */}
                        {slowHydration && !turns.length && (
                          <div className="flex items-center justify-center text-muted-foreground">
                            <Spinner aria-label={translate('Loading conversation')} />
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
                        {pendingSettings &&
                          session &&
                          !busyAgent &&
                          !settingsMatch(pendingSettings, session.settings) && (
                            <MessageScrollerItem messageId="pending-settings">
                              <PendingSettingsChange
                                next={pendingSettings}
                                previous={session.settings}
                                onCancel={() => setPendingSettings(null)}
                              />
                            </MessageScrollerItem>
                          )}
                        {showingSubmission && pendingSubmission && (
                          <MessageScrollerItem messageId="pending-submission">
                            <PendingSubmission submission={pendingSubmission} />
                          </MessageScrollerItem>
                        )}
                        {activityLabel && (compacting || !statusGroup) && (
                          <ChatStatus label={translate(activityLabel)} compacting={compacting} />
                        )}
                      </MessageScrollerContent>
                    </MessageScrollerViewport>
                    <ScrollToLatestButton working={working} />
                  </MessageScroller>
                  <SelectionActions
                    scroller={scroller}
                    readOnly={viewOnly}
                    onQuote={quoteIntoDraft}
                    onQuoteNew={quoteIntoNewChat}
                    onAside={(quote, from) => setOpenAside({ id: null, quote, from })}
                  />
                </div>
              </MessageScrollerProvider>
            </ThreadAgents.Provider>
          </ChatMentions.Provider>
          <div className="composer-dock [&_.error]:mb-1.5 [&_.error]:text-control flex-none p-[0_calc(16px_+_var(--chat-scrollbar-width,_0px))_10px_16px]">
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
                browserActivity.tabs.length > 0 ||
                !!computerActivity.session ||
                providerWait ||
                liveGoal ||
                queued.length > 0 ||
                pending.length > 0 ||
                (!!session && teammates.length > 0) ||
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
                  {hostOffline && <HostWaitNote name={hostName} />}
                  {session && teammates.length > 0 && (
                    <TeammatesSection
                      sessionId={session.id}
                      teammates={teammates}
                      readOnly={viewOnly}
                      onOpen={(agentId) => setOpenAgent(agentId)}
                    />
                  )}
                  {browserActivity.tabs.length > 0 && <BrowserActivity state={browserActivity} />}
                  <ComputerActivity state={computerActivity} />
                  {backgroundTerminals.terminals.length > 0 && (
                    <BackgroundTerminalsSection state={backgroundTerminals} />
                  )}
                  {providerWait && <ProviderWaitNote retry={limitRetry} autoResume={autoResume} readOnly={viewOnly} />}
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
                  {(queued.length > 0 || pending.length > 0) && (
                    <QueuedMessages
                      sessionId={view.sessionId}
                      queued={queued}
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
                </ComposerTray>
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
                allowEmpty={attached.length > 0}
                chips={
                  <>
                    {!viewOnly && (
                      <RecipientChip teammates={teammates} recipient={recipient} onChange={setRecipientId} />
                    )}
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
                  session &&
                  (joining ? (
                    <TeammateJoinControls joining={joining} disabled={viewOnly} />
                  ) : (
                    <>
                      <AgentControls
                        settings={pendingSettings ?? session.settings}
                        current={session.settings}
                        onChange={changeSettings}
                        disabled={viewOnly}
                        running={working}
                        trailing={<ContextMeter sessionId={view.sessionId} />}
                      />
                    </>
                  ))
                }
                onChange={setDraft}
                onShowQuote={showQuote}
                onArrowUpEmpty={editing || viewOnly ? undefined : editLast}
                chat
                teammate={composerTeammate}
                onSubmit={(context) => send(action, context)}
                onAlternateSubmit={
                  busyAgent && supportsSteering && !hostOffline ? (context) => send(opposite, context) : undefined
                }
                alternateDisabled={configuring || !session}
                alternateLabel={opposite === 'queue' ? 'Queue' : 'Steer'}
                placeholder={
                  hostOffline
                    ? translate('Message · sends when {0} is back', { 0: hostName })
                    : limitView
                      ? limitPlaceholder(limitView, autoResume.effective.value)
                      : joining
                        ? translate('Tell {0} what to do', { 0: joining.name })
                        : recipient
                          ? translate('Message {0}', { 0: recipient.name })
                          : live || busyAgent
                            ? translate('Reply to the agent')
                            : translate('Message the agent')
                }
                submitLabel={
                  hostOffline || limitView ? 'Queue' : busyAgent ? (action === 'queue' ? 'Queue' : 'Steer') : 'Send'
                }
              />
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
              onOpen={setOpenAside}
              onClose={() => setOpenAside(null)}
              onQuote={quoteIntoDraft}
            />
          )}
          {openAgent && (
            <AgentTaskPanel
              tasks={tasks}
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
  )
})
