import { t, useLanguage } from './i18n'
import { useModelSets } from './ModelSets'
import { FolderClosed, GitBranch, Laptop, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type FileContext, type Attachment, type AgentSettings, type CheckoutMode, type WorktreePlanEntry } from '../../shared/types'
import { AgentControls } from './AgentControls'
import { Composer } from './Composer'
import { invoke } from './ipc'
import { Menu } from './Menu'
import { AnimatedMark } from './Brand'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'
import { HomeFeed } from './Home'

/** A task's title is the first line of what you asked for. */
export function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n')[0]!.trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`
}

const MODES: { id: CheckoutMode; label: string; hint: string; Icon: typeof Laptop }[] = [
  { id: 'current', label: 'Current checkout', hint: 'Work on your existing branches and files. Nothing is changed.', Icon: Laptop },
  { id: 'worktree', label: 'New isolated worktrees', hint: 'A new branch and worktree for every repository.', Icon: GitBranch },
]

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
export function NewTask({ projectId, onProjectChange, feed = true }: { projectId: string; onProjectChange: (id: string) => void; feed?: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const general = projectId === NO_PROJECT
  const repos = ws.repos[projectId] ?? []
  const project = ws.projects.find((p) => p.id === projectId)
  const { initialSettings } = useModelSets()
  const [settings, setSettings] = useState<AgentSettings>(initialSettings)
  useEffect(() => setSettings(initialSettings), [initialSettings.provider, initialSettings.model, initialSettings.effort, initialSettings.access, initialSettings.autoFallback])
  const [workspaceId, setWorkspaceId] = useState<string | null>(ws.composingWorkspace)
  const [mode, setMode] = useState<CheckoutMode>('current')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [prompt, setPrompt] = useState('')
  const [plan, setPlan] = useState<WorktreePlanEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setPlan(null), [projectId, repos.length])
  useEffect(() => {
    const selected = ws.workspaces.find((w) => w.id === ws.composingWorkspace && w.projectId === projectId)?.id ?? null
    setWorkspaceId(selected)
    setMode(selected ? 'worktree' : 'current')
    setPrompt('')
    setAttachments([])
    setPlan(null)
    setError(null)
  }, [projectId, ws.composing, ws.composingWorkspace])

  const title = titleFrom(prompt) || (attachments.length ? `Discuss ${attachments[0]!.name}` : '')
  const existingWorkspace = ws.workspaces.find((w) => w.id === workspaceId && w.projectId === projectId)

  // `busy` is state and lags a frame; a double Enter must not create two chats.
  const sending = useRef(false)
  const send = async (context: FileContext[] = []) => {
    if (!title || !general && !repos.length || sending.current) return
    sending.current = true
    setError(null)
    setBusy(true)
    let created: string | null = null
    try {
      if (mode === 'worktree' && !workspaceId && !plan) {
        // Show branch names and paths before anything is created.
        setPlan(await invoke('tasks.plan', projectId, title, repos.map((r) => r.id)))
        return
      }
      const task = await invoke('tasks.create', { projectId, title, mode, workspaceId: workspaceId ?? undefined }, plan ?? undefined)
      created = task.id
      const bindings = mode === 'worktree' ? await invoke('tasks.setup', task.id) : []
      await ws.refresh()
      // Half-built worktrees keep the chat so "Retry setup" can finish it.
      if (bindings.some((b) => b.setupState !== 'ready')) { created = null; ws.openTask(task.id); return }
      const session = await invoke('agent.start', task.id, prompt, settings, attachments.map((file) => file.id), context)
      created = null
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: session.id })
      void ws.refresh()
      // The prompt's first line is the placeholder; the agent names the chat once it has something to go on.
      void invoke('tasks.generateTitle', task.id, settings).then(() => ws.refresh(), () => {})
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

  const projectItems = [{ key: NO_PROJECT, label: t("No project"), onSelect: () => onProjectChange(NO_PROJECT) }, ...ws.projects.map((p) => ({
    key: p.id,
    label: (
      <>
        <FolderClosed size={14} /> <span className="menu-label">{p.name}</span>
      </>
    ),
    onSelect: () => onProjectChange(p.id),
  }))]
  const current = existingWorkspace ? { label: existingWorkspace.name, Icon: GitBranch } : MODES.find((m) => m.id === mode)!

  const start = (
    <div className="start-view">
      <div className="start-hero">
        <AnimatedMark className="start-mark" size={56} />
        <h1>
          {general ? t("What should we work on?") : <>{t("What should we work on in")}{' '}
          <Menu label={t("Project")} icon={<span className="start-project">{project?.name ?? t("a project")}</span>} className="start-project-btn" items={projectItems} />?</>}
        </h1>
        {repos.length > 0 && <p className="muted start-repos">{repos.map((r) => r.name).join(' · ')}</p>}
      </div>
      <div className="start-dock">
        {plan && (
          <div className="plan">
            <div className="muted">{t("Ramu will create a branch and worktree for each repository:")}</div>
            {plan.map((p) => (
              <div key={p.repoId} className="plan-row">
                <span className="strong">{p.repoName}</span>: <code>{p.taskBranch}</code> {t(" from ")}<code>{p.baseRef}</code>
                <div className="path">{p.path}</div>
              </div>
            ))}
            <div className="muted small">{t("Worktrees separate files and the Git index. They do not sandbox processes, ports or credentials.")}</div>
          </div>
        )}
        <div className="start-chips composer-tray">
          {general && <Menu label={t("Project")} className="chip-btn" icon={<><FolderClosed size={13} /> <span className="chip-label">{t("No project")}</span></>} items={projectItems} />}
          {!general && <Menu
            label={t("Where the work happens")}
            className="chip-btn"
            icon={
              <>
                <current.Icon size={13} /> <span className="chip-label">{existingWorkspace ? current.label : t(current.label)}</span>
              </>
            }
            items={[...MODES.map((m) => ({
              key: m.id,
              label: (
                <>
                  <m.Icon size={14} />
                  <span>
                    {t(m.label)}
                    <span className="muted block">{t(m.hint)}</span>
                  </span>
                </>
              ),
              onSelect: () => {
                setWorkspaceId(null)
                setMode(m.id)
                setPlan(null)
              },
            })),
              ...ws.workspaces.filter((w) => w.projectId === projectId).map((w) => ({
                key: w.id,
                label: <><GitBranch size={14} /><span className="menu-label">{w.name}<span className="muted block">{t("Existing isolated worktree")}</span></span></>,
                onSelect: () => { setWorkspaceId(w.id); setMode('worktree'); setPlan(null) },
              })),
            ]}
          />}
          <span className="grow" />
          <Button className="ghost icon small-icon tray-settings" aria-label={t("Chat settings")} title={t("Chat settings")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'git' } }))}><Settings size={14} /></Button>
        </div>
        <Composer
          scopeId={workspaceId ? `worktree:${workspaceId}` : `project:${projectId}`}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          autoFocus
          controls={<AgentControls settings={settings} onChange={setSettings} disabled={busy} />}
          value={prompt}
          onChange={(v) => {
            setPrompt(v)
            setPlan(null)
          }}
          onSubmit={(context) => void send(context)}
          disabled={busy || !general && !repos.length}
          placeholder={general || repos.length ? t("Message the agent") : t("Add a repository to this project first")}
          submitLabel={plan ? t('Create worktrees and start') : t('Start chat')}
        />
        {error && <div className="error start-error">{error}</div>}
      </div>
    </div>
  )
  if (!feed) return start
  return (
    <div className="home-page">
      <div className="home-start">{start}</div>
      <HomeFeed />
    </div>
  )
}
