import { t, useLanguage } from './i18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { beginPaneResize } from './paneResize'
import { Button } from '@/components/desktop-button'
import { PaneHeader, paneActionClass } from '@/components/pane-header'
import { Columns2, Ellipsis, Plus, Rows2, SquareTerminal, Trash2, X } from 'lucide-react'
import { useEffect, useRef, type PointerEvent } from 'react'
import { useAppSettings } from './AppSettings'
import { Menu, useContextMenu } from './Menu'
import { terminalGroups } from '../../shared/terminalGroups'
import type { TerminalGroup } from '../../shared/types'
import { TerminalView } from './views/TerminalView'
import { useWorkspace } from './workspace'

/** Each tab owns a group of panes. All shells stay mounted while other groups are hidden. */
export function TerminalPanel({ taskId, visible, hidden = false, dock = 'right' }: { taskId: string; visible: boolean; hidden?: boolean; dock?: 'right' | 'bottom' }) {
  useLanguage()
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
  const repoLabel = (repoId?: string) => repoId ? ws.binding(taskId, repoId)?.repoName ?? 'Terminal' : 'Workspace'
  const label = (view?: { repoId?: string; title?: string }) => view?.title ?? repoLabel(view?.repoId)
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
  const tabList = <TabsList className="terminal-tabs [&[data-slot='tabs-list']]:w-auto [&[data-slot='tabs-list']]:h-auto [&[data-slot='tabs-list']]:[border-radius:0] [&[data-slot='tabs-list']]:p-0 [&[data-slot='tabs-list']]:bg-transparent [&[data-slot='tabs-list']]:justify-start [.tabs-right_&[data-slot='tabs-list']]:flex-col flex flex-none gap-0.5 p-[2px_8px] overflow-auto [border-bottom-color:var(--line)]" aria-label={t("Terminal groups")}>
    {groups.map((group, index) => <TerminalTab key={group.id} taskId={taskId} group={group} groups={groups} index={index} label={label(terminals.find((view) => view.id === group.terminalIds[0]))} active={group.id === activeGroup?.id} activeId={focusedId} onActivate={focusTerminal} />)}
  </TabsList>
  return <Tabs value={activeGroup?.id ?? null} orientation={position === 'top' ? 'horizontal' : 'vertical'} onValueChange={(value) => {
    const group = groups.find((entry) => entry.id === value)
    if (group) ws.activateView(taskId, group.id === activeGroup?.id && focusedId ? focusedId : group.terminalIds[0]!)
  }} render={<section />} ref={(element) => { panel.current = element }} className={`terminal-panel [&[data-slot='tabs']]:gap-0 [.workspace-panel_>_&]:flex-none [.workspace-panel_>_&]:max-h-[65%] [.workspace-panel.terminal-only_>_&]:flex-1 [.workspace-panel.terminal-only_>_&]:h-auto! [.workspace-panel.terminal-only_>_&]:max-h-[none] relative flex-none min-h-[120px] max-h-[65%] min-w-0 flex-col bg-[var(--code-bg)] [border:1px_solid_var(--line)] overflow-hidden border-b-0! [border-radius:var(--radius-m)_var(--radius-m)_0_0] dock-${dock}`} aria-label={t("Terminal panel")} style={{ display: open && !hidden ? 'flex' : 'none', height }}>
    {dock === 'bottom' && <div className="terminal-resize [&:hover]:bg-transparent [&::after]:[content:''] [&::after]:absolute [&::after]:left-0 [&::after]:right-0 [&::after]:top-1 [&::after]:bg-transparent [&::after]:[transition:background_0.15s] [&::after]:h-[var(--pane-border-width)] [&:hover::after]:[background:var(--pane-border-active)] [&.is-resizing::after]:[background:var(--pane-border-active)] [&:focus-visible::after]:[background:var(--pane-border-active)] [.workspace-panel.terminal-only_&]:hidden absolute left-0 right-0 cursor-row-resize z-3 top-[-4px] h-[9px] bg-transparent" role="separator" tabIndex={0} aria-label={t("Resize terminal panel")} aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={Math.round(maxHeight())} aria-valuenow={height} onPointerDown={resize} onKeyDown={(event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); setHeight(event.key === 'Home' ? 120 : event.key === 'End' ? maxHeight() : height + (event.key === 'ArrowUp' ? 20 : -20))
    }} />}
    <PaneHeader className="terminal-toolbar" title={t("Terminal")} ariaLabel={t("Terminal actions")} actions={<>
        <Menu standard label={t("New terminal")} icon={<Plus size={15} />} className={paneActionClass} align="end" items={[
          { key: 'workspace', label: <><SquareTerminal size={14} /> {t(" Workspace terminal")}</>, onSelect: () => ws.openView(taskId, { kind: 'terminal' }) },
          ...ready.map((b) => ({ key: b.repoId, label: <><SquareTerminal size={14} /> {t(" Terminal in ")}{b.repoName}</>, onSelect: () => ws.openView(taskId, { kind: 'terminal', repoId: b.repoId }) })),
        ]} />
        <Button variant="ghost" size="icon-xs" className={paneActionClass} aria-label={t(" Split side by side").trim()} title={t(" Split side by side").trim()} onClick={() => ws.splitTerminal(taskId, 'horizontal')}><Columns2 size={14} /></Button>
        <Button variant="ghost" size="icon-xs" className={paneActionClass} aria-label={t("Close group")} title={t("Close group")} disabled={!activeGroup} onClick={() => activeGroup && ws.closeViews(taskId, activeGroup.terminalIds)}><Trash2 size={14} /></Button>
        <Menu standard label={t("Terminal layout")} icon={<Ellipsis size={15} />} className={paneActionClass} align="end" items={[
          { key: 'split-h', label: <><Columns2 size={14} /> {t(" Split side by side")}</>, onSelect: () => ws.splitTerminal(taskId, 'horizontal') },
          { key: 'split-v', label: <><Rows2 size={14} /> {t(" Split stacked")}</>, onSelect: () => ws.splitTerminal(taskId, 'vertical') },
          { key: 'unsplit', label: t("Move active pane to a new tab"), disabled: (activeGroup?.terminalIds.length ?? 0) < 2, onSelect: () => focusedId && ws.unsplitTerminal(taskId, focusedId) },
          { key: 'sep1', separator: true },
          { key: 'horizontal', label: t("Arrange group side by side"), onSelect: () => arrange('horizontal') },
          { key: 'vertical', label: t("Arrange group stacked"), onSelect: () => arrange('vertical') },
          { key: 'sep2', separator: true },
          { key: 'dock-right', label: t("Dock terminal on right"), selected: dock === 'right', onSelect: () => ws.setTerminalPanel(taskId, { terminalDock: 'right' }) },
          { key: 'dock-bottom', label: t("Dock terminal at bottom"), selected: dock === 'bottom', onSelect: () => ws.setTerminalPanel(taskId, { terminalDock: 'bottom' }) },
          { key: 'sep3', separator: true },
          { key: 'top', label: t("Tabs across the top"), selected: position === 'top', onSelect: () => ws.setTerminalPanel(taskId, { terminalTabPosition: 'top' }) },
          { key: 'right', label: t("Tabs down the right"), selected: position === 'right', onSelect: () => ws.setTerminalPanel(taskId, { terminalTabPosition: 'right' }) },
        ]} />
        <Button variant="ghost" size="icon-xs" className={paneActionClass} aria-label={t("Hide terminal panel")} title={t("Hide terminal panel")} onClick={() => ws.setTerminalPanel(taskId, { terminalOpen: false })}><X size={15} /></Button>
      </>}>
      {position === 'top' && groups.length > 1 && tabList}
    </PaneHeader>
    <div className={`terminal-panel-body [&.tabs-top]:flex-col [&.tabs-right_.terminal-tabs]:[order:1] [&.tabs-right_.terminal-tabs]:w-[164px] [&.tabs-right_.terminal-tabs]:flex-col [&.tabs-right_.terminal-tabs]:[border-bottom:none] [&.tabs-right_.terminal-tabs]:[border-left:1px_solid_var(--line)] [&.tabs-right_.terminal-tabs]:p-1 flex flex-1 min-h-0 min-w-0 tabs-${position}`}>
      {position === 'right' && groups.length > 1 && tabList}
      <TabsContent value={activeGroup?.id ?? null} keepMounted className={`terminal-panes [&.layout-vertical]:flex-col [&.layout-tabs_.terminal-pane_>_.terminal-view_>_.view-header]:hidden [&:not(:has(.terminal-pane:not([style*='none'])_~_.terminal-pane:not([style*='none'])))_.terminal-view_>_.view-header]:hidden flex flex-1 min-w-0 min-h-0 overflow-auto layout-${activeGroup?.layout ?? 'horizontal'}`} id={`terminal-group-panel-${taskId}`} aria-label={t("Active terminal group")}>
        {terminals.map((view) => {
          const shown = !!activeGroup?.terminalIds.includes(view.id)
          return <div key={view.id} className={`view flex-1 min-w-0 min-h-0 flex-col terminal-pane [.layout-horizontal_&_+_.terminal-pane]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] [.layout-vertical_&_+_.terminal-pane]:[border-top:var(--pane-border-width)_solid_var(--pane-border-color)] [&_.view-header]:h-6 [&_.view-header]:p-[0_8px] [&_.view-header]:gap-2 [&_.view-header]:text-caption [&_.view-header]:overflow-hidden [&_.view-header_.path]:text-caption [&_.view-header_.path]:whitespace-nowrap [&_.view-header_.path]:overflow-hidden [&_.view-header_.path]:text-ellipsis [&_.terminal-host]:p-[4px_0_0_8px] [&_.terminal-host]:pt-1.5 [&.focused_.view-header]:text-foreground [&_.view-header_.small-icon]:w-5 [&_.view-header_.small-icon]:h-5 [&_.view-header_.small-icon]:min-h-5 [&.focused]:[box-shadow:none] min-w-[120px] min-h-[80px] ${view.id === focusedId ? ' focused' : ''}`} style={{ display: shown ? 'flex' : 'none' }} onFocusCapture={() => view.id !== focusedId && ws.activateView(taskId, view.id)}>
            <TerminalView taskId={taskId} repoId={view.repoId ?? null} label={label(view)} run={view.command && view.runAt && Date.now() - view.runAt < 15_000 ? view.command : undefined} active={shown && open && visible && !hidden} onExit={() => ws.closeView(taskId, view.id)} actions={<>
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Move {0} pane to a new tab", { "0": label(view) })} title={t("Move pane to a new tab")} disabled={!shown || activeGroup!.terminalIds.length < 2} onClick={() => ws.unsplitTerminal(taskId, view.id)}><SquareTerminal size={12} /></Button>
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Close {0} terminal pane", { "0": label(view) })} title={t("Close pane")} onClick={() => ws.closeView(taskId, view.id)}><X size={12} /></Button>
            </>} />
          </div>
        })}
      </TabsContent>
    </div>
  </Tabs>
}

function TerminalTab({ taskId, group, groups, index, label, active, activeId, onActivate }: { taskId: string; group: TerminalGroup; groups: TerminalGroup[]; index: number; label: string; active: boolean; activeId?: string; onActivate: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const close = (entries: TerminalGroup[]) => ws.closeViews(taskId, entries.flatMap((entry) => entry.terminalIds))
  const target = active && activeId ? activeId : group.terminalIds[0]!
  const activate = () => ws.activateView(taskId, target)
  const split = (direction: 'horizontal' | 'vertical') => { activate(); ws.splitTerminal(taskId, direction) }
  const context = useContextMenu('Terminal group actions', [
    { key: 'split', label: t("Split side by side"), onSelect: () => split('horizontal') },
    { key: 'stack', label: t("Split stacked"), onSelect: () => split('vertical') },
    { key: 'unsplit', label: t("Move active pane to a new tab"), disabled: group.terminalIds.length < 2, onSelect: () => ws.unsplitTerminal(taskId, target) },
    { key: 'separator', separator: true },
    { key: 'close', label: t("Close group"), onSelect: () => close([group]) },
    { key: 'others', label: t("Close other groups"), disabled: groups.length < 2, onSelect: () => close(groups.filter((entry) => entry.id !== group.id)) },
    { key: 'left', label: t("Close groups before this"), disabled: index === 0, onSelect: () => close(groups.slice(0, index)) },
    { key: 'right', label: t("Close groups after this"), disabled: index === groups.length - 1, onSelect: () => close(groups.slice(index + 1)) },
    { key: 'all', label: t("Close all terminals"), onSelect: () => close(groups) },
  ])
  return <div className={`terminal-tab [&.active]:bg-accent [&.active]:text-foreground [&_>_button[role='tab']]:[border:none] [&_>_button[role='tab']]:bg-transparent [&_>_button[role='tab']]:min-w-0 [&_>_button[role='tab']]:h-[26px] [&_>_button[role='tab']]:min-h-[26px] [&_>_button[role='tab']]:p-[0_4px_0_8px] [&_>_button[role='tab']]:gap-1.5 [&_>_button[role='tab']]:text-control [&_>_button[role='tab']]:text-inherit [&_>_button[role='tab']]:rounded-(--radius-s) [&_>_button[role='tab']_span]:overflow-hidden [&_>_button[role='tab']_span]:text-ellipsis [&_>_button[role='tab']_span]:whitespace-nowrap [&_>_button[role='tab']_svg]:flex-none [.tabs-right_&_>_button[role='tab']]:flex-1 [&:not(.active):hover]:bg-hover [&:not(.active):hover]:text-soft [&:hover_.terminal-tab-close]:opacity-100 [&.active_.terminal-tab-close]:opacity-100 [&_[data-slot='tabs-trigger']::after]:hidden flex items-center text-muted-foreground flex-none h-[26px] rounded-(--radius-s) [transition:background_0.12s_var(--ease),_color_0.12s_var(--ease)] ${active ? ' active' : ''}`} onContextMenu={context.onContextMenu} onKeyDown={context.onKeyDown}>
    <TabsTrigger value={group.id} onClick={onActivate} title={`${label} · ${group.terminalIds.length} ${group.terminalIds.length === 1 ? 'terminal' : 'panes'}`}><SquareTerminal size={13} /><span>{label}{groups.length > 1 ? ` ${index + 1}` : ''}</span>{group.terminalIds.length > 1 && <span className="terminal-group-count min-w-4 p-[0_4px] rounded-(--radius-xs) bg-accent text-muted-foreground text-[length:10px]" aria-label={t("{0} panes", { "0": group.terminalIds.length })}>{group.terminalIds.length}</span>}</TabsTrigger>
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) terminal-tab-close opacity-0 text-muted-foreground" aria-label={t("Close terminal group {0}", { "0": index + 1 })} title={t("Close group")} onClick={() => close([group])}><X size={12} /></Button>
    {context.menu}
  </div>
}
