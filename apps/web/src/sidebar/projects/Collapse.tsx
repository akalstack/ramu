import { useSlideMount } from './useSlideMount'

/** Mounts its children while open and while the slide-closed animation runs. */
export function Collapse({
  open,
  id,
  className,
  children,
}: {
  open: boolean
  id?: string
  className?: string
  children: React.ReactNode
}) {
  const { ref, visible } = useSlideMount(open)
  return visible ? (
    <div ref={ref} id={id} className={className}>
      {children}
    </div>
  ) : null
}
