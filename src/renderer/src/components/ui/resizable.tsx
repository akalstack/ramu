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
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
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
        "relative z-10 flex w-px shrink-0 items-center justify-center bg-[var(--pane-border-color)] outline-none [transition:box-shadow_0.15s,background-color_0.15s]",
        // A 12px strip around the line is the real grab area; the line itself stays 1px.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:inset-y-auto aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-3 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        // Hover, keyboard focus and dragging thicken the line to 3px without moving the panels beside it.
        "data-[separator=hover]:bg-[var(--pane-border-active)] data-[separator=hover]:shadow-[0_0_0_1px_var(--pane-border-active)] data-[separator=active]:bg-[var(--pane-border-active)] data-[separator=active]:shadow-[0_0_0_1px_var(--pane-border-active)] focus-visible:bg-[var(--pane-border-active)] focus-visible:shadow-[0_0_0_1px_var(--pane-border-active)]",
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
