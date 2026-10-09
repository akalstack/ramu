import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { beginPaneResize } from './paneResize'
import { Button } from '@/components/ui/button'
import { Columns2, PanelBottomClose, Plus, Rows2, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, type PointerEvent } from 'react'
import { useAppSettings } from './AppSettings'
import { Menu, useContextMenu } from './Menu'
import { terminalGroups } from '../../shared/terminalGroups'
import type { TerminalGroup, ViewDescriptor } from '../../shared/types'
import { TerminalView } from './views/TerminalView'
import { useWorkspace } from './workspace'

/** Each tab owns a group of panes. All shells stay mounted while other groups are hidden. */
export function TerminalPanel({ taskId, visible, hidden = false }: { taskId: string; visible: boolean; hidden?: boolean }) {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const panel = useRef<HTMLElement>(null)
  const state = ws.taskUi[taskId]
  const terminals = state?.views.filter((v) => v.kind === 'terminal') ?? []
  const groups = terminalGroups(state ?? { views: [], activeViewId: null })
  const activeId = state?.activeTerminalId ?? terminals.at(-1)?.id
  const activeGroup = groups.find((group) => group.terminalIds.includes(activeId ?? '')) ?? groups.at(-1)
  const focusedId = activeGroup?.terminalIds.includes(activeId ?? '') ? activeId : activeGroup?.terminalIds[0]
  const position = state?.terminalTabPosition ?? preferences.terminalTabPosition
  const open = !!terminals.length && (state?.terminalOpen ?? true)
  const focusTerminal = () => requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>('.terminal-pane.focused textarea')?.focus())
  useEffect(() => { if (open && visible && !hidden && !panel.current?.querySelector('.terminal-tabs')?.contains(document.activeElement)) focusTerminal() }, [open, visible, hidden, focusedId])
  const ready = (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready')
  const label = (repoId?: string) => repoId ? ws.binding(taskId, repoId)?.repoName ?? 'Terminal' : 'Workspace'
  const maxHeight = () => Math.max(120, (panel.current?.closest('.task-pane')?.getBoundingClientRect().height ?? 600) * 0.65)
  const height = state?.terminalHeight ?? 260
  const setHeight = (value: number) => ws.setTerminalPanel(taskId, { terminalHeight: Math.round(Math.max(120, Math.min(maxHeight(), value))) })
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])
  const resize = (event: PointerEvent) => {
    resizeCleanup.current?.()
    const startY = event.clientY, startHeight = panel.current!.getBoundingClientRect().height
    resizeCleanup.current = beginPaneResize(event, 'row', (next) => setHeight(startHeight + startY - next.clientY))
  }
  const arrange = (layout: TerminalGroup['layout']) => {
    if (activeGroup && state) ws.setTerminalPanel(taskId, { terminalGroups: groups.map((group) => group.id === activeGroup.id ? { ...group, layout } : group) })
  }
  const tabList = <TabsList className="terminal-tabs" aria-label="Terminal groups">
    {groups.map((group, index) => <TerminalTab key={group.id} taskId={taskId} group={group} groups={groups} index={index} label={label(terminals.find((view) => view.id === group.terminalIds[0])?.repoId)} active={group.id === activeGroup?.id} activeId={focusedId} />)}
  </TabsList>
  return <Tabs value={activeGroup?.id ?? null} orientation={position === 'top' ? 'horizontal' : 'vertical'} onValueChange={(value) => {
    const group = groups.find((entry) => entry.id === value)
    if (group) ws.activateView(taskId, group.id === activeGroup?.id && focusedId ? focusedId : group.terminalIds[0]!)
  }} render={<section />} ref={(element) => { panel.current = element }} className="terminal-panel" aria-label="Terminal panel" style={{ display: open && !hidden ? 'flex' : 'none', height }}>
    <div className="terminal-resize" role="separator" tabIndex={0} aria-label="Resize terminal panel" aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={Math.round(maxHeight())} aria-valuenow={height} onPointerDown={resize} onKeyDown={(event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); setHeight(event.key === 'Home' ? 120 : event.key === 'End' ? maxHeight() : height + (event.key === 'ArrowUp' ? 20 : -20))
    }} />
    <header className="terminal-toolbar">
      {position === 'top' ? tabList : <span className="terminal-panel-title">Terminal</span>}
      <Menu label="New terminal" icon={<Plus size={15} />} className="ghost icon small-icon terminal-add" align="start" items={[
        { key: 'workspace', label: <><SquareTerminal size={14} /> Workspace terminal</>, onSelect: () => ws.openView(taskId, { kind: 'terminal' }) },
        ...ready.map((b) => ({ key: b.repoId, label: <><SquareTerminal size={14} /> Terminal in {b.repoName}</>, onSelect: () => ws.openView(taskId, { kind: 'terminal', repoId: b.repoId }) })),
      ]} />
      <div className="grow" />
      <Menu label="Terminal layout" icon={<Columns2 size={14} />} className="ghost icon small-icon" align="end" items={[
        { key: 'split-h', label: <><Columns2 size={14} /> Split side by side</>, onSelect: () => ws.splitTerminal(taskId, 'horizontal') },
        { key: 'split-v', label: <><Rows2 size={14} /> Split stacked</>, onSelect: () => ws.splitTerminal(taskId, 'vertical') },
        { key: 'unsplit', label: 'Move active pane to a new tab', disabled: (activeGroup?.terminalIds.length ?? 0) < 2, onSelect: () => focusedId && ws.unsplitTerminal(taskId, focusedId) },
        { key: 'sep1', separator: true },
        { key: 'horizontal', label: 'Arrange group side by side', onSelect: () => arrange('horizontal') },
        { key: 'vertical', label: 'Arrange group stacked', onSelect: () => arrange('vertical') },
        { key: 'sep2', separator: true },
        { key: 'top', label: 'Tabs across the top', selected: position === 'top', onSelect: () => ws.setTerminalPanel(taskId, { terminalTabPosition: 'top' }) },
        { key: 'right', label: 'Tabs down the right', selected: position === 'right', onSelect: () => ws.setTerminalPanel(taskId, { terminalTabPosition: 'right' }) },
      ]} />
      <Button className="ghost icon small-icon" aria-label="Hide terminal panel" title="Hide terminal panel" onClick={() => ws.setTerminalPanel(taskId, { terminalOpen: false })}><PanelBottomClose size={14} /></Button>
    </header>
    <div className={`terminal-panel-body tabs-${position}`}>
      {position === 'right' && tabList}
      <TabsContent value={activeGroup?.id ?? null} keepMounted className={`terminal-panes layout-${activeGroup?.layout ?? 'horizontal'}`} id={`terminal-group-panel-${taskId}`} aria-label="Active terminal group">
        {terminals.map((view) => {
          const shown = !!activeGroup?.terminalIds.includes(view.id)
          return <div key={view.id} className={`view terminal-pane${view.id === focusedId ? ' focused' : ''}`} style={{ display: shown ? 'flex' : 'none' }} onFocusCapture={() => view.id !== focusedId && ws.activateView(taskId, view.id)}>
            <TerminalView taskId={taskId} repoId={view.repoId ?? null} label={label(view.repoId)} active={shown && open && visible && !hidden} onExit={() => ws.closeView(taskId, view.id)} actions={<>
              <Button className="ghost icon small-icon" aria-label={`Move ${label(view.repoId)} pane to a new tab`} title="Move pane to a new tab" disabled={!shown || activeGroup!.terminalIds.length < 2} onClick={() => ws.unsplitTerminal(taskId, view.id)}><SquareTerminal size={12} /></Button>
              <Button className="ghost icon small-icon" aria-label={`Close ${label(view.repoId)} terminal pane`} title="Close pane" onClick={() => ws.closeView(taskId, view.id)}><X size={12} /></Button>
            </>} />
          </div>
        })}
      </TabsContent>
    </div>
  </Tabs>
}

function TerminalTab({ taskId, group, groups, index, label, active, activeId }: { taskId: string; group: TerminalGroup; groups: TerminalGroup[]; index: number; label: string; active: boolean; activeId?: string }) {
  const ws = useWorkspace()
  const close = (entries: TerminalGroup[]) => ws.closeViews(taskId, entries.flatMap((entry) => entry.terminalIds))
  const target = active && activeId ? activeId : group.terminalIds[0]!
  const activate = () => ws.activateView(taskId, target)
  const split = (direction: 'horizontal' | 'vertical') => { activate(); ws.splitTerminal(taskId, direction) }
  const context = useContextMenu('Terminal group actions', [
    { key: 'split', label: 'Split side by side', onSelect: () => split('horizontal') },
    { key: 'stack', label: 'Split stacked', onSelect: () => split('vertical') },
    { key: 'unsplit', label: 'Move active pane to a new tab', disabled: group.terminalIds.length < 2, onSelect: () => ws.unsplitTerminal(taskId, target) },
    { key: 'separator', separator: true },
    { key: 'close', label: 'Close group', onSelect: () => close([group]) },
    { key: 'others', label: 'Close other groups', disabled: groups.length < 2, onSelect: () => close(groups.filter((entry) => entry.id !== group.id)) },
    { key: 'left', label: 'Close groups before this', disabled: index === 0, onSelect: () => close(groups.slice(0, index)) },
    { key: 'right', label: 'Close groups after this', disabled: index === groups.length - 1, onSelect: () => close(groups.slice(index + 1)) },
    { key: 'all', label: 'Close all terminals', onSelect: () => close(groups) },
  ])
  return <div className={`terminal-tab${active ? ' active' : ''}`} onContextMenu={context.onContextMenu} onKeyDown={context.onKeyDown}>
    <TabsTrigger value={group.id} title={`${label} · ${group.terminalIds.length} ${group.terminalIds.length === 1 ? 'terminal' : 'panes'}`}><SquareTerminal size={13} /><span>{label}{groups.length > 1 ? ` ${index + 1}` : ''}</span>{group.terminalIds.length > 1 && <span className="terminal-group-count" aria-label={`${group.terminalIds.length} panes`}>{group.terminalIds.length}</span>}</TabsTrigger>
    <Button className="ghost icon small-icon terminal-tab-close" aria-label={`Close terminal group ${index + 1}`} title="Close group" onClick={() => close([group])}><X size={12} /></Button>
    {context.menu}
  </div>
}
