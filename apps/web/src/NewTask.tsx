import { BranchNameEditor } from './workspace/BranchNameEditor'
import { WorkspaceNameDialog } from './workspace/WorkspaceNameDialog'
import { t, useLanguage } from './i18n'
import { clipText } from '@ramu/shared/text'
import { useModelSets } from './models/ModelSets'
import { ChevronRight, CircleDot, FolderClosed, GitBranch, Laptop, Monitor, Network, Settings } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Spinner } from '@/components/ui/spinner'
import { useEffect, useRef, useState } from 'react'
import {
  resolveCheckoutMode,
  currentBranchChoice,
  validBranchName,
  type BranchChoice,
  type BranchNamingIntent,
} from '@ramu/shared/workspaceDefaults'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AUTO_PROJECT,
  NO_PROJECT,
  type FileContext,
  type Attachment,
  type CheckoutMode,
  type IssueLink,
  type Repository,
  type WorktreeWorkspace,
} from '@ramu/shared/types'
import { AgentControls } from './chat/AgentControls'
import { Composer } from './composer/Composer'
import { ComposerTray } from './composer/ComposerTray'
import { ComposerStack } from './composer/ComposerStack'
import { ramu } from './ipc'
import { ownHostId } from './hosts'
import { Combobox, Menu } from './Menu'
import { AnimatedMark } from './Brand'
import { errorText } from './workspace/TaskPane'
import { useHostRuntime, useWorkspace } from './workspace/workspace'
import { HomeFeed } from './Home'
import { hostStorageFor } from './hostStorage'
import { draftKey, draftStore, loadDraft, useDraftPersistence } from './composer/drafts'
import { notifyError } from './chat/Notifications'
import { useWorkspaceDraft } from './composer/useWorkspaceDraft'
import { useAgentDraft } from './composer/useAgentDraft'
import { clearWorkspaceDraft } from './composer/workspaceDraft'
import { useHost } from './workspace/HostProvider'
import { useAddProject } from './workspace/addProject'
import { useHostSelection } from './workspace/HostSelection'
import { StatusDot, useComputers } from './workspace/computers'
import { defaultStartProject, lastStartProject, rememberStartProject } from './startProject'
import { useAppSettings } from './settings/AppSettings'
import { routingLabels } from '@ramu/shared/workspace/projectRouting'
import { routedAgentSettings } from '@ramu/shared/workspace/agentDefaults'

/** A task's title is the first line of what you asked for. */
export function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n')[0]!.trim()
  if (line.length <= 60) return line
  const cut = clipText(line, 60)
  return `${clipText(cut, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`
}

const issueValue = (issue: { repoId: string; number: number }) => `${issue.repoId}#${issue.number}`

/**
 * Open issues of every GitHub repository in the project, newest first. Repositories that are not on
 * GitHub, or a missing or signed-out GitHub CLI, contribute nothing, so the picker simply stays hidden.
 */
function useProjectIssues(repos: Repository[]) {
  const host = useHost().id
  const query = useQuery({
    queryKey: ['forge-issues', host, ...repos.map((repo) => repo.id)],
    enabled: repos.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const lists = await Promise.all(
        repos.map((repo) =>
          (host === ownHostId()
            ? ramu.invoke('forge.issues', repo.id, '')
            : ramu.invokeOn(host, 'forge.issues', repo.id, '')
          ).then(
            (issues) => issues.map((issue) => ({ ...issue, repoId: repo.id, repoName: repo.name })),
            () => [],
          ),
        ),
      )
      return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt)
    },
  })
  return query.data ?? []
}

const CHIP =
  'chip-btn [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:1px_solid_transparent] [&:hover:not(:disabled)]:text-foreground [&.on]:bg-hover [&.on]:[border:1px_solid_transparent] [&.on]:text-foreground h-7 min-h-7 p-[0_10px] rounded-(--radius-s) bg-transparent [border:1px_solid_transparent] [box-shadow:none] text-soft text-control [.composer-tray_&]:h-7 [.composer-tray_&]:min-h-7 [.composer-tray_&]:p-[0_8px] [.composer-tray_&]:gap-1.5 [.composer-tray_&]:[border:0] [.composer-tray_&]:rounded-full [.composer-tray_&]:bg-transparent [.composer-tray_&]:[box-shadow:none] [.composer-tray_&]:text-soft [.composer-tray_&]:text-caption [.composer-tray_&:hover:not(:disabled)]:[border:0] [.composer-tray_&:hover:not(:disabled)]:bg-hover [.composer-tray_&:hover:not(:disabled)]:text-foreground [.composer-tray_&.on]:[border:0] [.composer-tray_&.on]:bg-hover [.composer-tray_&.on]:text-foreground [.composer-tray_&_svg]:text-muted-foreground [border:none] p-[5px_10px] text-soft text-control gap-1.5 rounded-full bg-hover [box-shadow:inset_0_0_0_1px_var(--line)]'

const MODES: { id: CheckoutMode; label: string; hint: string; Icon: typeof Laptop }[] = [
  {
    id: 'current',
    label: 'Current checkout',
    hint: 'Work on your existing branches and files. Nothing is changed.',
    Icon: Laptop,
  },
  {
    id: 'worktree',
    label: 'New isolated worktrees',
    hint: 'A new branch and worktree for every repository.',
    Icon: GitBranch,
  },
]

/** Optional worktree details; sending always asks the server to plan against the current repository state. */
function NewWorktreeSummary({
  projectId,
  repos,
  title,
  creating,
  choice,
  children,
  namingKey,
}: {
  projectId: string
  repos: Repository[]
  title: string
  creating: boolean
  namingKey: string
  choice?: BranchChoice
  children?: React.ReactNode
}) {
  const { id: host, invoke } = useHost()
  const [previewTitle, setPreviewTitle] = useState(title)
  useEffect(() => {
    const timer = setTimeout(() => setPreviewTitle(title), 250)
    return () => clearTimeout(timer)
  }, [title])
  const preview = useQuery({
    queryKey: [
      'worktree-plan',
      host,
      projectId,
      previewTitle,
      namingKey,
      choice?.name,
      choice?.source,
      ...repos.map((repo) => repo.id),
    ],
    enabled: !!previewTitle && repos.length > 0,
    retry: false,
    queryFn: () =>
      choice
        ? invoke(
            'tasks.plan',
            projectId,
            previewTitle,
            repos.map((repo) => repo.id),
            choice,
          )
        : invoke(
            'tasks.plan',
            projectId,
            previewTitle,
            repos.map((repo) => repo.id),
          ),
  })
  const plan = previewTitle === title ? preview.data : undefined
  const bases = [...new Set(plan?.map((entry) => entry.baseRef))]
  return (
    <details className="worktree-preview group mb-2 px-2 text-caption text-muted-foreground">
      <summary
        className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 py-1 [&::-webkit-details-marker]:hidden"
        title={t('Worktrees separate files and the Git index. They do not sandbox processes, ports or credentials.')}
      >
        {creating ? <Spinner className="size-3.5" aria-hidden="true" /> : <GitBranch size={13} aria-hidden="true" />}
        <span role={creating ? 'status' : undefined}>
          {t(creating ? 'Creating worktrees…' : 'New isolated worktree')}
        </span>
        {bases.length === 1 && <span>· {t('from {0}', { '0': bases[0]! })}</span>}
        {repos.length > 1 && <span>· {t('{0} repositories', { '0': repos.length })}</span>}
        <span className="ml-auto inline-flex items-center gap-1">
          {t('Details')}
          <ChevronRight size={12} className="group-open:rotate-90" aria-hidden="true" />
        </span>
      </summary>
      <div className="worktree-preview-details space-y-2 py-2 pl-5">
        {children}
        {!title ? (
          t('Enter a message to preview branch names and paths.')
        ) : previewTitle === title && preview.error ? (
          <p className="m-0 text-bad">{errorText(preview.error)}</p>
        ) : !plan ? (
          t('Loading…')
        ) : (
          plan.map((entry) => (
            <div key={entry.repoId}>
              <span className="font-medium text-soft">{entry.repoName}</span>: <code>{entry.taskBranch}</code> ·{' '}
              {t('from {0}', { '0': entry.baseRef })}
              <div className="break-all">{entry.path}</div>
            </div>
          ))
        )}
      </div>
    </details>
  )
}

/** Home and New chat are one screen: the start box, with what's running and coming up below it. */
export function HomePage() {
  const ws = useWorkspace()
  const host = useHost()
  // With no explicit choice, the box starts in the project you last started a thread in.
  const { preferences } = useAppSettings()
  // Auto is the default while the preference is on; an explicit project choice always wins for the draft.
  const projectId =
    ws.composing ??
    (preferences.autoProjectSelection && ws.projects.length > 0
      ? AUTO_PROJECT
      : defaultStartProject(lastStartProject(hostStorageFor(host.id)), ws.projects))
  return <NewTask projectId={projectId} onProjectChange={(id) => ws.newTask(id)} allowAuto />
}

/**
 * Start of a task, Codex-style. A task always covers every repository in the project and the
 * agent works on the whole workspace. Sending the first message creates the task.
 * `feed` adds the Home feed below; it is off when the box is docked beside an open file.
 */
export function NewTask({
  projectId,
  onProjectChange,
  feed = true,
  allowAuto = false,
}: {
  projectId: string
  onProjectChange: (id: string) => void
  feed?: boolean
  /** Only Home offers Auto: it has no project pane to open before a destination exists. */
  allowAuto?: boolean
}) {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const runtime = useHostRuntime()
  const addProject = useAddProject()
  const [folderOver, setFolderOver] = useState(false)
  const { preferences } = useAppSettings()
  const auto = projectId === AUTO_PROJECT
  const general = projectId === NO_PROJECT || auto
  // Auto drafts share the project-free model and workspace scope until a destination is resolved.
  const scopeProject = auto ? NO_PROJECT : projectId
  const [choices, setChoices] = useState<{ projectId: string; reason: string }[] | null>(null)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  const routeRevision = useRef(0)
  const repos = ws.repos[projectId] ?? []
  const project = ws.projects.find((p) => p.id === projectId)
  const { initialSettings } = useModelSets()
  const agentDraft = useAgentDraft(scopeProject, initialSettings)
  const settings = agentDraft.settings
  const modelNotice = agentDraft.choice.selection
    ? t('Model chosen for this draft')
    : !agentDraft.confirmed
      ? t('The saved model choice could not be restored. Choose a model again.')
      : agentDraft.loading
        ? t('Loading project model defaults…')
        : agentDraft.unsupported
          ? t('This host uses host model defaults. Update it for repository preferences.')
          : agentDraft.defaults?.status === 'invalid'
            ? t('Project configuration is invalid. Choose a model or correct the file.')
            : agentDraft.defaults?.reason === 'provider'
              ? t("The project's preferred provider is unavailable on this host.")
              : agentDraft.defaults?.reason === 'model'
                ? t("The project's preferred model is not in this host's catalog.")
                : agentDraft.error || agentDraft.defaults?.reason === 'catalog'
                  ? t("Could not load the project's model catalog.")
                  : t('Project model default')
  const workspaceDraft = useWorkspaceDraft(host.id, scopeProject, general ? null : ws.composingWorkspace)
  const workspaceId = general ? null : (workspaceDraft.choice.workspaceId ?? null)
  const manualMode = general ? null : workspaceDraft.choice.mode
  const queryClient = useQueryClient()
  const optionsKey = ['workspace-options', host.id, projectId]
  const options = useQuery({
    queryKey: optionsKey,
    enabled: !general,
    retry: false,
    queryFn: () => host.invoke('tasks.workspaceOptions', projectId),
  })
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-options', host.id, projectId], exact: true })
    }
    refresh()
    const offSettings = runtime.on('settings:changed', refresh)
    const offWorkspace = runtime.on('workspace:changed', refresh)
    return () => {
      offSettings()
      offWorkspace()
    }
  }, [runtime, host.id, host.status, projectId, queryClient])
  const resolution = resolveCheckoutMode({
    defaultMode: options.data?.defaultCheckoutMode ?? 'current',
    manual: manualMode,
    workspaceId,
    projectFree: general,
    worktreeUnavailable: options.data?.worktreeUnavailable,
  })
  const mode = resolution.mode
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [prompt, setPrompt] = useState(() => loadDraft(draftKey.newChat(projectId), draftStore(host.id)))
  const consumeDraft = useDraftPersistence(draftKey.newChat(projectId), prompt, host.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issue, setIssue] = useState<IssueLink | null>(null)
  const [renamingWorkspace, setRenamingWorkspace] = useState<{
    host: string
    project: string
    openedOn: string
    workspace: WorktreeWorkspace
  } | null>(null)
  const issues = useProjectIssues(repos)
  const pickIssue = async (value: string) => {
    if (!value) return setIssue(null)
    const picked = issues.find((entry) => issueValue(entry) === value)
    if (!picked) return
    setError(null)
    try {
      const details = await host.invoke('forge.issue', picked.repoId, picked.number)
      setIssue(details.link)
      setPrompt(details.prompt)
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    setPrompt(loadDraft(draftKey.newChat(projectId), draftStore(host.id)))
    setAttachments([])
    setError(null)
    setIssue(null)
  }, [host.id, projectId, ws.composing, ws.composingWorkspace])

  // A pending routing answer belongs to the exact prompt, destination and host it was asked for.
  useEffect(() => {
    routeRevision.current++
    setChoices(null)
    setRouteNote(null)
  }, [prompt, projectId, host.id])

  const title = titleFrom(prompt) || (attachments.length ? `Discuss ${attachments[0]!.name}` : '')
  const namingIntent: BranchNamingIntent = {
    strategy: options.data?.branchNaming ?? 'fixed',
    instructions: options.data?.branchInstructions ?? '',
    prompt: prompt.slice(0, 6000),
  }
  const branchChoice =
    mode === 'worktree' && !workspaceId
      ? currentBranchChoice(workspaceDraft.choice.branch, title, namingIntent)
      : undefined
  const existingWorkspace = ws.workspaces.find((w) => w.id === workspaceId && w.projectId === projectId)

  // `busy` is state and lags a frame; a double Enter must not create two chats.
  const sending = useRef(false)
  const creationRequest = useRef<{ fingerprint: string; id: string } | null>(null)
  const send = async (context: FileContext[] = [], chosen?: string) => {
    if (sending.current) throw new Error(t('A message is already being sent.'))
    if (!general && !repos.length) throw new Error(t('Add a repository to this project first'))
    const messageTitle =
      title ||
      (context[0] ? titleFrom(t('Discuss {0}', { '0': context[0].path.split(/[\\/]/).pop() ?? context[0].path })) : '')
    if (!messageTitle) throw new Error(t('Add a message or file before starting.'))
    if (!general && !workspaceDraft.confirmed) {
      throw new Error(t('Choose where to work before starting. The saved workspace choice could not be restored.'))
    }
    if (workspaceId && !existingWorkspace) {
      throw new Error(t('Saved workspace is unavailable. Choose another workspace.'))
    }
    if (!general && !options.data) {
      throw new Error(options.error ? errorText(options.error) : t('Loading workspace settings…'))
    }
    if (resolution.blocked) {
      throw new Error(resolution.reason ?? t('Workspace unavailable'))
    }
    if (branchChoice && !validBranchName(branchChoice.name)) {
      throw new Error(t('Invalid Git branch name'))
    }
    sending.current = true
    setError(null)
    setBusy(true)
    let created: string | null = null
    let target = {
      projectId,
      mode,
      workspaceId: workspaceId ?? undefined,
      branchPrefix: options.data?.branchPrefix,
      naming: namingIntent,
      branch: branchChoice,
    }
    try {
      let sendSettings = await agentDraft.verify()
      if (auto) {
        const revision = ++routeRevision.current
        let destination = chosen
        if (!destination) {
          const outcome = await host.invoke('projects.route', prompt || messageTitle, sendSettings)
          if (revision !== routeRevision.current)
            throw new Error(t('The message changed while choosing a project. Send again.'))
          if (outcome.kind === 'resolved') {
            destination = outcome.projectId
            setRouteNote(
              `${t('Starting in')} ${ws.projects.find((p) => p.id === destination)?.name ?? ''} — ${outcome.reason}`,
            )
          } else if (outcome.kind === 'ambiguous') {
            setChoices(outcome.candidates.filter((c) => ws.projects.some((p) => p.id === c.projectId)))
            return
          } else if (outcome.kind === 'unknown') {
            setChoices(ws.projects.map((p) => ({ projectId: p.id, reason: '' })))
            return
          } else {
            setChoices(ws.projects.map((p) => ({ projectId: p.id, reason: '' })))
            setError(
              outcome.reason === 'no-projects'
                ? t('Add a project first.')
                : t('Could not choose a project automatically. Choose one to continue.'),
            )
            return
          }
        }
        if (!ws.projects.some((p) => p.id === destination))
          throw new Error(t('That project is no longer available. Choose a project.'))
        if (!(ws.repos[destination] ?? []).length) throw new Error(t('Add a repository to this project first'))
        // The destination's repository model defaults apply as if the project had been picked by hand.
        const destinationDefaults = agentDraft.choice.selection
          ? undefined
          : await host.invoke('tasks.agentDefaults', destination, initialSettings.provider).catch((error) => {
              if (/Unknown method tasks\.agentDefaults/.test(errorText(error))) return undefined
              throw error
            })
        const routedSettings = routedAgentSettings(initialSettings, destinationDefaults, agentDraft.choice)
        if (!routedSettings) {
          // Stay in Auto so the draft remains visible; a model chosen here then wins over the project default.
          setRouteNote(null)
          throw new Error(
            t("{name}'s model default can't be used. Choose a model, then send again.", {
              name: ws.projects.find((p) => p.id === destination)?.name ?? '',
            }),
          )
        }
        sendSettings = routedSettings
        const destinationOptions = await host.invoke('tasks.workspaceOptions', destination)
        const checkout = resolveCheckoutMode({
          defaultMode: destinationOptions.defaultCheckoutMode ?? 'current',
          manual: null,
          workspaceId: null,
          projectFree: false,
          worktreeUnavailable: destinationOptions.worktreeUnavailable,
        })
        if (checkout.blocked) throw new Error(checkout.reason ?? t('Workspace unavailable'))
        const naming: BranchNamingIntent = {
          strategy: destinationOptions.branchNaming ?? 'fixed',
          instructions: destinationOptions.branchInstructions ?? '',
          prompt: prompt.slice(0, 6000),
        }
        target = {
          projectId: destination,
          mode: checkout.mode,
          workspaceId: undefined,
          branchPrefix: destinationOptions.branchPrefix,
          naming,
          branch: checkout.mode === 'worktree' ? currentBranchChoice(undefined, title, naming) : undefined,
        }
        setChoices(null)
      }
      const fingerprint = JSON.stringify([
        host.id,
        target.projectId,
        messageTitle,
        prompt,
        target.mode,
        target.workspaceId,
        target.branchPrefix,
        target.naming,
        target.branch,
        attachments.map((file) => file.id),
      ])
      if (creationRequest.current?.fingerprint !== fingerprint)
        creationRequest.current = { fingerprint, id: crypto.randomUUID() }
      const task = await host.invoke('tasks.create', {
        projectId: target.projectId,
        title: messageTitle,
        mode: target.mode,
        workspaceId: target.workspaceId,
        branchPrefix: target.branchPrefix,
        branchNaming: target.naming,
        branchChoice: target.branch,
        requestId: creationRequest.current.id,
      })
      created = task.id
      const bindings = target.mode === 'worktree' ? await host.invoke('tasks.setup', task.id) : []
      await ws.refresh()
      // Half-built worktrees keep the chat so "Retry setup" can finish it.
      if (bindings.some((b) => b.setupState !== 'ready')) {
        created = null
        creationRequest.current = null
        ws.openTask(task.id)
        throw new Error(t('Worktree setup did not finish. Your message has not been sent.'))
      }
      const session = await host.invoke(
        'agent.start',
        task.id,
        prompt,
        sendSettings,
        attachments.map((file) => file.id),
        context,
      )
      created = null
      creationRequest.current = null
      if (!auto) rememberStartProject(projectId, hostStorageFor(host.id))
      // The link lets this chat's pull request close the issue; losing it only loses that line.
      if (issue) void host.invoke('forge.linkIssue', task.id, issue).catch(() => {})
      setIssue(null)
      const consumed = consumeDraft()
      if (!consumed.persisted) notifyError(t('Message sent, but the local draft could not be cleared.'), 'Draft')
      if (consumed.unchanged && consumed.persisted) {
        if (!auto) clearWorkspaceDraft(projectId, draftStore(host.id), workspaceDraft.choice)
        agentDraft.consume()
      }
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: session.id })
      void ws.refresh()
    } catch (e) {
      // A chat exists only with its first message: don't leave an empty one behind (and a retry a duplicate).
      if (created) {
        await host.invoke('tasks.delete', created, target.mode === 'worktree' && !target.workspaceId).then(
          () => {
            creationRequest.current = null
          },
          () => {},
        )
        await ws.refresh().catch(() => {})
      }
      throw e
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const projectOptions = [
    ...((allowAuto && preferences.autoProjectSelection) || auto ? [{ value: AUTO_PROJECT, label: t('Auto') }] : []),
    { value: NO_PROJECT, label: t('No project') },
    ...ws.projects.map((p) => ({ value: p.id, label: p.name })),
  ]
  const choiceLabels = routingLabels(ws.projects.map((p) => ({ id: p.id, name: p.name })))
  const computers = useComputers()
  const { activeHost, select } = useHostSelection()
  useEffect(() => {
    setRenamingWorkspace((current) =>
      current && (current.host !== host.id || current.project !== projectId || current.openedOn !== activeHost)
        ? null
        : current,
    )
  }, [host.id, projectId, activeHost])
  const currentComputer = computers?.computers.find((c) => c.id === activeHost)
  // Switching hosts opens New thread on that host's projects, so the chat starts there.
  const computerItems = (computers?.computers ?? []).map((c) => ({
    key: c.id,
    selected: c.id === activeHost,
    disabled: !c.local && c.id !== activeHost && c.status !== 'connected',
    label: (
      <span className="flex min-w-0 grow items-center gap-2">
        <StatusDot status={c.status} />
        <span className="truncate">{c.name}</span>
      </span>
    ),
    onSelect: () => {
      if (c.id !== activeHost) select(c.id, { kind: 'new' })
    },
  }))
  const current = existingWorkspace
    ? { label: existingWorkspace.name, Icon: GitBranch }
    : workspaceId
      ? { label: workspaceDraft.choice.name ?? t('Workspace unavailable'), Icon: GitBranch }
      : MODES.find((m) => m.id === mode)!

  const start = (
    <div className="start-view flex-1 flex flex-col min-h-0 min-w-0">
      <div className="start-hero [&_h1]:m-0 [&_h1]:text-hero [&_h1]:text-center [&_h1]:leading-[1.3] [&_h1]:font-semibold [&_h1]:tracking-[-0.022em] flex-1 flex flex-col items-center justify-center gap-2.5 p-6">
        <AnimatedMark
          className="start-mark [&:is(img)]:w-[56px] [&:is(img)]:h-[56px] [&:is(img)]:bg-transparent [&:is(img)]:[border-radius:0] [&:is(img)]:mb-1.5 w-[54px] h-[54px] rounded-(--radius-l) flex items-center justify-center text-muted-foreground bg-hover mb-2"
          size={56}
        />
        <h1>
          {general ? (
            t('What should we work on?')
          ) : (
            <>
              {t('What should we work on in')} <span className="start-project">{project?.name ?? t('a project')}</span>?
            </>
          )}
        </h1>
        {ws.projects.length === 0 && (
          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              className="bg-fill hover:bg-fill-hover"
              disabled={addProject.busy}
              onClick={() => void addProject.add()}
            >
              <FolderClosed size={14} />
              {t('Open a folder')}
            </Button>
            <p className="muted text-muted-foreground small text-caption m-0">{t('or drop a folder here')}</p>
          </div>
        )}
        {repos.length > 0 && (
          <p className="muted text-muted-foreground start-repos m-0 text-control">
            {repos.map((r) => r.name).join(' · ')}
          </p>
        )}
      </div>
      <div className="start-dock [&_.composer]:relative [&_.composer]:z-1 flex-none w-full m-[0_auto] p-[0_20px_22px] max-w-[780px] pb-3.5">
        {(agentDraft.defaults?.requested || agentDraft.blocked || agentDraft.unsupported || agentDraft.problem) && (
          <div className="flex flex-wrap items-center gap-2 px-2 text-caption text-muted-foreground" role="status">
            <span>{modelNotice}</span>
            {agentDraft.defaults?.requested && (
              <span>
                {`${agentDraft.defaults.source ?? 'ramu.json'} · `}
                {[agentDraft.defaults.requested.provider, agentDraft.defaults.requested.model]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            {agentDraft.choice.selection ? (
              <Button variant="ghost" size="xs" disabled={busy} onClick={agentDraft.useProjectDefault}>
                {t('Use project default')}
              </Button>
            ) : agentDraft.blocked ? (
              <Button variant="ghost" size="xs" disabled={busy} onClick={agentDraft.useHostDefault}>
                {t('Use host default')}
              </Button>
            ) : null}
            {agentDraft.problem && (
              <>
                {agentDraft.confirmed && <span>{t('Model choice could not be saved on this device.')}</span>}
                <Button variant="ghost" size="xs" onClick={agentDraft.retry}>
                  {t('Retry')}
                </Button>
              </>
            )}
          </div>
        )}
        {!general && workspaceDraft.problem && (
          <p className="m-0 px-2 text-caption text-muted-foreground" role="status">
            {workspaceDraft.confirmed
              ? t('Workspace choice is kept for this session but could not be saved.')
              : t('Choose where to work before starting. The saved workspace choice could not be restored.')}
            {workspaceDraft.confirmed && (
              <Button variant="ghost" size="xs" onClick={workspaceDraft.retry}>
                {t('Retry')}
              </Button>
            )}
          </p>
        )}
        {workspaceId && !existingWorkspace && (
          <p className="m-0 px-2 text-caption text-muted-foreground" role="status">
            {t('Saved workspace is unavailable. Choose another workspace.')}
          </p>
        )}
        {!general &&
          !workspaceId &&
          (!options.data ||
            options.data.defaultCheckoutMode === 'worktree' ||
            resolution.reason ||
            options.data.configSource ||
            options.data.configError) && (
            <p className="m-0 px-2 text-caption text-muted-foreground" role="status">
              {options.data
                ? [
                    options.data.defaultCheckoutMode === 'worktree' || resolution.reason
                      ? `${t('Default')}: ${t(options.data.defaultCheckoutMode === 'worktree' ? 'New worktree' : 'Current checkout')}${resolution.reason ? ` · ${t('Using current checkout')} — ${resolution.reason}` : ''}`
                      : null,
                    options.data.configSource,
                    options.data.configError ? t(options.data.configError) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('Loading workspace settings…')}
            </p>
          )}
        {!general && mode === 'worktree' && !workspaceId && (
          <NewWorktreeSummary
            projectId={projectId}
            repos={repos}
            title={title}
            creating={busy}
            choice={branchChoice}
            namingKey={JSON.stringify([options.data?.branchPrefix, namingIntent.strategy, namingIntent.instructions])}
          >
            {options.data?.branchNaming !== undefined && (
              <BranchNameEditor
                key={JSON.stringify([host.id, projectId])}
                projectId={projectId}
                title={title}
                intent={namingIntent}
                choice={branchChoice}
                busy={busy}
                onChange={(choice) =>
                  workspaceDraft.choose({
                    ...workspaceDraft.choice,
                    branch: choice ? { title, intent: namingIntent, choice } : undefined,
                  })
                }
              />
            )}
          </NewWorktreeSummary>
        )}
        <ComposerStack>
          <ComposerTray className="start-chips">
            <div className="start-context flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
              {computerItems.length > 1 && (
                <Menu
                  label={t('Host')}
                  className={CHIP}
                  icon={
                    <>
                      {currentComputer?.local ? <Monitor size={13} /> : <Network size={13} />}{' '}
                      <span className="chip-label">{currentComputer?.name}</span>
                    </>
                  }
                  items={computerItems}
                />
              )}
              <Combobox
                label={t('Project')}
                searchPlaceholder={t('Search projects…')}
                value={auto ? AUTO_PROJECT : (project?.id ?? NO_PROJECT)}
                icon={<FolderClosed size={13} />}
                bare
                className={`${CHIP} max-w-[220px]`}
                options={projectOptions}
                onChange={onProjectChange}
              />
              {!general && (
                <Menu
                  label={t('Where the work happens')}
                  className={CHIP}
                  icon={
                    <>
                      <current.Icon size={13} />{' '}
                      <span className="chip-label">{existingWorkspace ? current.label : t(current.label)}</span>
                    </>
                  }
                  items={[
                    {
                      key: 'default',
                      label: t('Use default'),
                      onSelect: () => {
                        workspaceDraft.choose({ mode: null, branch: workspaceDraft.choice.branch })
                      },
                    },
                    ...MODES.map((m) => ({
                      key: m.id,
                      disabled: m.id === 'worktree' && Boolean(options.data?.worktreeUnavailable),
                      label: (
                        <>
                          <m.Icon size={14} />
                          <span>
                            {t(m.label)}
                            <span className="muted text-muted-foreground block block">{t(m.hint)}</span>
                          </span>
                        </>
                      ),
                      onSelect: () => {
                        workspaceDraft.choose({ mode: m.id, branch: workspaceDraft.choice.branch })
                      },
                    })),
                    ...ws.workspaces
                      .filter((w) => w.projectId === projectId)
                      .map((w) => ({
                        key: w.id,
                        label: (
                          <>
                            <GitBranch size={14} />
                            <span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis">
                              {w.name}
                              <span className="muted text-muted-foreground block block">
                                {t('Existing isolated worktree')}
                              </span>
                            </span>
                          </>
                        ),
                        onSelect: () => {
                          workspaceDraft.choose({ mode: 'worktree', workspaceId: w.id, name: w.name })
                        },
                      })),
                    ...(existingWorkspace
                      ? [
                          {
                            key: 'rename-workspace',
                            label: t('Rename workspace…'),
                            disabled: busy || host.status !== 'connected',
                            onSelect: () =>
                              setRenamingWorkspace({
                                host: host.id,
                                project: projectId,
                                openedOn: activeHost,
                                workspace: existingWorkspace,
                              }),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {!general && issues.length > 0 && (
                <Combobox
                  label={t('Start from an issue')}
                  searchPlaceholder={t('Search issues…')}
                  value={issue ? issueValue(issue) : ''}
                  icon={<CircleDot size={13} />}
                  className="h-7 min-h-7 p-[0_10px] rounded-full bg-transparent text-soft text-control max-w-[260px]"
                  title={issue?.title}
                  disabled={busy}
                  options={[
                    { value: '', label: t('No issue') },
                    ...issues.map((entry) => ({
                      value: issueValue(entry),
                      label: `${repos.length > 1 ? `${entry.repoName} ` : ''}#${entry.number} ${entry.title}`,
                    })),
                  ]}
                  onChange={(value) => void pickIssue(value)}
                />
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center tray-settings"
              aria-label={t('Thread settings')}
              title={t('Thread settings')}
              onClick={() => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'git' } }))}
            >
              <Settings size={14} />
            </Button>
          </ComposerTray>
          <Composer
            scopeId={workspaceId ? `worktree:${workspaceId}` : `project:${projectId}`}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            autoFocus
            controls={<AgentControls settings={settings} onChange={agentDraft.change} disabled={busy} />}
            value={prompt}
            onChange={(v) => {
              setPrompt(v)
            }}
            onSubmit={send}
            disabled={busy || (!general && !repos.length)}
            placeholder={general || repos.length ? t('Message the agent') : t('Add a repository to this project first')}
            submitLabel={t('Start thread')}
          />
        </ComposerStack>
        {routeNote && (
          <p className="m-0 px-2 text-caption text-muted-foreground" role="status">
            {routeNote}
          </p>
        )}
        {choices && (
          <div className="flex flex-col gap-1 px-2 py-1.5" role="group" aria-label={t('Choose a project')}>
            <p className="m-0 text-caption text-muted-foreground">
              {choices.length === 1 || choices.some((c) => c.reason)
                ? t('More than one project could fit. Choose where to start.')
                : t('No project matched. Choose where to start.')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((choice) => (
                <Button
                  key={choice.projectId}
                  variant="secondary"
                  size="xs"
                  title={choice.reason || undefined}
                  disabled={busy}
                  onClick={() => void send([], choice.projectId).catch((e) => setError(errorText(e)))}
                >
                  {choiceLabels.get(choice.projectId) ?? choice.projectId}
                  {choice.reason ? <span className="text-muted-foreground"> · {choice.reason}</span> : null}
                </Button>
              ))}
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => setChoices(null)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        )}
        {error && <div className="error text-bad start-error p-[6px_8px_0] text-control">{error}</div>}
        {renamingWorkspace?.host === host.id &&
          renamingWorkspace.project === projectId &&
          renamingWorkspace.openedOn === activeHost && (
            <WorkspaceNameDialog
              key={`${host.id}:${renamingWorkspace.workspace.id}`}
              workspace={renamingWorkspace.workspace}
              online={host.status === 'connected'}
              onSave={async (name, before) => {
                await host.invoke('workspaces.rename', renamingWorkspace.workspace.id, name, before)
                await ws.refresh()
              }}
              onClose={() => setRenamingWorkspace((current) => (current === renamingWorkspace ? null : current))}
            />
          )}
      </div>
    </div>
  )
  if (!feed) return start
  return (
    <div
      onDragOver={(event) => {
        if (!addProject.busy && event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setFolderOver(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderOver(false)
      }}
      onDrop={(event) => {
        setFolderOver(false)
        // A drop on the message box is an attachment; anywhere else on Home it adds a project.
        if (event.defaultPrevented || addProject.busy || !event.dataTransfer.files.length) return
        event.preventDefault()
        void addProject.addDropped([...event.dataTransfer.files])
      }}
      className={`home-page${folderOver ? ' outline-dashed outline-1 -outline-offset-4 outline-(--line-strong)' : ''} [&_.composer_[data-composer-input]]:text-chat [&_.composer_[data-composer-input]]:leading-[1.55] [&_.composer_[data-composer-input]]:p-[2px_4px_6px_0] [&_.composer_[data-composer-input]]:min-h-[26px] [&_.composer_[data-composer-input]]:text-foreground [&_.composer_[data-composer-input]]:text-chat [&_.composer_[data-composer-input]]:leading-[1.55] [&_.composer_[data-composer-input]]:p-[2px_4px_6px_0] [&_.composer_[data-composer-input]]:min-h-[26px] [&_.composer_[data-composer-input]]:text-foreground [&_.composer-bar_.dropdown-trigger.control-btn]:h-[30px] [&_.composer-bar_.dropdown-trigger.control-btn]:min-h-[30px] [&_.composer-bar_.dropdown-trigger.control-btn]:p-[4px_8px] [&_.composer-bar_.dropdown-trigger.control-btn]:bg-transparent [&_.composer-bar_.dropdown-trigger.control-btn]:text-control [&_.composer-bar_.dropdown-trigger.control-btn]:leading-[normal] w-full h-full overflow-auto flex flex-col items-stretch p-[0_24px_24px]`}
    >
      <div className="home-start [&_.start-view]:min-h-[min(560px,_72vh)] [.home-page:has(.home-section)_&_.start-view]:min-h-[min(400px,_50vh)] [&_.start-view]:pt-2 [&_.start-hero]:mb-[22px] [&_.start-hero_h1]:text-hero [&_.start-mark]:block [&_.start-dock]:pl-0 [&_.start-dock]:pr-0 [&_.start-dock]:max-w-[none] w-full max-w-[760px] m-[0_auto] [border:0]">
        {start}
      </div>
      <HomeFeed />
    </div>
  )
}
