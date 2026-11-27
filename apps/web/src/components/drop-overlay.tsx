/**
 * What a drag over a drop area shows: a dashed outline over the area, dimmed behind a label saying what dropping does.
 * One look for every place that takes a drop (files into a chat, a folder into the project list). The area is
 * positioned (`relative`) and the overlay never takes the pointer, so the drop lands on the area itself.
 */
export function DropOverlay({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-1.5 z-20 grid place-items-center rounded-(--radius-m) [border:1px_dashed_var(--line-strong)] [background:color-mix(in_srgb,_var(--canvas)_78%,_transparent)] p-3 text-center text-control text-foreground"
    >
      {label}
    </div>
  )
}
