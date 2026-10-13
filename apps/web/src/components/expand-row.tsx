import { Button } from '@/components/desktop-button'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'

/** Shared compact disclosure row for lists with a limited initial preview. */
export function ExpandRow({ expanded, onToggle, children, className }: {
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  className?: string
}) {
  return <Button variant="ghost" className={cn('compact-expand-row h-7 min-h-7 w-full justify-start gap-1.5 rounded-none border-0 bg-transparent px-3.5 py-0 text-[length:var(--font-caption)] leading-[18px] font-normal text-muted-foreground hover:bg-hover hover:text-foreground', className)} aria-expanded={expanded} onClick={onToggle}>
    {children}<ChevronDown className={cn('size-3.5 flex-none transition-transform', expanded && 'rotate-180')} />
  </Button>
}
