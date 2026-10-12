import { t, useLanguage } from './i18n'
import { Input } from '@/components/ui/input'
import { Check, ChevronDown, Folder, FolderPlus, GitBranch, Laptop } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Dropdown, Menu, type MenuEntry } from './Menu'
import { projectCtx, worktreeCtx, useWorkspace } from './workspace'
import { useAddProject } from './addProject'
import { SearchInput } from './SearchInput'

function readLocations(): { projects: Record<string, string>; workspaces: Record<string, string> } {
  try {
    const value = JSON.parse(localStorage.getItem('ramu.navigation-locations') ?? '{}')
    const strings = (entries: unknown): Record<string, string> => entries && typeof entries === 'object' && !Array.isArray(entries)
      ? Object.fromEntries(Object.entries(entries).filter(([, entry]) => typeof entry === 'string')) : {}
    return { projects: strings(value?.projects), workspaces: strings(value?.workspaces) }
  } catch { return { projects: {}, workspaces: {} } }
}

/** Keep navigation memory mounted, while Chats uses its own project list. */
export function ProjectSwitcher() {
  useLanguage()
  const ws = useWorkspace()
  const active = ws.ui.activeTaskId
  const project = active ? ws.projectOf(active) : ws.projects.find((entry) => entry.id === ws.composing)
  const workspace = active ? ws.workspaceOf(active) : project ? projectCtx(project.id) : null
  const [locations] = useState(readLocations)
  const lastProject = useRef(locations.projects)
  const lastWorkspace = useRef(locations.workspaces)
  const [query, setQuery] = useState('')
  const addProject = useAddProject()
  useEffect(() => {
    if (active && project && workspace) {
      lastProject.current[project.id] = active
      lastWorkspace.current[workspace] = active
      try { localStorage.setItem('ramu.navigation-locations', JSON.stringify({ projects: lastProject.current, workspaces: lastWorkspace.current })) } catch { /* Keep navigation memory for this session. */ }
    }
  }, [active, project?.id, workspace])
  if (ws.ui.sidebar === 'schedules' || !project) return null
  const valid = (context: string | undefined, projectId: string) => context && ws.projectOf(context)?.id === projectId && (!ws.task(context) || ws.task(context)?.status !== 'archived')
  const switchProject = (projectId: string) => {
    if (projectId === project?.id) return
    // On the new-chat screen the project changes in place, so the Explorer and the message box stay together.
    if (ws.composing) { ws.newTask(projectId); setQuery(''); return }
    const previous = lastProject.current[projectId]
    if (valid(previous, projectId)) ws.openTask(previous!)
    else ws.openProject(projectId)
    setQuery('')
  }
  const choices = ws.projects.filter((entry) => `${entry.name} ${entry.root ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const items: MenuEntry[] = choices.map((entry) => ({
    key: entry.id, selected: entry.id === project?.id,
    label: <><Folder size={14} /><span className="menu-label grow">{entry.name}{entry.root && <span className="muted block">{entry.root}</span>}</span>{entry.id === project?.id && <Check size={13} />}</>,
    onSelect: () => switchProject(entry.id),
  }))
  if (!choices.length) items.push({ key: 'empty', label: t("No matching projects"), disabled: true })
  items.push({ key: 'separator', separator: true }, { key: 'add', searchChoice: false, label: <><FolderPlus size={14} />{t("Add project…")}</>, onSelect: () => void addProject.add() })
  const isolated = ws.workspaces.filter((entry) => entry.projectId === project?.id)
  const current = project ? projectCtx(project.id) : ''
  return <div className="workspace-scope">
    <Menu label={t("Switch project")} className="dropdown-trigger project-switch-trigger" menuClassName="project-switch-menu" disabled={addProject.busy} icon={<><Folder size={14} /><span className="dropdown-value">{project?.name ?? t("Choose project")}</span><ChevronDown size={12} /></>} header={<div className="project-switch-search"><SearchInput autoFocus aria-label={t("Search projects")} placeholder={t("Search projects…")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>} items={items} />
    {project && (isolated.length ? <Dropdown label={t("Switch checkout")} className="checkout-switch-trigger" icon={workspace === current ? <Laptop size={13} /> : <GitBranch size={13} />} value={workspace ?? current} options={[{ value: current, label: t("Current checkout") }, ...isolated.map((entry) => ({ value: worktreeCtx(entry.id), label: entry.name }))]} onChange={(context) => {
      const previous = lastWorkspace.current[context]
      ws.openTask(valid(previous, project.id) ? previous! : context)
    }} /> : null)}
    <span className="header-sep" aria-hidden="true">/</span>
  </div>
}
