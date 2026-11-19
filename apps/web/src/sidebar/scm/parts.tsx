import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { CARET, GROUP_TOGGLE, ICON_BUTTON, SCM_COUNT, SUB_TITLE } from './classes'

export function Caret({ open }: { open: boolean }) {
  return <ChevronRight size={13} className={open ? `${CARET} open` : CARET} />
}

export function ScmCount({ children }: { children: ReactNode }) {
  return <span className={SCM_COUNT}>{children}</span>
}

/** Foldable "Staged" / "Changes" heading with its count and a bulk action. */
export function ChangeGroupHeader({
  label,
  open,
  count,
  actionLabel,
  actionIcon,
  busy,
  onToggle,
  onAction,
  showAction = true,
}: {
  label: string
  open: boolean
  count: number
  actionLabel: string
  actionIcon: ReactNode
  busy: boolean
  onToggle: () => void
  showAction?: boolean
  onAction: () => void
}) {
  return (
    <div className={SUB_TITLE}>
      <Button variant="tree" className={GROUP_TOGGLE} aria-expanded={open} onClick={onToggle}>
        <Caret open={open} />
        {label}
        {!!count && <ScmCount>{count}</ScmCount>}
      </Button>
      {!!count && showAction && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON}
          aria-label={actionLabel}
          title={actionLabel}
          disabled={busy}
          onClick={onAction}
        >
          {actionIcon}
        </Button>
      )}
    </div>
  )
}
