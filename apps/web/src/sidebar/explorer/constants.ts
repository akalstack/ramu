/** Shared look of the small ghost icon buttons in the panel header. */
export const ICON_BUTTON_CLASS =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)'

export const TREE_CHILDREN_CLASS =
  "tree-children [&::before]:[content:''] [&::before]:absolute [&::before]:top-0 [&::before]:bottom-0 [&::before]:left-[var(--tree-guide-left)] [&::before]:w-px [&::before]:[background:var(--line)] [&::before]:pointer-events-none [&::before]:z-1 relative"

export const TREE_CARET_CLASS =
  'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)]'
export const REPO_TREE_CLASS = 'repo-tree [&:hover_.tree-children::before]:[background:var(--line-strong)] mb-1.5'

export const TREE_ROOT_CLASS =
  'tree-root [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&:focus-visible]:[outline-color:var(--line-strong)] [&_>_span]:relative [&_>_span]:top-[-1px] [&.drop-target]:bg-brand-wash [&.drop-target]:[box-shadow:none] flex items-center w-full bg-transparent [border:none] rounded-(--radius-s) p-[3px_4px] gap-1.5 text-left whitespace-nowrap text-soft mb-0.5 justify-start'
