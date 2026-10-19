import { t, useLanguage } from '../i18n'
import { Check, ChevronDown, Folder, FolderPlus, GitBranch, Laptop } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Dropdown, Menu, type MenuEntry } from '../Menu'
import { projectCtx, worktreeCtx, useWorkspace } from './workspace'
import { useAddProject } from './addProject'
import { SearchInput } from '../SearchInput'
import { hostStorageFor, type HostStorage } from '../hostStorage'
import { useHost } from './HostProvider'

function readLocations(hostStorage: HostStorage): {
  projects: Record<string, string>
  workspaces: Record<string, string>
} {
  try {
    const value = JSON.parse(hostStorage.getItem('ramu.navigation-locations') ?? '{}')
    const strings = (entries: unknown): Record<string, string> =>
      entries && typeof entries === 'object' && !Array.isArray(entries)
        ? Object.fromEntries(Object.entries(entries).filter(([, entry]) => typeof entry === 'string'))
        : {}
    return { projects: strings(value?.projects), workspaces: strings(value?.workspaces) }
  } catch {
    return { projects: {}, workspaces: {} }
  }
}

/** Keep navigation memory mounted, while Chats uses its own project list. */
export function ProjectSwitcher() {
  useLanguage()
  const hostStorage = hostStorageFor(useHost().id)
  const ws = useWorkspace()
  const active = ws.ui.activeTaskId
  const project = active ? ws.projectOf(active) : ws.projects.find((entry) => entry.id === ws.composing)
  const workspace = active ? ws.workspaceOf(active) : project ? projectCtx(project.id) : null
  const [locations] = useState(() => readLocations(hostStorage))
  const lastProject = useRef(locations.projects)
  const lastWorkspace = useRef(locations.workspaces)
  const [query, setQuery] = useState('')
  const addProject = useAddProject()
  useEffect(() => {
    if (active && project && workspace) {
      lastProject.current[project.id] = active
      lastWorkspace.current[workspace] = active
      try {
        hostStorage.setItem(
          'ramu.navigation-locations',
          JSON.stringify({ projects: lastProject.current, workspaces: lastWorkspace.current }),
        )
      } catch {
        /* Keep navigation memory for this session. */
      }
    }
  }, [active, project?.id, workspace])
  if (ws.ui.sidebar === 'schedules' || ws.ui.sidebar === 'inbox' || !project) return null
  const valid = (context: string | undefined, projectId: string) =>
    context && ws.projectOf(context)?.id === projectId && (!ws.task(context) || ws.task(context)?.status !== 'archived')
  const switchProject = (projectId: string) => {
    if (projectId === project?.id) return
    // On the new-chat screen the project changes in place, so the Explorer and the message box stay together.
    if (ws.composing) {
      ws.newTask(projectId)
      setQuery('')
      return
    }
    const previous = lastProject.current[projectId]
    if (valid(previous, projectId)) ws.openTask(previous!)
    else ws.openProject(projectId)
    setQuery('')
  }
  const choices = ws.projects.filter((entry) =>
    `${entry.name} ${entry.root ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  )
  const items: MenuEntry[] = choices.map((entry) => ({
    key: entry.id,
    selected: entry.id === project?.id,
    label: (
      <>
        <Folder size={14} />
        <span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis grow flex-1 min-w-0 text-left">
          {entry.name}
          {entry.root && <span className="muted text-muted-foreground block block">{entry.root}</span>}
        </span>
        {entry.id === project?.id && <Check size={13} />}
      </>
    ),
    onSelect: () => switchProject(entry.id),
  }))
  if (!choices.length) items.push({ key: 'empty', label: t('No matching projects'), disabled: true })
  items.push(
    { key: 'separator', separator: true },
    {
      key: 'add',
      searchChoice: false,
      label: (
        <>
          <FolderPlus size={14} />
          {t('Add project…')}
        </>
      ),
      onSelect: () => void addProject.add(),
    },
  )
  const isolated = ws.workspaces.filter((entry) => entry.projectId === project?.id)
  const current = project ? projectCtx(project.id) : ''
  return (
    <div className="workspace-scope [&_.project-switch-trigger]:text-muted-foreground [&_.project-switch-trigger]:font-medium [&_.project-switch-trigger]:m-0 [&_.project-switch-trigger]:w-auto [&_.project-switch-trigger]:min-w-0 [&_.project-switch-trigger]:max-w-[180px] [&_.project-switch-trigger]:bg-transparent [&_.project-switch-trigger]:[border-color:transparent] [&_.project-switch-trigger:hover:not(:disabled)]:text-foreground [&_.project-switch-trigger:hover:not(:disabled)]:bg-hover [&_.checkout-switch-trigger]:m-0 [&_.checkout-switch-trigger]:w-auto [&_.checkout-switch-trigger]:min-w-0 [&_.checkout-switch-trigger]:p-[4px_6px] [&_.checkout-switch-trigger]:text-caption [&_.checkout-switch-trigger]:whitespace-nowrap [&_.checkout-switch-trigger]:max-w-[180px] [&_.checkout-switch-trigger]:overflow-hidden [&_.sidebar-checkout]:m-0 [&_.sidebar-checkout]:w-auto [&_.sidebar-checkout]:min-w-0 [&_.sidebar-checkout]:p-[4px_6px] [&_.sidebar-checkout]:text-caption [&_.sidebar-checkout]:whitespace-nowrap [&_.sidebar-checkout]:max-w-[180px] [&_.sidebar-checkout]:overflow-hidden flex items-center gap-0.5 flex-initial min-w-0 max-w-[min(360px,30vw)] mr-2 [-webkit-app-region:no-drag]">
      <Menu
        label={t('Switch project')}
        className="dropdown-trigger [&_>_svg]:flex-none [&_>_svg]:w-3.5 [&_>_svg]:h-3.5 [&_>_svg]:text-soft [&_>_svg:last-child]:w-3 [&_>_svg:last-child]:h-3 [&_>_svg:last-child]:ml-auto [&_>_svg:last-child]:text-muted-foreground [&:hover]:bg-hover [&.on]:bg-hover [&.control-btn]:min-h-6 [&.control-btn]:p-[3px_4px] [&.control-btn]:[border:0] [&.control-btn]:bg-transparent [&.control-btn]:text-caption [&.control-btn]:leading-[18px] [&.control-btn]:gap-[5px] [&.control-btn:hover]:bg-hover [&.control-btn.on]:bg-hover [.sidebar-scope_&_>_svg:last-child]:ml-auto [.sidebar-scope_&_>_svg:last-child]:text-muted-foreground [:is(.settings-page-content,_.schedule-editor,_.schedule-card,_.changes-page,_.home-page,_.dialog,_.model-settings)_&_>_svg:last-child]:text-muted-foreground flex items-center gap-2 min-h-[30px] p-[5px_10px] [border:1px_solid_transparent] rounded-(--radius-s) text-[length:var(--ui-font-size)] leading-[18px] text-left bg-fill project-switch-trigger"
        menuClassName="project-switch-menu w-[340px] max-w-[calc(100vw_-_16px)] max-h-[min(480px,_calc(100vh_-_16px))] overflow-y-auto p-1"
        disabled={addProject.busy}
        icon={
          <>
            <Folder size={14} />
            <span className="dropdown-value [.sidebar-scope_&]:block [.sidebar-scope_&]:flex-1 [.sidebar-scope_&]:relative [.sidebar-scope_&]:top-[-1px] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {project?.name ?? t('Choose project')}
            </span>
            <ChevronDown size={12} />
          </>
        }
        header={
          <div className="project-switch-search sticky top-[-4px] z-2 m-[-4px_-4px_4px] p-[8px_8px_8px] [border-radius:var(--radius-row)_var(--radius-row)_0_0] [background:color-mix(in_srgb,_var(--raised)_50%,_transparent)] [-webkit-backdrop-filter:blur(20px)] [backdrop-filter:blur(20px)] [&_.search-input_>_input]:h-[30px] [&_.search-input_>_input]:min-h-[30px] p-[4px_4px_8px] sticky top-0 [background:inherit] z-1">
            <SearchInput
              autoFocus
              aria-label={t('Search projects')}
              placeholder={t('Search projects…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        }
        items={items}
      />
      {project &&
        (isolated.length ? (
          <Dropdown
            label={t('Switch checkout')}
            className="checkout-switch-trigger"
            icon={workspace === current ? <Laptop size={13} /> : <GitBranch size={13} />}
            value={workspace ?? current}
            options={[
              { value: current, label: t('Current checkout') },
              ...isolated.map((entry) => ({ value: worktreeCtx(entry.id), label: entry.name })),
            ]}
            onChange={(context) => {
              const previous = lastWorkspace.current[context]
              ws.openTask(valid(previous, project.id) ? previous! : context)
            }}
          />
        ) : null)}
    </div>
  )
}
