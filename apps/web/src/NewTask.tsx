import { t, useLanguage } from './i18n'
import { clipText } from '@ramu/shared/text'
import { useModelSets } from './models/ModelSets'
import { ChevronRight, CircleDot, FolderClosed, GitBranch, Laptop, Monitor, Network, Settings } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Spinner } from '@/components/ui/spinner'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  NO_PROJECT,
  type FileContext,
  type Attachment,
  type AgentSettings,
  type CheckoutMode,
  type IssueLink,
  type Repository,
} from '@ramu/shared/types'
import { AgentControls } from './chat/AgentControls'
import { Composer } from './composer/Composer'
import { ComposerTray } from './composer/ComposerTray'
import { invoke, ramu } from './ipc'
import { Combobox, Menu } from './Menu'
import { AnimatedMark } from './Brand'
import { errorText } from './workspace/TaskPane'
import { useWorkspace } from './workspace/workspace'
import { HomeFeed } from './Home'
import { clearDraft, draftKey, loadDraft, useDraftPersistence } from './composer/drafts'
import { useAddProject } from './workspace/addProject'
import { StatusDot, useComputers } from './workspace/computers'
import { notifyError } from './chat/Notifications'

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
  const query = useQuery({
    queryKey: ['forge-issues', ...repos.map((repo) => repo.id)],
    enabled: repos.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const lists = await Promise.all(
        repos.map((repo) =>
          ramu.invoke('forge.issues', repo.id, '').then(
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
}: {
  projectId: string
  repos: Repository[]
  title: string
  creating: boolean
}) {
  const [previewTitle, setPreviewTitle] = useState(title)
  useEffect(() => {
    const timer = setTimeout(() => setPreviewTitle(title), 250)
    return () => clearTimeout(timer)
  }, [title])
  const preview = useQuery({
    queryKey: ['worktree-plan', projectId, previewTitle, ...repos.map((repo) => repo.id)],
    enabled: !!previewTitle && repos.length > 0,
    retry: false,
    queryFn: () =>
      invoke(
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
  return <NewTask projectId={ws.composing ?? NO_PROJECT} onProjectChange={(id) => ws.newTask(id)} />
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
}: {
  projectId: string
  onProjectChange: (id: string) => void
  feed?: boolean
}) {
  useLanguage()
  const ws = useWorkspace()
  const addProject = useAddProject()
  const [folderOver, setFolderOver] = useState(false)
  const general = projectId === NO_PROJECT
  const repos = ws.repos[projectId] ?? []
  const project = ws.projects.find((p) => p.id === projectId)
  const { initialSettings } = useModelSets()
  const [settings, setSettings] = useState<AgentSettings>(initialSettings)
  useEffect(
    () => setSettings(initialSettings),
    [
      initialSettings.provider,
      initialSettings.model,
      initialSettings.effort,
      initialSettings.access,
      initialSettings.autoFallback,
    ],
  )
  const [workspaceId, setWorkspaceId] = useState<string | null>(ws.composingWorkspace)
  const [mode, setMode] = useState<CheckoutMode>('current')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [prompt, setPrompt] = useState(() => loadDraft(draftKey.newChat(projectId)))
  useDraftPersistence(draftKey.newChat(projectId), prompt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issue, setIssue] = useState<IssueLink | null>(null)
  const issues = useProjectIssues(repos)
  const pickIssue = async (value: string) => {
    if (!value) return setIssue(null)
    const picked = issues.find((entry) => issueValue(entry) === value)
    if (!picked) return
    setError(null)
    try {
      const details = await invoke('forge.issue', picked.repoId, picked.number)
      setIssue(details.link)
      setPrompt(details.prompt)
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    const selected = ws.workspaces.find((w) => w.id === ws.composingWorkspace && w.projectId === projectId)?.id ?? null
    setWorkspaceId(selected)
    setMode(selected ? 'worktree' : 'current')
    setPrompt(loadDraft(draftKey.newChat(projectId)))
    setAttachments([])
    setError(null)
    setIssue(null)
  }, [projectId, ws.composing, ws.composingWorkspace])

  const title = titleFrom(prompt) || (attachments.length ? `Discuss ${attachments[0]!.name}` : '')
  const existingWorkspace = ws.workspaces.find((w) => w.id === workspaceId && w.projectId === projectId)

  // `busy` is state and lags a frame; a double Enter must not create two chats.
  const sending = useRef(false)
  const send = async (context: FileContext[] = []) => {
    if (!title || (!general && !repos.length) || sending.current) return
    sending.current = true
    setError(null)
    setBusy(true)
    let created: string | null = null
    try {
      const task = await invoke('tasks.create', { projectId, title, mode, workspaceId: workspaceId ?? undefined })
      created = task.id
      const bindings = mode === 'worktree' ? await invoke('tasks.setup', task.id) : []
      await ws.refresh()
      // Half-built worktrees keep the chat so "Retry setup" can finish it.
      if (bindings.some((b) => b.setupState !== 'ready')) {
        created = null
        ws.openTask(task.id)
        return
      }
      const session = await invoke(
        'agent.start',
        task.id,
        prompt,
        settings,
        attachments.map((file) => file.id),
        context,
      )
      created = null
      // The link lets this chat's pull request close the issue; losing it only loses that line.
      if (issue) void invoke('forge.linkIssue', task.id, issue).catch(() => {})
      setIssue(null)
      clearDraft(draftKey.newChat(projectId))
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: session.id })
      void ws.refresh()
      // The prompt's first line is the placeholder; the agent names the chat once it has something to go on.
      void invoke('tasks.generateTitle', task.id, settings).then(
        () => ws.refresh(),
        () => {},
      )
    } catch (e) {
      // A chat exists only with its first message: don't leave an empty one behind (and a retry a duplicate).
      if (created) {
        await invoke('tasks.delete', created, mode === 'worktree' && !workspaceId).catch(() => {})
        await ws.refresh().catch(() => {})
      }
      setError(errorText(e))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const projectOptions = [
    { value: NO_PROJECT, label: t('No project') },
    ...ws.projects.map((p) => ({ value: p.id, label: p.name })),
  ]
  const computers = useComputers()
  const currentComputer = computers?.computers.find((c) => c.id === computers.current)
  // Switching computers reopens the window on that computer's projects, so the chat starts there.
  const computerItems = (computers?.computers ?? []).map((c) => ({
    key: c.id,
    selected: c.id === computers?.current,
    disabled: !c.local && c.id !== computers?.current && c.status !== 'connected',
    label: (
      <span className="flex min-w-0 grow items-center gap-2">
        <StatusDot status={c.status} />
        <span className="truncate">{c.name}</span>
      </span>
    ),
    onSelect: () => {
      if (c.id !== computers?.current)
        void invoke('computers.navigate', c.id, { kind: 'new' }).catch((error) =>
          notifyError(errorText(error), t('Hosts')),
        )
    },
  }))
  const current = existingWorkspace
    ? { label: existingWorkspace.name, Icon: GitBranch }
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
        {!general && mode === 'worktree' && !workspaceId && (
          <NewWorktreeSummary projectId={projectId} repos={repos} title={title} creating={busy} />
        )}
        <ComposerTray className="start-chips items-start gap-0.5 px-1.5">
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
              value={project?.id ?? NO_PROJECT}
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
                  ...MODES.map((m) => ({
                    key: m.id,
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
                      setWorkspaceId(null)
                      setMode(m.id)
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
                        setWorkspaceId(w.id)
                        setMode('worktree')
                      },
                    })),
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
          persistentDraft
          scopeId={workspaceId ? `worktree:${workspaceId}` : `project:${projectId}`}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          autoFocus
          controls={<AgentControls settings={settings} onChange={setSettings} disabled={busy} />}
          value={prompt}
          onChange={(v) => {
            setPrompt(v)
          }}
          onSubmit={send}
          disabled={busy || (!general && !repos.length)}
          placeholder={general || repos.length ? t('Message the agent') : t('Add a repository to this project first')}
          submitLabel={t('Start thread')}
        />
        {error && <div className="error text-bad start-error p-[6px_8px_0] text-control">{error}</div>}
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
