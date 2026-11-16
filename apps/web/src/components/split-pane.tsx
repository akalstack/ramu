import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from 'cn'
import { usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { deviceStorage } from '../deviceStorage'
import { readSplitWidth, saveSplitWidth, useLayoutEpoch, type SplitBounds } from '../workspace/panelLayout'

interface SplitPaneProps {
  /** Names the remembered width; one per page. */
  id: string
  /** Accessible name of the divider, which is focusable and resizes with the arrow keys, Home and End. */
  label: string
  bounds: SplitBounds
  /** Narrowest the main pane may get, in pixels. */
  mainMin: number
  /**
   * Below this container width the panes are not split: both render as plain siblings of the `@container` root, and
   * the caller's container queries decide which one shows.
   */
  splitFrom: number
  side: ReactNode
  main: ReactNode
  className?: string
}

/**
 * A side pane beside the main content with a draggable divider. The side keeps its pixel width when the window
 * resizes, each page remembers its width on this device, and double-clicking the divider puts it back.
 */
export function SplitPane({ id, label, bounds, mainMin, splitFrom, side, main, className }: SplitPaneProps) {
  const root = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState<boolean | null>(null)
  const sidePanel = usePanelRef()
  const epoch = useLayoutEpoch()
  // Measured before paint, so the first frame is already the right arrangement.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setSplit(element.getBoundingClientRect().width >= splitFrom)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [splitFrom])
  return (
    <div ref={root} className={cn('@container flex min-h-0 min-w-0 flex-1', className)}>
      {split === null ? null : split ? (
        <ResizablePanelGroup
          // Resetting layout sizes in Settings clears the stored width; remounting picks the starting width again.
          key={epoch}
          orientation="horizontal"
          id={`split-${id}`}
          onLayoutChanged={(_layout, meta) => {
            const width = sidePanel.current?.getSize().inPixels
            if (meta.isUserInteraction && width) saveSplitWidth(deviceStorage, id, bounds, width)
          }}
        >
          <ResizablePanel
            id="side"
            panelRef={sidePanel}
            groupResizeBehavior="preserve-pixel-size"
            defaultSize={readSplitWidth(deviceStorage, id, bounds)}
            minSize={bounds.min}
            maxSize={bounds.max}
            className="flex min-h-0 min-w-0"
          >
            {side}
          </ResizablePanel>
          <ResizableHandle
            aria-label={label}
            // The library's own reset returns to the remembered width; this one returns to the page's starting width.
            disableDoubleClick
            onDoubleClick={() => {
              sidePanel.current?.resize(bounds.initial)
              saveSplitWidth(deviceStorage, id, bounds, bounds.initial)
            }}
          />
          <ResizablePanel id="main" minSize={mainMin} className="flex min-h-0 min-w-0">
            {main}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          {side}
          {main}
        </>
      )}
    </div>
  )
}
