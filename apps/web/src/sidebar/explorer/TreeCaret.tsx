import { ChevronRight } from 'lucide-react'
import { TREE_CARET_CLASS } from './constants'

export function TreeCaret({ open }: { open: boolean }) {
  return <ChevronRight size={12} className={open ? `${TREE_CARET_CLASS} open` : TREE_CARET_CLASS} />
}
