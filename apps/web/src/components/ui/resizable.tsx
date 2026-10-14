import { cn } from "cn"
import * as ResizablePrimitive from "react-resizable-panels"

/** Every divider in the app is a panel handle: same 1px line, wide invisible hit area, same drag feedback. */
const HIT_TARGET = { coarse: 24, fine: 12 }

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      resizeTargetMinimumSize={HIT_TARGET}
      className={cn(
        // The library transforms this wrapper, creating a stacking context.
        // Raise the wrapper itself so its cloned sash stays above pane content and dock zones.
        "flex h-full w-full aria-[orientation=vertical]:flex-col [&>[data-resize-preview]]:z-100",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "pane-sash relative z-90 flex w-px shrink-0 items-center justify-center bg-[var(--pane-border-color)] outline-none",
        // A 12px strip around the line is the real grab area; the line itself stays 1px.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:inset-y-auto aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "data-[disabled]:pointer-events-none",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
