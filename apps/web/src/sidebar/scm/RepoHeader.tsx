import type { ReactNode } from 'react'
import { Archive, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t } from '../../i18n'
import { ICON_BUTTON } from './classes'
import { ScmCount } from './parts'

/** Repository name (foldable when several are listed) with stash, refresh and the actions menu (`children`). */
export function RepoHeader({
  repoName,
  collapsed,
  entryCount,
  busy,
  canStash,
  onToggle,
  onStash,
  onRefresh,
  children,
}: {
  repoName: string
  collapsed: boolean
  entryCount: number
  busy: boolean
  canStash: boolean
  onToggle?: () => void
  onStash: () => void
  onRefresh: () => void
  children: ReactNode
}) {
  return (
    <div className="scm-section-head [&_>_svg]:flex-none [&_.strong]:overflow-hidden [&_.strong]:text-ellipsis [&_.strong]:whitespace-nowrap flex items-center gap-1.5 min-h-8 p-[0_4px] m-0 text-control">
      {onToggle ? (
        <Button
          variant="tree"
          type="button"
          className="scm-repo-toggle [&_.strong]:overflow-hidden [&_.strong]:text-ellipsis [&_.strong]:whitespace-nowrap [&_.scm-count]:ml-1.5 flex items-center justify-start gap-1 min-w-0 p-0 [border:0] bg-transparent text-inherit [font:inherit] text-left cursor-pointer grow flex-1 min-w-0 text-left"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="strong font-semibold">{repoName}</span>
          {collapsed && !!entryCount && <ScmCount>{entryCount}</ScmCount>}
        </Button>
      ) : (
        <>
          <ChevronDown size={14} />
          <span className="grow flex-1 min-w-0 text-left strong font-semibold">{repoName}</span>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON}
        title={t('Stash all changes…')}
        aria-label={t('Stash all changes')}
        disabled={busy || !canStash}
        onClick={onStash}
      >
        <Archive size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON}
        title={t('Refresh source control')}
        aria-label={t('Refresh source control')}
        onClick={onRefresh}
      >
        <RefreshCw size={13} />
      </Button>
      {children}
    </div>
  )
}
