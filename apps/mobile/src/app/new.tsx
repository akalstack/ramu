import { goBackOrHome } from '../runtime/navigation'
import { translate } from '@ramu/shared/i18n'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type WorktreePlanEntry } from '@ramu/shared/types'
import { routedAgentSettings } from '@ramu/shared/workspace/agentDefaults'
import type { RamuMethods } from '@ramu/shared/api'
import { currentBranchChoice, validBranchName, resolveCheckoutMode } from '@ramu/shared/workspaceDefaults'
import { projectWorkspaces } from '@ramu/shared/workspace/explorer'
import { readWorkspaceChoice, type WorkspaceChoice } from '../runtime/workspaces'
import { useWorkspaces } from '../runtime/useWorkspaces'
import { useAgentDraft } from '../runtime/useAgentDraft'
import { newComposerKey } from '../runtime/composerDrafts'
import { routingChoiceLabels } from '../runtime/routingChoices'
import {
  encodeRouteChoice,
  readRouteChoice,
  opensOnComposer,
  readRoutingSelection,
  routingSelectionKey,
  routingSnapshot,
} from '../runtime/routingDraft'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Keyboard, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  X,
  Folder,
  FolderGit2,
  GitBranch,
  MessageCircle,
  Monitor,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { useT, useSay } from '../i18n'
import { Header, HeaderButton, PageScrollView, Screen } from '../components/Screen'
import { KeyboardCentered, KeyboardPadding, useKeyboardOpen } from '../components/Keyboard'
import { AnimatedMark } from '../components/AnimatedMark'
import { Composer, type ModelChoice } from '../components/Composer'
import { Row, Sheet, T, tap } from '../components/ui'
import { SheetGroup, SheetOption } from '../components/SheetOptions'
import { otherHostTargets } from '../runtime/otherHostTargets'
import { BranchNameControls } from '../components/BranchNameControls'
import { WorkspaceNameSheet } from '../components/WorkspaceNameSheet'

function TrayButton({
  icon: I,
  label,
  onPress,
  prompt,
}: {
  icon: typeof Folder
  label: string
  onPress: () => void
  prompt?: boolean
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 32,
        paddingHorizontal: space.s + 2,
        borderRadius: radius.s,
        backgroundColor: pressed ? c.pressed : prompt ? c.accentWash : 'transparent',
      })}
    >
      <I size={14} color={prompt ? c.accent : c.soft} strokeWidth={1.8} />
      <T size={font.control} weight="500" tone={prompt ? 'accent' : 'soft'} numberOfLines={1}>
        {label}
      </T>
      <ChevronDown size={13} color={c.muted} />
    </Pressable>
  )
}

export default function NewChat({ asTab = false }: { asTab?: boolean } = {}) {
  const say = useSay()
  const keyboardOpen = useKeyboardOpen()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useStore()
  const storeRef = useRef(store)
  storeRef.current = store
  const { projects, computers, createChat, isOnline } = store
  const params = useLocalSearchParams<{
    project?: string
    quote?: string
    computer?: string
    draftContext?: string
    /** A request already begun in the box, such as New page's "Make me a page to". */
    start?: string
  }>()
  const [selected, setHost] = useState(params.computer ?? store.selected)
  // "Quote in new chat" hands the passage over once: it goes into the box, then leaves the route, so removing it there
  // (or coming back to this tab later) does not bring it back.
  const [quoted, setQuoted] = useState<{ text: string; n: number } | undefined>()
  useEffect(() => {
    if (!params.quote) return
    const text = `${params.quote
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n\n`
    setQuoted((current) => ({ text, n: (current?.n ?? 0) + 1 }))
    router.setParams({ quote: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [params.quote] by design; the router is stable
  }, [params.quote])
  useEffect(() => {
    if (!params.start) return
    setQuoted((current) => ({ text: params.start!, n: (current?.n ?? 0) + 1 }))
    router.setParams({ start: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [params.start] by design; the router is stable
  }, [params.start])
  const offline = !isOnline(selected)
  const list = projects.filter((p) => p.computerId === selected)
  // A chat runs in a project's folders, so the project is chosen (by hand or by Auto) rather than defaulted.
  const initialSelection = () =>
    readRoutingSelection(
      store.drafts,
      selected,
      list.map((project) => project.id),
      store.appPreferences[selected]?.autoProjectSelection !== false,
    )
  const [projectId, setProjectId] = useState<string | null>(params.project ?? initialSelection().projectId)
  // Auto picks the project from the first message; an explicit choice always wins for this draft.
  const [auto, setAuto] = useState(!params.project && initialSelection().auto)
  const [choices, setChoices] = useState<{ projectId: string; reason: string }[] | null>(null)
  // The router thought the request starts something new, so No project is the suggestion.
  const [suggestNew, setSuggestNew] = useState(false)
  const pending = useRef<{ text: string; attachments: unknown; context: unknown } | null>(null)
  const routeRevision = useRef(0)
  const routingStart = useRef(false)
  // The message being routed, shown as a temporary thread while a project is chosen.
  const [routing, setRouting] = useState<{ text: string; status: string } | null>(null)
  // Auto also weighs projects on the other online hosts; a prompt that needs several projects is reviewed as a list,
  // kept on the phone until it is started or cancelled.
  const others = otherHostTargets(selected, computers, projects)
  const activeScope = useRef({ host: selected, project: projectId })
  activeScope.current = { host: selected, project: projectId }
  const draftContext = params.computer === selected && params.project === projectId ? params.draftContext : undefined
  const composerKey = newComposerKey(selected, projectId, draftContext)
  const choiceKey = `${composerKey}:workspace`
  const choice = readWorkspaceChoice(store.drafts[choiceKey])
  const manualMode = choice.mode
  const workspaceId = choice.workspaceId
  const chooseWorkspace = (choice: WorkspaceChoice) => {
    store.setDraft(choiceKey, JSON.stringify({ version: 1, ...choice }))
  }
  const catalog = useWorkspaces(selected, !!projectId && projectId !== STANDALONE)
  const workspaces = projectId && projectId !== STANDALONE ? projectWorkspaces(selected, projectId, catalog.rows) : []
  const existingWorkspace = workspaces.find((workspace) => workspace.id === workspaceId)
  const [renamingWorkspace, setRenamingWorkspace] = useState<{
    host: string
    project: string | null
    workspace: { id: string; name: string }
  } | null>(null)
  useEffect(() => {
    setRenamingWorkspace((current) =>
      current && (current.host !== selected || current.project !== projectId) ? null : current,
    )
  }, [selected, projectId])
  const optionsKey = JSON.stringify([selected, projectId])
  const [optionsState, setOptionsState] = useState<{
    key: string
    value: ReturnType<RamuMethods['tasks.workspaceOptions']> | null
    error: string
  }>({ key: optionsKey, value: null, error: '' })
  const workspaceOptions = optionsState.key === optionsKey ? optionsState.value : null
  const optionsError = optionsState.key === optionsKey ? optionsState.error : ''
  const workspaceDefaults = store.appPreferences[selected]
  useEffect(() => {
    let current = true
    let generation = 0
    setOptionsState((current) => (current.key === optionsKey ? current : { key: optionsKey, value: null, error: '' }))
    if (!projectId || projectId === STANDALONE || offline) return
    const read = () => {
      const request = ++generation
      void storeRef.current
        .invoke(selected, 'tasks.workspaceOptions', projectId.slice(projectId.indexOf(':') + 1))
        .then(
          (value) => {
            if (current && request === generation) setOptionsState({ key: optionsKey, value, error: '' })
          },
          (error) => {
            if (current && request === generation)
              setOptionsState({
                key: optionsKey,
                value: null,
                error: String(error instanceof Error ? error.message : error),
              })
          },
        )
    }
    read()
    const off = storeRef.current.subscribe(selected, (...[channel]) => {
      if (channel === 'workspace:changed' || channel === 'settings:changed') read()
    })
    return () => {
      current = false
      off()
    }
  }, [
    selected,
    projectId,
    optionsKey,
    offline,
    workspaceDefaults?.defaultCheckoutMode,
    workspaceDefaults?.worktreeBranchNaming,
    workspaceDefaults?.worktreeBranchPrefix,
    workspaceDefaults?.worktreeBranchInstructions,
  ])
  const resolution = resolveCheckoutMode({
    defaultMode:
      workspaceOptions?.defaultCheckoutMode ?? store.appPreferences[selected]?.defaultCheckoutMode ?? 'current',
    manual: manualMode,
    workspaceId,
    projectFree: projectId === STANDALONE,
    worktreeUnavailable: workspaceOptions?.worktreeUnavailable,
  })
  const mode = resolution.mode
  const draftText = store.drafts[composerKey] ?? ''
  const routeChoiceKey = `${composerKey}:routing-choice`
  const routeSnapshot = routingSnapshot(store.drafts, composerKey)
  // A pending routing answer belongs to the exact message, destination and host it was asked for.
  useEffect(() => {
    routeRevision.current++
    const restored =
      auto && !projectId
        ? readRouteChoice(
            store.drafts[routeChoiceKey],
            routeSnapshot,
            list.map((project) => project.id.slice(project.id.indexOf(':') + 1)),
          )
        : null
    pending.current = restored
    setChoices(restored?.candidates ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [routeSnapshot, projectId, auto, selected] by design; the values it reads beyond these are current as of that run
  }, [routeSnapshot, projectId, auto, selected])
  const branchTitle = draftText.split('\n')[0]!.slice(0, 60) || 'Discuss attachments'
  const namingIntent = {
    strategy: workspaceOptions?.branchNaming ?? workspaceDefaults?.worktreeBranchNaming ?? 'fixed',
    instructions: workspaceOptions?.branchInstructions ?? workspaceDefaults?.worktreeBranchInstructions ?? '',
    prompt: draftText.slice(0, 6000),
  }
  const branchPrefix = workspaceOptions?.branchPrefix ?? workspaceDefaults?.worktreeBranchPrefix ?? 'ramu/'
  const branchChoice = currentBranchChoice(choice.branch, branchTitle, namingIntent)
  const reviewKey = JSON.stringify([selected, projectId, branchTitle, namingIntent, branchPrefix, branchChoice])
  const [reviewed, setReviewed] = useState<{ key: string; plan: WorktreePlanEntry[] } | null>(null)
  type Picker = 'project' | 'mode' | 'host' | 'choice' | null
  const [picker, setPickerState] = useState<Picker>(() =>
    opensOnComposer({ project: params.project, auto, offline, projects: list.length }) ? null : 'project',
  )
  // The picker the screen opened on is only a default until someone chooses it.
  const pickerChosen = useRef(false)
  const setPicker = (next: Picker) => {
    pickerChosen.current = true
    if (next) Keyboard.dismiss()
    setPickerState(next)
  }
  // The tab mounts before its host connects, so Auto's composer becomes reachable only once the host and projects load.
  const composerReady = opensOnComposer({ project: params.project, auto, offline, projects: list.length })
  useEffect(() => {
    if (composerReady && !pickerChosen.current) setPickerState((current) => (current === 'project' ? null : current))
  }, [composerReady])
  useEffect(() => {
    if (choices?.length) {
      Keyboard.dismiss()
      setPickerState('choice')
    }
  }, [choices])
  // Starts on the computer's default model step (Settings › Models), like the desktop; a pick here overrides it.
  const preset = store.defaults[selected]
  const agentDraft = useAgentDraft(selected, projectId, composerKey, preset ?? DEFAULT_AGENT_SETTINGS, !!preset)
  const asModelChoice = (value: AgentSettings): ModelChoice => ({
    provider: value.provider,
    model: value.model,
    effort: value.effort ?? '',
    settings: {
      access: value.access,
      autoFallback: value.autoFallback,
      serviceTier: value.serviceTier,
      accountId: value.accountId,
    },
  })
  const model = asModelChoice(agentDraft.settings)
  const chooseModel = (next: ModelChoice) =>
    agentDraft.change({
      ...agentDraft.settings,
      ...next.settings,
      provider: next.provider,
      model: next.model,
      effort: (next.effort || null) as AgentSettings['effort'],
      ...(next.provider !== model.provider ? { accountId: undefined, serviceTier: 'standard' as const } : {}),
    })
  const project = list.find((p) => p.id === projectId)
  const rawId = (id: string) => id.slice(id.indexOf(':') + 1)
  type Send = Parameters<NonNullable<React.ComponentProps<typeof Composer>['onSend']>>
  /** A project on another online host: the thread starts there, as it would here, and opens. Text only. */
  const startElsewhere = async (id: string, text: string, settings: AgentSettings) => {
    const target = others.targets.get(id)
    if (!target) throw new Error('That host is no longer online.')
    const started = await storeRef.current.invoke(
      target.computerId,
      'threads.startInProject',
      { projectId: target.projectId, title: text.trim().split('\n')[0]!.slice(0, 80) || 'New thread', prompt: text },
      settings,
    )
    if (started.error || !started.taskId) throw new Error(started.error || 'The thread did not start.')
    setPicker(null)
    const drafts = storeRef.current.drafts
    if ((drafts[composerKey] ?? '') === text) {
      storeRef.current.clearComposerDraft(composerKey, {
        text,
        attachments: drafts[`${composerKey}:attachments`] ?? '[]',
        context: drafts[`${composerKey}:context`] ?? '[]',
        mentions: drafts[`${composerKey}:mentions`] ?? '[]',
      })
      agentDraft.consume()
    }
    await storeRef.current.refresh(target.computerId, true)
    router.replace({
      pathname: '/chat/[id]',
      params: { id: storeRef.current.resolveChat(target.computerId, started.taskId) },
    })
  }
  /** Routes the first message, then starts the thread in the chosen project, or asks when no single project fits. */
  const startInAuto = async (
    text: string,
    attachments: Send[2],
    context: Send[3],
    destination?: string,
  ): Promise<void | false> => {
    if (routingStart.current) return false
    routingStart.current = true
    try {
      if (offline) {
        setAuto(false)
        setPicker('project')
        throw new Error('Choose a project to start while this host is offline.')
      }
      setRouting({ text, status: say('Choosing a project…') })
      const revision = ++routeRevision.current
      const verified = await agentDraft.verify()
      if (revision !== routeRevision.current)
        throw new Error('The message changed while choosing a project. Send again.')
      let raw = destination
      if (!raw) {
        const outcome = await storeRef.current.invoke(selected, 'projects.route', text, verified, {
          others: others.candidates,
          localHost: computers.find((x) => x.id === selected)?.name,
        })
        if (revision !== routeRevision.current)
          throw new Error('The message changed while choosing a project. Send again.')
        if (outcome.kind === 'resolved' && others.targets.has(outcome.projectId)) {
          await startElsewhere(outcome.projectId, text, verified)
          return
        }
        if (outcome.kind === 'resolved') {
          raw = outcome.projectId
          const name = list.find((p) => rawId(p.id) === raw)?.name ?? ''
          setRouting((current) => current && { ...current, status: say('Starting in {0}…', { 0: name }) })
        } else {
          // Something new may belong to no project yet; No project is offered first and the person decides.
          setSuggestNew(outcome.kind === 'new' || (outcome.kind === 'unavailable' && outcome.reason === 'no-projects'))
          const candidates =
            outcome.kind === 'ambiguous'
              ? outcome.candidates
              : list.filter((p) => rawId(p.id) !== STANDALONE).map((p) => ({ projectId: rawId(p.id), reason: '' }))
          pending.current = { text, attachments, context }
          setChoices(candidates)
          storeRef.current.setDraft(
            routeChoiceKey,
            encodeRouteChoice({
              draft: routingSnapshot(storeRef.current.drafts, composerKey),
              text,
              attachments: attachments ?? [],
              context: context ?? [],
              candidates,
            }),
          )
          setPicker('choice')
          return false
        }
      }
      if (raw === STANDALONE) {
        // No project: nothing to check out and no project defaults, as when No project is picked by hand.
        const id = await createChat({
          computerId: selected,
          projectId: STANDALONE,
          text,
          mode: 'current',
          workspaceId: undefined,
          attachments,
          context,
          ...asModelChoice(verified),
        })
        setChoices(null)
        pending.current = null
        storeRef.current.setDraft(routeChoiceKey, '')
        if (storeRef.current.drafts[composerKey] === text) agentDraft.consume()
        if (asTab) router.push({ pathname: '/chat/[id]', params: { id } })
        else router.replace({ pathname: '/chat/[id]', params: { id } })
        return
      }
      const destinationProject = list.find((p) => rawId(p.id) === raw)
      if (!destinationProject) throw new Error('That project is no longer available. Choose a project.')
      // The destination's repository model defaults apply as if the project had been picked by hand.
      const base = preset ?? DEFAULT_AGENT_SETTINGS
      const destinationDefaults = agentDraft.choice.selection
        ? undefined
        : await storeRef.current.invoke(selected, 'tasks.agentDefaults', raw, base.provider)
      const routed = routedAgentSettings(base, destinationDefaults, agentDraft.choice)
      if (!routed) {
        // Stay in Auto so the draft remains visible; a model chosen here then wins over the project default.
        throw new Error(`${destinationProject.name}'s model default can't be used. Choose a model, then send again.`)
      }
      const sendModel = asModelChoice(routed)
      const options = await storeRef.current.invoke(selected, 'tasks.workspaceOptions', raw)
      const checkout = resolveCheckoutMode({
        defaultMode: options.defaultCheckoutMode ?? 'current',
        manual: null,
        workspaceId: null,
        projectFree: false,
        worktreeUnavailable: options.worktreeUnavailable,
      })
      if (checkout.blocked) throw new Error(checkout.reason ?? 'Worktree unavailable')
      const intent = {
        strategy: options.branchNaming ?? 'fixed',
        instructions: options.branchInstructions ?? '',
        prompt: text.slice(0, 6000),
      }
      const branch = currentBranchChoice(undefined, text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments', intent)
      if (checkout.mode === 'worktree' && branch && !validBranchName(branch.name)) throw new Error(t.branchNameInvalid)
      if (revision !== routeRevision.current)
        throw new Error('The message changed while choosing a project. Send again.')
      const id = await createChat({
        computerId: selected,
        projectId: destinationProject.id,
        text,
        mode: checkout.mode,
        // The project-free draft's workspace belongs to another scope; routed threads use the destination default.
        workspaceId: undefined,
        branchNaming: intent,
        branchChoice: branch,
        branchPrefix: options.branchPrefix ?? 'ramu/',
        attachments,
        context,
        ...sendModel,
      })
      setChoices(null)
      pending.current = null
      storeRef.current.setDraft(routeChoiceKey, '')
      if (storeRef.current.drafts[composerKey] === text) agentDraft.consume()
      if (asTab) router.push({ pathname: '/chat/[id]', params: { id } })
      else router.replace({ pathname: '/chat/[id]', params: { id } })
    } finally {
      routingStart.current = false
      setRouting(null)
    }
  }
  const pc = computers.find((x) => x.id === selected)
  const choiceLabels = routingChoiceLabels([
    ...list.map((p) => ({ id: rawId(p.id), name: p.name, host: pc?.name ?? selected, root: p.root })),
    ...[...others.targets].map(([id, target]) => ({
      id,
      name: target.name,
      host: target.hostName,
      root: null,
    })),
  ])

  const projectPicker = (
    <>
      {computers.length > 1 ? (
        <Row onPress={() => setPicker('host')}>
          <Monitor size={17} color={c.soft} />
          <T numberOfLines={1}>{pc?.name ?? t.computers}</T>
          <ChevronDown size={14} color={c.muted} />
        </Row>
      ) : null}
      {store.appPreferences[selected]?.autoProjectSelection !== false ? (
        <Row
          onPress={() => {
            setProjectId(null)
            setAuto(true)
            store.setDraft(routingSelectionKey(selected), JSON.stringify({ version: 1, auto: true, projectId: null }))
            setPicker(null)
          }}
        >
          {/* Auto is a choice, not a folder: the same sparkle as the project menu's "Names for Auto…". */}
          <Sparkles size={17} color={c.soft} />
          <View style={{ flex: 1 }}>
            <T weight="500">{translate(store.language, 'Auto')}</T>
            <T size={font.caption} tone="muted">
              {translate(store.language, 'Pick the project from your first message')}
            </T>
          </View>
          {auto && projectId === null ? <Check size={16} color={c.accent} /> : null}
        </Row>
      ) : null}
      {list.map((p) => (
        <Row
          key={p.id}
          onPress={() => {
            setProjectId(p.id)
            setAuto(false)
            store.setDraft(routingSelectionKey(selected), JSON.stringify({ version: 1, auto: false, projectId: p.id }))
            setPicker(null)
          }}
        >
          {p.kind === 'workspace' ? <Folder size={17} color={c.soft} /> : <FolderGit2 size={17} color={c.soft} />}
          <View style={{ flex: 1 }}>
            <T weight="500">{p.name}</T>
            <T size={font.caption} tone="muted">
              {p.root}
            </T>
          </View>
          {p.id === projectId ? <Check size={16} color={c.accent} /> : null}
        </Row>
      ))}
      <Row
        onPress={() => {
          setProjectId(STANDALONE)
          setAuto(false)
          store.setDraft(
            routingSelectionKey(selected),
            JSON.stringify({ version: 1, auto: false, projectId: STANDALONE }),
          )
          setPicker(null)
        }}
      >
        <MessageCircle size={17} color={c.soft} />
        <View style={{ flex: 1 }}>
          <T weight="500">Standalone</T>
          <T size={font.caption} tone="muted">
            No project folder
          </T>
        </View>
        {projectId === STANDALONE ? <Check size={16} color={c.accent} /> : null}
      </Row>
      <Row
        onPress={() => {
          setPicker(null)
          store.select(selected)
          router.push('/folders')
        }}
      >
        <Monitor size={17} color={c.muted} />
        <T tone="muted">Add a folder on {pc?.name}…</T>
      </Row>
    </>
  )

  return (
    <Screen bg="window" scrollable={false}>
      <Header
        back={!asTab && picker === 'project'}
        left={
          picker !== 'project' ? (
            <HeaderButton
              icon={ChevronLeft}
              systemIcon="chevron.left"
              actionId="new-thread-back"
              label={store.language === 'id' ? 'Kembali ke proyek' : 'Back to projects'}
              onPress={() => setPicker('project')}
            />
          ) : undefined
        }
        right={
          <HeaderButton
            icon={X}
            systemIcon="xmark"
            actionId="new-thread-close"
            label={store.language === 'id' ? 'Tutup' : 'Close'}
            onPress={() => {
              Keyboard.dismiss()
              if (asTab) router.navigate('/')
              else goBackOrHome(router)
            }}
          />
        }
        scrollEdge={picker === 'project'}
        align="center"
        title={picker === 'project' ? (store.language === 'id' ? 'Pilih proyek' : 'Choose a project') : t.newChat}
      />
      {picker === 'project' ? (
        <PageScrollView
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, space.l) }}
        >
          {projectPicker}
        </PageScrollView>
      ) : null}
      <KeyboardPadding style={{ flex: 1, display: picker === 'project' ? 'none' : 'flex' }}>
        {/* Nothing here scrolls: the hero simply centers in the space above the composer. */}
        {routing ? (
          <View
            style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'flex-end', padding: space.l, gap: space.s }}
            accessibilityLiveRegion="polite"
          >
            {routing.text ? (
              <View
                style={{
                  maxWidth: '85%',
                  backgroundColor: c.bubble,
                  borderRadius: radius.l,
                  paddingHorizontal: space.m,
                  paddingVertical: space.s,
                }}
              >
                <T numberOfLines={8}>{routing.text}</T>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <ActivityIndicator size="small" color={c.muted} />
              <T tone="muted" size={font.caption}>
                {routing.status}
              </T>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: space.l }}>
            {/* The desktop's start screen: the animated mark (tap it) over the same question, centred. One size with the
                keyboard up or down: only its place moves, with the space the keyboard leaves, so nothing flickers. */}
            <KeyboardCentered>
              <View style={{ alignItems: 'center', gap: space.s }}>
                <View style={{ marginBottom: space.s }}>
                  <AnimatedMark size={48} />
                </View>
                <T size={font.hero - 4} weight="600" style={{ letterSpacing: -0.5, textAlign: 'center' }}>
                  {project ? `What should we work on in ${project.name}?` : 'What should we work on?'}
                </T>
              </View>
            </KeyboardCentered>
          </View>
        )}
        <View style={{ paddingBottom: Math.max(insets.bottom, space.s) + (asTab && !keyboardOpen ? space.m : 0) }}>
          <Composer
            key={composerKey}
            running={false}
            restore={quoted}
            autoFocus={picker === null && (projectId !== null || auto)}
            header={
              <>
                {computers.length > 1 && (
                  <TrayButton icon={Monitor} label={pc?.name ?? t.computers} onPress={() => setPicker('host')} />
                )}
                <TrayButton
                  prompt={projectId === null && !auto}
                  icon={
                    project
                      ? project.kind === 'workspace'
                        ? Folder
                        : FolderGit2
                      : projectId === STANDALONE
                        ? MessageCircle
                        : Folder
                  }
                  label={
                    project?.name ?? (projectId === STANDALONE ? 'Standalone' : auto ? 'Auto' : 'Choose a project')
                  }
                  onPress={() => setPicker(choices?.length ? 'choice' : 'project')}
                />
                {project ? (
                  <TrayButton
                    icon={GitBranch}
                    label={
                      workspaceId
                        ? (existingWorkspace?.name ?? choice.name ?? t.existingWorkspace)
                        : mode === 'current'
                          ? t.currentCheckout
                          : t.isolatedWorktree
                    }
                    onPress={() => setPicker('mode')}
                  />
                ) : null}
              </>
            }
            draftKey={composerKey}
            computerId={selected}
            scope={
              projectId && projectId !== STANDALONE
                ? workspaceId
                  ? `worktree:${workspaceId}`
                  : `project:${projectId.slice(projectId.indexOf(':') + 1)}`
                : undefined
            }
            offline={offline}
            placeholder={
              offline ? `What should the agent do? Sends when ${pc?.name ?? 'it'} is back` : t.newPlaceholder
            }
            model={model}
            onModel={chooseModel}
            onSend={async (text, _mode, attachments, context) => {
              if (projectId === null && auto) return startInAuto(text, attachments, context)
              if (projectId === null) {
                setPicker('project')
                throw new Error('Choose a project first.')
              }
              if (offline && projectId !== STANDALONE && !store.appPreferences[selected] && manualMode === null)
                throw new Error(
                  'Connect to this host to load its workspace default, or explicitly choose Current checkout.',
                )
              if (workspaceId && !offline && !existingWorkspace) throw new Error(t.workspaceUnavailable)
              if (resolution.blocked) throw new Error(resolution.reason ?? 'Worktree unavailable')
              if (!offline && !workspaceId && projectId !== STANDALONE && !workspaceOptions && manualMode !== 'current')
                throw new Error(optionsError ? t.workspaceSettingsFailed : t.loadingWorkspaces)
              const sendIntent = { ...namingIntent, prompt: text.slice(0, 6000) }
              const sendChoice = currentBranchChoice(
                choice.branch,
                text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments',
                sendIntent,
              )
              if (mode === 'worktree' && !workspaceId && sendChoice && !validBranchName(sendChoice.name)) {
                setPicker('mode')
                throw new Error(t.branchNameInvalid)
              }
              const sendModel = asModelChoice(await agentDraft.verify())
              const id = await createChat({
                computerId: selected,
                projectId,
                text,
                mode,
                workspaceId,
                branchNaming: sendIntent,
                branchChoice: sendChoice,
                reviewedPlan:
                  reviewed?.key ===
                  JSON.stringify([
                    selected,
                    projectId,
                    text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments',
                    sendIntent,
                    branchPrefix,
                    sendChoice,
                  ])
                    ? reviewed.plan
                    : undefined,
                branchPrefix,
                attachments,
                context,
                ...sendModel,
              })
              if (storeRef.current.drafts[composerKey] === text) agentDraft.consume()
              if (asTab) router.push({ pathname: '/chat/[id]', params: { id } })
              else router.replace({ pathname: '/chat/[id]', params: { id } })
            }}
          />
        </View>
      </KeyboardPadding>

      <Sheet open={picker === 'host'} onClose={() => setPicker(null)} title={t.computers}>
        <SheetGroup>
          {computers.map((computer) => (
            <SheetOption
              key={computer.id}
              icon={Monitor}
              title={computer.name}
              help={t[computer.status]}
              selected={computer.id === selected}
              disabled={computer.status === 'revoked'}
              onPress={() => {
                if (computer.id !== selected) {
                  const choice = readRoutingSelection(
                    store.drafts,
                    computer.id,
                    projects.filter((project) => project.computerId === computer.id).map((project) => project.id),
                    store.appPreferences[computer.id]?.autoProjectSelection !== false,
                  )
                  setHost(computer.id)
                  setProjectId(choice.projectId)
                  setAuto(choice.auto)
                }
                setPicker('project')
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
      <Sheet open={picker === 'choice'} onClose={() => setPicker(null)} title={say('Choose a project')}>
        <SheetGroup
          footer={say(
            choices?.some((choice) => choice.reason)
              ? 'More than one project could fit. Choose where to start.'
              : suggestNew
                ? 'This looks like something new. Choose where to start.'
                : 'No project matched. Choose where to start.',
          )}
        >
          {choices?.some((choice) => choice.reason) ? null : (
            <SheetOption
              icon={MessageCircle}
              title={say('Standalone')}
              help={
                suggestNew
                  ? say('Suggested · something new that needs no project yet')
                  : say('Something new that needs no project yet')
              }
              onPress={() => {
                const request = pending.current
                setPicker(null)
                if (request)
                  void startInAuto(
                    request.text,
                    request.attachments as Send[2],
                    request.context as Send[3],
                    STANDALONE,
                  ).catch(() => setPicker('choice'))
              }}
            />
          )}
          {choices?.map((choice) => {
            const match = list.find((p) => rawId(p.id) === choice.projectId)
            const remote = others.targets.get(choice.projectId)
            if (!match && remote)
              return (
                <SheetOption
                  key={choice.projectId}
                  icon={Folder}
                  title={choiceLabels.get(choice.projectId)?.label ?? remote.name}
                  help={choice.reason || undefined}
                  onPress={() => {
                    const request = pending.current
                    if (!request) return
                    void agentDraft
                      .verify()
                      .then((verified) => startElsewhere(choice.projectId, request.text, verified))
                      .catch((error) => Alert.alert(String(error instanceof Error ? error.message : error)))
                  }}
                />
              )
            if (!match) return null
            const label = choiceLabels.get(choice.projectId)
            return (
              <SheetOption
                key={choice.projectId}
                icon={Folder}
                title={label?.label ?? match.name}
                help={choice.reason || (!label?.showsRoot ? match.root : undefined) || undefined}
                onPress={() => {
                  const request = pending.current
                  setPicker(null)
                  if (request)
                    void startInAuto(
                      request.text,
                      request.attachments as Send[2],
                      request.context as Send[3],
                      choice.projectId,
                    ).catch(() => setPicker('choice'))
                }}
              />
            )
          })}
        </SheetGroup>
        <SheetGroup>
          <SheetOption icon={Search} title={say('Choose another project')} onPress={() => setPicker('project')} />
        </SheetGroup>
      </Sheet>

      <Sheet open={picker === 'mode'} onClose={() => setPicker(null)} title={say('Workspace')}>
        {workspaceOptions?.configSource ? <T tone="muted">{workspaceOptions.configSource}</T> : null}
        {workspaceOptions?.configError ? <T tone="bad">{workspaceOptions.configError}</T> : null}
        {resolution.reason ? (
          <T
            tone={resolution.blocked ? 'bad' : 'muted'}
            style={{ paddingHorizontal: space.l + 4, paddingBottom: space.s }}
          >
            {resolution.reason}
          </T>
        ) : null}
        <SheetGroup>
          {(
            [
              ['current', 'Current checkout', 'Work directly in the folders on disk.', Folder],
              ['worktree', 'Isolated worktrees', 'A new branch and worktree per repository.', GitBranch],
            ] as const
          ).map(([value, label, hint, icon]) => {
            // A mode that cannot be used says why in place instead of silently doing nothing.
            const why =
              value !== 'worktree'
                ? null
                : projectId === STANDALONE
                  ? t.worktreeNeedsProject
                  : offline && !workspaceOptions
                    ? t.worktreeCheckOffline
                    : (workspaceOptions?.worktreeUnavailable ?? null)
            return (
              <SheetOption
                key={value}
                icon={icon}
                title={say(label)}
                help={why ?? say(hint)}
                disabled={Boolean(why) && manualMode !== value}
                selected={!workspaceId && manualMode === value}
                onPress={() => {
                  chooseWorkspace({ mode: value, branch: choice.branch })
                  setPicker(null)
                }}
              />
            )
          })}
        </SheetGroup>
        <SheetGroup>
          <SheetOption
            icon={RotateCcw}
            title={say('Use default')}
            help={
              (workspaceOptions?.defaultCheckoutMode ?? store.appPreferences[selected]?.defaultCheckoutMode) ===
              'worktree'
                ? say('New worktree')
                : say('Current checkout')
            }
            selected={!workspaceId && manualMode === null}
            onPress={() => {
              chooseWorkspace({ mode: null, branch: choice.branch })
              setPicker(null)
            }}
          />
        </SheetGroup>
        {optionsError ? <T tone="muted">{t.workspaceSettingsFailed}</T> : null}
        {mode === 'worktree' && !workspaceId && reviewed?.key === reviewKey ? (
          <Row onPress={() => setReviewed(null)}>
            <T>{t.branchBasesKept}</T>
            <T tone="accent">{t.branchClearBases}</T>
          </Row>
        ) : null}
        {mode === 'worktree' && !workspaceId && picker === 'mode' && projectId ? (
          <BranchNameControls
            key={choiceKey}
            host={selected}
            projectId={projectId.slice(projectId.indexOf(':') + 1)}
            title={branchTitle}
            intent={namingIntent}
            branchPrefix={branchPrefix}
            choice={branchChoice}
            online={!offline}
            onReview={(plan) => setReviewed({ key: reviewKey, plan })}
            onChange={(candidate) =>
              chooseWorkspace({
                ...choice,
                branch: candidate ? { title: branchTitle, intent: namingIntent, choice: candidate } : undefined,
              })
            }
          />
        ) : null}
        {catalog.loading ? <T tone="muted">{t.loadingWorkspaces}</T> : null}
        {catalog.error ? <T tone="muted">{t.workspacesLoadFailed}</T> : null}
        {workspaces.map((workspace) => (
          <Row
            key={workspace.id}
            onPress={() => {
              chooseWorkspace({ mode: 'worktree', workspaceId: workspace.id, name: workspace.name })
              setPicker(null)
            }}
          >
            <GitBranch size={17} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="500">{workspace.name}</T>
              <T tone="muted" size={font.caption}>
                {t.existingWorkspace}
              </T>
            </View>
            {workspaceId === workspace.id ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
        {existingWorkspace ? (
          <Row
            disabled={offline}
            accessibilityState={{ disabled: offline }}
            onPress={() => {
              if (offline) return
              setPicker(null)
              setRenamingWorkspace({ host: selected, project: projectId, workspace: existingWorkspace })
            }}
          >
            <Pencil size={17} color={c.soft} />
            <T>{t.renameWorkspace}</T>
          </Row>
        ) : null}
        {workspaceId && !offline && !catalog.loading && !existingWorkspace ? (
          <T tone="bad">{t.workspaceUnavailable}</T>
        ) : null}
      </Sheet>
      {renamingWorkspace?.host === selected && renamingWorkspace.project === projectId ? (
        <WorkspaceNameSheet
          key={`${selected}:${renamingWorkspace.workspace.id}`}
          workspace={renamingWorkspace.workspace}
          online={!offline}
          onSave={async (name, before) => {
            await store.invoke(
              renamingWorkspace.host,
              'workspaces.rename',
              renamingWorkspace.workspace.id,
              name,
              before,
            )
            if (
              activeScope.current.host === renamingWorkspace.host &&
              activeScope.current.project === renamingWorkspace.project
            )
              catalog.refresh()
          }}
          onClose={() => {
            setRenamingWorkspace((current) => (current === renamingWorkspace ? null : current))
            if (
              activeScope.current.host === renamingWorkspace.host &&
              activeScope.current.project === renamingWorkspace.project
            )
              setPicker('mode')
          }}
        />
      ) : null}
    </Screen>
  )
}
