import { SearchInput } from './SearchInput'
import { Check, ChevronDown, MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NO_PROJECT } from '../../shared/types'
import { Menu, type MenuEntry } from './Menu'
import { useWorkspace } from './workspace'

export function ChatSwitcher({ contextId, docked = false }: { contextId: string; docked?: boolean }) {
  const ws = useWorkspace()
  const project = ws.projectOf(contextId)
  const current = ws.task(contextId)
  const [search, setSearch] = useState('')
  useEffect(() => setSearch(''), [contextId])
  const workspaceName = (workspaceId: string | null) => workspaceId ? ws.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? 'Isolated worktree' : 'Current checkout'
  const query = search.trim().toLowerCase()
  const choices = ws.tasks.filter((chat) => chat.status !== 'archived' && `${chat.title} ${ws.projects.find((entry) => entry.id === chat.projectId)?.name ?? ''} ${workspaceName(chat.workspaceId)}`.toLowerCase().includes(query)).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const groups = [{ id: NO_PROJECT, name: 'No project', root: null, createdAt: 0 }, ...ws.projects].filter((entry) => choices.some((chat) => chat.projectId === entry.id)).sort((a, b) => {
    if (a.id === project?.id) return -1
    if (b.id === project?.id) return 1
    return (choices.find((chat) => chat.projectId === b.id)?.lastActiveAt ?? 0) - (choices.find((chat) => chat.projectId === a.id)?.lastActiveAt ?? 0)
  })
  const items: MenuEntry[] = groups.flatMap((entry) => [
    { key: `project:${entry.id}`, heading: entry.name },
    ...choices.filter((chat) => chat.projectId === entry.id).map((chat) => ({
      key: chat.id, selected: chat.id === contextId,
      title: `${chat.title}\n${entry.name} · ${workspaceName(chat.workspaceId)}`,
      label: <><MessageSquare size={14} /><span className="menu-label grow">{chat.title}<span className="muted block">{entry.name} · {workspaceName(chat.workspaceId)}</span></span>{chat.id === contextId && <Check size={13} className="chat-choice-selected" />}</>,
      // Each checkout owns its editor and terminal state; the destination restores it.
      onSelect: () => ws.openTask(chat.id),
    })),
  ])
  return <Menu label="Switch chat" className="chat-switch-btn no-drag" menuClassName="chat-switch-menu" align={docked ? 'end' : 'start'}
    icon={<><span className={current ? 'header-title' : 'header-secondary'}>{current?.title ?? 'Chats'}</span><ChevronDown size={13} /></>}
    header={<div className="chat-switch-search"><SearchInput autoFocus aria-label="Search chats across projects" placeholder="Search chats or projects…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>}
    items={items.length ? items : [{ key: 'empty', label: search ? 'No matching chats' : 'No chats yet', disabled: true }]} />
}
