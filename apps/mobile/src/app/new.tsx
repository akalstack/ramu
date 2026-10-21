import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type WorktreePlanEntry } from '@ramu/shared/types'
import type { RamuMethods } from '@ramu/shared/api'
import { currentBranchChoice, validBranchName, resolveCheckoutMode } from '@ramu/shared/workspaceDefaults'
import { projectWorkspaces } from '@ramu/shared/workspace/explorer'
import { readWorkspaceChoice, type WorkspaceChoice } from '../runtime/workspaces'
import { useWorkspaces } from '../runtime/useWorkspaces'
import { useAgentDraft } from '../runtime/useAgentDraft'
import { isMethodMissing } from '../runtime/goalVerify'
import { newComposerKey } from '../runtime/composerDrafts'
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Check,
  ChevronDown,
  Folder,
  FolderGit2,
  GitBranch,
  MessageCircle,
  Monitor,
  Files,
  Pencil,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { useT } from '../i18n'
import { Header, Screen } from '../components/Screen'
import { useKeyboardInset } from '../components/Keyboard'
import { AnimatedMark } from '../components/AnimatedMark'
import { Composer, type ModelChoice } from '../components/Composer'
import { Button, Row, Sheet, T, tap } from '../components/ui'
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

export default function NewChat() {
  const keyboardInset = useKeyboardInset()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useStore()
  const storeRef = useRef(store)
  storeRef.current = store
  const { projects, computers, createChat, isOnline } = store
  const params = useLocalSearchParams<{ project?: string; quote?: string; computer?: string; draftContext?: string }>()
  const [selected, setHost] = useState(params.computer ?? store.selected)
  const offline = !isOnline(selected)
  const list = projects.filter((p) => p.computerId === selected)
  // A chat runs in a project's folders, so the project is chosen first rather than defaulted.
  const [projectId, setProjectId] = useState<string | null>(params.project ?? null)
  // Auto picks the project from the first message; an explicit choice always wins for this draft.
  const [auto, setAuto] = useState(
    !params.project && store.appPreferences[store.selected]?.autoProjectSelection !== false,
  )
  const [choices, setChoices] = useState<{ projectId: string; reason: string }[] | null>(null)
  const pending = useRef<{ text: string; attachments: unknown; context: unknown } | null>(null)
  const routeRevision = useRef(0)
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
    unsupported?: boolean
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
                unsupported: isMethodMissing(error),
              })
          },
        )
    }
    read()
    const off = storeRef.current.subscribe(selected, (channel) => {
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
  // A pending routing answer belongs to the exact message, destination and host it was asked for.
  useEffect(() => {
    routeRevision.current++
    setChoices(null)
  }, [draftText, projectId, auto, selected])
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
  const [picker, setPicker] = useState<'project' | 'mode' | 'host' | 'choice' | null>(null)
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
  const modelNotice =
    !preset && agentDraft.blocked
      ? t.projectModelHostUnknown
      : agentDraft.choice.selection
        ? t.projectModelManual
        : agentDraft.invalid
          ? t.projectModelInvalid
          : !preset
            ? t.projectModelHostUnknown
            : agentDraft.loading
              ? t.projectModelLoading
              : agentDraft.unsupported
                ? t.projectModelUnsupported
                : agentDraft.defaults?.status === 'invalid'
                  ? t.projectModelConfigInvalid
                  : agentDraft.defaults?.reason === 'provider'
                    ? t.projectModelProviderUnavailable
                    : agentDraft.defaults?.reason === 'model'
                      ? t.projectModelUnavailable
                      : agentDraft.error || agentDraft.defaults?.reason === 'catalog'
                        ? t.projectModelCatalogFailed
                        : t.projectModelDefault
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
  /** Routes the first message, then starts the thread in the chosen project, or asks when no single project fits. */
  const startInAuto = async (
    text: string,
    attachments: Send[2],
    context: Send[3],
    destination?: string,
  ): Promise<void> => {
    if (offline) {
      setAuto(false)
      setPicker('project')
      throw new Error('Choose a project to start while this host is offline.')
    }
    const revision = ++routeRevision.current
    const verified = await agentDraft.verify()
    const sendModel = asModelChoice(verified)
    let raw = destination
    if (!raw) {
      let outcome: Awaited<ReturnType<RamuMethods['projects.route']>>
      try {
        outcome = await storeRef.current.invoke(selected, 'projects.route', text, verified)
      } catch (error) {
        if (!isMethodMissing(error)) throw error
        setAuto(false)
        setPicker('project')
        throw new Error('This host cannot choose a project automatically. Choose one.', { cause: error })
      }
      if (revision !== routeRevision.current)
        throw new Error('The message changed while choosing a project. Send again.')
      if (outcome.kind === 'resolved') raw = outcome.projectId
      else {
        pending.current = { text, attachments, context }
        setChoices(
          outcome.kind === 'ambiguous' ? outcome.candidates : list.map((p) => ({ projectId: rawId(p.id), reason: '' })),
        )
        setPicker('choice')
        return
      }
    }
    const destinationProject = list.find((p) => rawId(p.id) === raw)
    if (!destinationProject) throw new Error('That project is no longer available. Choose a project.')
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
    const id = await createChat({
      computerId: selected,
      projectId: destinationProject.id,
      text,
      mode: checkout.mode,
      workspaceId,
      branchNaming: intent,
      branchChoice: branch,
      branchPrefix: options.branchPrefix ?? 'ramu/',
      attachments,
      context,
      ...sendModel,
    })
    setChoices(null)
    if (storeRef.current.drafts[composerKey] === text) agentDraft.consume()
    router.replace({ pathname: '/chat/[id]', params: { id } })
  }
  const pc = computers.find((x) => x.id === selected)
  useEffect(() => {
    // Let the sheet finish presenting before the picker slides up over it.
    if (params.project || auto) return
    const timer = setTimeout(() => setPicker('project'), 450)
    return () => clearTimeout(timer)
  }, [params.project, auto])

  return (
    <Screen bg="canvas" scrollable={false}>
      <Header modal title={t.newChat} subtitle={pc?.name} />
      <View style={{ flex: 1, paddingBottom: keyboardInset }}>
        {/* Nothing here scrolls: the hero simply centers in the space above the composer. */}
        <View style={{ flex: 1, justifyContent: 'center', padding: space.l }}>
          <View style={{ alignItems: 'center', gap: space.s }}>
            {/* The desktop's start screen: the animated mark (tap it) over the same question. */}
            <View style={{ marginBottom: space.s }}>
              <AnimatedMark size={56} />
            </View>
            <T size={font.hero} weight="600" style={{ letterSpacing: -0.5, textAlign: 'center' }}>
              {project ? `What should we work on in ${project.name}?` : 'What should we work on?'}
            </T>
            <T tone="muted" style={{ textAlign: 'center' }}>
              {offline
                ? `${pc?.name} is offline. The thread waits in the outbox and starts when it reconnects.`
                : `Runs on ${pc?.name} with your host's providers.`}
            </T>
          </View>
        </View>
        <View style={{ paddingBottom: Math.max(insets.bottom, space.s) }}>
          {agentDraft.defaults?.requested ||
          agentDraft.blocked ||
          agentDraft.choice.selection ||
          agentDraft.unsupported ? (
            <View style={{ paddingHorizontal: space.m, gap: space.s }}>
              <T tone="muted" size={font.caption}>
                {modelNotice}
              </T>
              {agentDraft.defaults?.requested ? (
                <T tone="muted" size={font.caption}>
                  {`${agentDraft.defaults.source ?? 'ramu.json'} · `}
                  {[agentDraft.defaults.requested.provider, agentDraft.defaults.requested.model]
                    .filter(Boolean)
                    .join(' · ')}
                </T>
              ) : null}
              {agentDraft.choice.selection ? (
                <Button title={t.projectModelUseDefault} kind="ghost" onPress={agentDraft.useProjectDefault} />
              ) : agentDraft.blocked && preset ? (
                <Button title={t.projectModelUseHost} kind="ghost" onPress={agentDraft.useHostDefault} />
              ) : null}
            </View>
          ) : null}
          <Composer
            key={composerKey}
            running={false}
            restore={
              params.quote
                ? {
                    text: `${params.quote
                      .trim()
                      .split('\n')
                      .map((line) => `> ${line}`)
                      .join('\n')}\n\n`,
                    n: 1,
                  }
                : undefined
            }
            autoFocus={projectId !== null || auto}
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
                  onPress={() => setPicker('project')}
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
                {project ? (
                  <TrayButton
                    icon={Files}
                    label={t.browseFiles}
                    onPress={() =>
                      router.push({
                        pathname: '/explorer',
                        params: {
                          computer: selected,
                          composerProject: project.id,
                          ...(draftContext ? { draftContext } : {}),
                          ctx: workspaceId
                            ? `worktree:${workspaceId}`
                            : `project:${project.id.slice(project.id.indexOf(':') + 1)}`,
                        },
                      })
                    }
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
              if (mode === 'worktree' && !workspaceId && sendChoice && !workspaceOptions?.branchNameControls)
                throw new Error(t.branchNameOutdated)
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
              router.replace({ pathname: '/chat/[id]', params: { id } })
            }}
          />
        </View>
      </View>

      <Sheet open={picker === 'host'} onClose={() => setPicker(null)} title={t.computers}>
        {computers.map((computer) => (
          <Row
            key={computer.id}
            onPress={() => {
              if (computer.status === 'revoked') return
              if (computer.id !== selected) {
                setHost(computer.id)
                setProjectId(null)
              }
              setPicker('project')
            }}
          >
            <Monitor size={17} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="500">{computer.name}</T>
              <T size={font.caption} tone="muted">
                {t[computer.status]}
              </T>
            </View>
            {computer.id === selected ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
      </Sheet>
      <Sheet open={picker === 'choice'} onClose={() => setPicker(null)} title="Choose a project">
        <T tone="muted">
          {choices?.some((choice) => choice.reason)
            ? 'More than one project could fit. Choose where to start.'
            : 'No project matched. Choose where to start.'}
        </T>
        {choices?.map((choice) => {
          const match = list.find((p) => rawId(p.id) === choice.projectId)
          if (!match) return null
          return (
            <Row
              key={choice.projectId}
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
            >
              <Folder size={17} color={c.soft} />
              <View style={{ flex: 1 }}>
                <T weight="500">{match.name}</T>
                <T size={font.caption} tone="muted">
                  {choice.reason || match.root}
                </T>
              </View>
            </Row>
          )
        })}
      </Sheet>
      <Sheet open={picker === 'project'} onClose={() => setPicker(null)} title="Project">
        {store.appPreferences[selected]?.autoProjectSelection !== false ? (
          <Row
            onPress={() => {
              setProjectId(null)
              setAuto(true)
              setPicker(null)
            }}
          >
            <Folder size={17} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="500">Auto</T>
              <T size={font.caption} tone="muted">
                Pick the project from your first message
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
      </Sheet>

      <Sheet open={picker === 'mode'} onClose={() => setPicker(null)} title="Workspace">
        {workspaceOptions?.configSource ? <T tone="muted">{workspaceOptions.configSource}</T> : null}
        {workspaceOptions?.configError ? <T tone="bad">{workspaceOptions.configError}</T> : null}
        <Row
          onPress={() => {
            chooseWorkspace({ mode: null, branch: choice.branch })
            setPicker(null)
          }}
        >
          <T>
            Use default:{' '}
            {(workspaceOptions?.defaultCheckoutMode ?? store.appPreferences[selected]?.defaultCheckoutMode) ===
            'worktree'
              ? 'New worktree'
              : 'Current checkout'}
          </T>
        </Row>
        {resolution.reason ? <T tone={resolution.blocked ? 'bad' : 'muted'}>{resolution.reason}</T> : null}
        {(
          [
            ['current', 'Current checkout', 'Work directly in the folders on disk.'],
            ['worktree', 'Isolated worktrees', 'A new branch and worktree per repository.'],
          ] as const
        ).map(([value, label, hint]) => (
          <Row
            key={value}
            onPress={() => {
              chooseWorkspace({ mode: value, branch: choice.branch })
              setPicker(null)
            }}
          >
            <View style={{ flex: 1 }}>
              <T weight="500">{label}</T>
              <T size={font.caption} tone="muted">
                {hint}
              </T>
            </View>
            {!workspaceId && manualMode === value ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
        {optionsError ? (
          <T tone="muted">{optionsState.unsupported ? t.workspaceSettingsUnsupported : t.workspaceSettingsFailed}</T>
        ) : null}
        {mode === 'worktree' && !workspaceId && choice.branch && !workspaceOptions?.branchNameControls ? (
          <Row onPress={() => chooseWorkspace({ ...choice, branch: undefined })}>
            <T>{t.branchNameOutdated}</T>
            <T tone="accent">{t.branchNameAutomatic}</T>
          </Row>
        ) : null}
        {mode === 'worktree' && !workspaceId && reviewed?.key === reviewKey ? (
          <Row onPress={() => setReviewed(null)}>
            <T>{t.branchBasesKept}</T>
            <T tone="accent">{t.branchClearBases}</T>
          </Row>
        ) : null}
        {mode === 'worktree' &&
        !workspaceId &&
        workspaceOptions?.branchNameControls &&
        picker === 'mode' &&
        projectId ? (
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
        {catalog.error ? (
          <T tone="muted">{catalog.unsupported ? t.workspacesUnsupported : t.workspacesLoadFailed}</T>
        ) : null}
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
