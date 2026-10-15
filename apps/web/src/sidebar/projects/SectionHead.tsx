import { ChevronDown } from 'lucide-react'

/** A sidebar section title that folds its list; the chevron shows on hover only, with no hover background. */
export function SectionHead({
  title,
  open,
  onToggle,
  controls,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  controls: string
  children?: React.ReactNode
}) {
  return (
    <div className="section-head group/head flex items-center justify-between text-body text-muted-foreground p-[3px_8px]">
      <button
        type="button"
        className="inline-flex items-center gap-1 bg-transparent p-0 [border:0] text-inherit cursor-default hover:text-foreground focus-visible:text-foreground"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
      >
        <span>{title}</span>
        <ChevronDown
          size={13}
          className={`flex-none opacity-0 [transition:opacity_0.12s,transform_0.15s_var(--ease)] group-hover/head:opacity-100 group-focus-within/head:opacity-100 ${open ? '' : '[transform:rotate(-90deg)]'}`}
        />
      </button>
      {children}
    </div>
  )
}
