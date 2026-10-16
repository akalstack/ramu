import { Button } from '@/components/desktop-button'
import { X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { t, useLanguage } from '../i18n'
import { ExplorerPanel } from '../sidebar/ExplorerPanel'
import { ScmPanel } from '../sidebar/ScmPanel'
import { SearchPanel } from '../sidebar/SearchPanel'
import { useWorkspace } from './workspace'

export type WorkspaceTool = 'explorer' | 'search' | 'scm'

export const workspaceToolOf = (sidebar: string): WorkspaceTool | null =>
  sidebar === 'explorer' || sidebar === 'search' || sidebar === 'scm' ? sidebar : null

const TOOLS = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'search', label: 'Search' },
  { id: 'scm', label: 'Source Control' },
] as const

/** Explorer, Search and Source Control share one rail inside the right pane; the top bar picks the tool, and the rail's close button hides only the rail. */
export function WorkspaceTools({ tool }: { tool: WorkspaceTool }) {
  useLanguage()
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  return (
    <aside
      className="workspace-tools [&_.sidebar-body]:flex-1 [&_.sidebar-body]:min-h-0 [&_.explorer-title]:m-[0_0_4px] [&_.explorer-title]:min-h-7 [&_.search-title]:m-[0_0_4px] [&_.search-title]:min-h-7 flex flex-col h-full min-w-0 min-h-0 overflow-hidden"
      aria-label={t(TOOLS.find((entry) => entry.id === tool)!.label)}
    >
      <header className="flex flex-none items-center gap-2 min-h-[40px] px-3 py-1.5 text-control font-semibold text-soft">
        <span className="grow flex-1 min-w-0 truncate text-left">
          {t(TOOLS.find((entry) => entry.id === tool)!.label)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center"
          aria-label={t('Hide {0}', { '0': t(TOOLS.find((entry) => entry.id === tool)!.label) })}
          title={t('Hide {0}', { '0': t(TOOLS.find((entry) => entry.id === tool)!.label) })}
          onClick={() => ws.setSidebar('projects')}
        >
          <X data-icon="inline-start" />
        </Button>
      </header>
      <CachedTool active={tool === 'explorer'}>
        <ExplorerPanel />
      </CachedTool>
      <CachedTool active={tool === 'scm'}>
        <ScmPanel />
      </CachedTool>
      <CachedTool active={tool === 'search'}>
        <SearchPanel key={taskId ? ws.workspaceOf(taskId) : 'empty'} />
      </CachedTool>
    </aside>
  )
}

/** Cache visited tools across switching and reopening; hidden tools keep their drafts and scroll. */
function CachedTool({ active, children }: { active: boolean; children: ReactNode }) {
  const visited = useRef(active)
  if (active) visited.current = true
  if (!visited.current) return null
  return (
    <div
      className="sidebar-body flex-col flex-1 min-h-0 min-w-0 overflow-auto [&:has(.scm-panel)]:overflow-hidden [&:has(.explorer-panel)]:overflow-hidden"
      style={{ display: active ? 'flex' : 'none' }}
      inert={!active}
      aria-hidden={!active}
    >
      {children}
    </div>
  )
}

const RAIL_WIDTH = { key: 'ramu.layout.tools-rail', min: 220, max: 480, fallback: 280 }
const savedRailWidth = () =>
  Math.min(
    RAIL_WIDTH.max,
    Math.max(RAIL_WIDTH.min, Number(localStorage.getItem(RAIL_WIDTH.key)) || RAIL_WIDTH.fallback),
  )

/** The tools rail beside the whole task stack, full height, with a draggable inner edge. The width is written straight to the element while dragging and saved on release. */
export function WorkspaceRail({ tool }: { tool: WorkspaceTool }) {
  const rail = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(savedRailWidth)
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget,
      startX = event.clientX,
      start = rail.current!.offsetWidth
    handle.setPointerCapture(event.pointerId)
    document.documentElement.dataset.railDragging = ''
    handle.dataset.sashActive = ''
    let next = start
    // One style write per frame, however many pointer events arrive in it.
    let frame = 0
    const move = (e: PointerEvent) => {
      next = Math.round(Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, start + startX - e.clientX)))
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (rail.current) rail.current.style.width = `${next}px`
      })
    }
    const end = () => {
      cancelAnimationFrame(frame)
      if (rail.current) rail.current.style.width = `${next}px`
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      delete document.documentElement.dataset.railDragging
      delete handle.dataset.sashActive
      localStorage.setItem(RAIL_WIDTH.key, String(next))
      setWidth(next)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const keyboard = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
    if (!step) return
    event.preventDefault()
    const next = Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, width + step))
    localStorage.setItem(RAIL_WIDTH.key, String(next))
    setWidth(next)
  }
  return (
    <div
      ref={rail}
      className="workspace-rail relative flex-none h-full min-w-0 [border-left:1px_solid_var(--pane-border-color)]"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Resize tools panel')}
        aria-valuemin={RAIL_WIDTH.min}
        aria-valuemax={RAIL_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={keyboard}
        onDoubleClick={() => {
          localStorage.setItem(RAIL_WIDTH.key, String(RAIL_WIDTH.fallback))
          setWidth(RAIL_WIDTH.fallback)
        }}
        className="pane-sash absolute inset-y-0 -left-[3px] z-10 w-[5px] cursor-col-resize outline-none touch-none"
      />
      <WorkspaceTools tool={tool} />
    </div>
  )
}
