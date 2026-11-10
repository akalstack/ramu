import type { ReactNode } from 'react'
import { BRAND_IDS, type BrandId } from '@ramu/shared/brands'
import { cn } from 'cn'
import { BrandIcon } from '@/components/brand-icon'
import { RowButton } from '@/components/row-button'
import { SearchInput } from '../SearchInput'
import { useLanguage } from '../i18n'

/** A plugin's or server's brand, when its name is one Ramu has a mark for. */
export function brandOf(name: string): BrandId | null {
  const key = name.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const aliases: Record<string, BrandId> = { flyio: 'fly', godotengine: 'godot', githubcopilot: 'github' }
  if (aliases[key]) return aliases[key]
  return (BRAND_IDS as readonly string[]).includes(key) ? (key as BrandId) : null
}

/**
 * The square tile beside every plugin, skill and server: the brand's mark when Ramu has one, else its first letter, so
 * a list scans by shape and never shows a gap.
 */
export function ExtensionIcon({ name, icon, size = 36 }: { name: string; icon?: ReactNode; size?: number }) {
  const brand = icon ? null : brandOf(name)
  return (
    <span
      className="flex flex-none items-center justify-center rounded-(--radius-s) bg-fill text-soft [box-shadow:inset_0_0_0_1px_var(--line)]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {icon ??
        (brand ? (
          <BrandIcon brand={brand} size={Math.round(size * 0.5)} />
        ) : (
          <span className="font-medium uppercase" style={{ fontSize: Math.round(size * 0.4) }}>
            {name.replace(/[^a-z0-9]/gi, '').slice(0, 1) || '?'}
          </span>
        ))}
    </span>
  )
}

/** A name as people read it: a plugin's lowercase id gets a capital first letter. */
export const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** Two columns of items once the page is wide enough, one on a narrow window. */
export function ExtensionGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-1 p-0 @[720px]:grid-cols-2">
      {children}
    </ul>
  )
}

/**
 * One plugin, skill or server: its tile, name and one line about it, opening its details; the trailing action (Install,
 * Turn on, a state) sits apart from the row so it can be pressed without opening it.
 */
export function ExtensionItem({
  name,
  title,
  subtitle,
  icon,
  badge,
  action,
  muted,
  onOpen,
}: {
  name: string
  title?: string
  subtitle: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  action?: ReactNode
  muted?: boolean
  onOpen?: () => void
}) {
  const body = (
    <>
      <ExtensionIcon name={name} icon={icon} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate text-control font-medium', muted ? 'text-soft' : 'text-foreground')}>
            {title ?? displayName(name)}
          </span>
          {badge}
        </span>
        <span className="truncate text-caption text-muted-foreground">{subtitle}</span>
      </span>
    </>
  )
  return (
    <li className="group/item relative flex min-w-0 items-center gap-2 rounded-(--radius-m) hover:bg-hover">
      {onOpen ? (
        <RowButton className="min-w-0 flex-1 gap-3 rounded-(--radius-m) p-2 hover:bg-transparent" onClick={onOpen}>
          {body}
        </RowButton>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 p-2">{body}</div>
      )}
      {action && <div className="flex flex-none items-center pr-2">{action}</div>}
    </li>
  )
}

export function SectionTitle({ title, count, help }: { title: string; count?: number; help?: string }) {
  return (
    <div className="mt-6 mb-1 flex flex-col gap-0.5 first:mt-0">
      <h3 className="m-0 flex items-center gap-2 text-control font-medium text-foreground">
        {title}
        {count !== undefined && <span className="text-caption font-normal text-muted-foreground">{count}</span>}
      </h3>
      {help && <p className="m-0 text-caption text-muted-foreground">{help}</p>}
    </div>
  )
}

/** The page's title, what it is for, its search and its Add actions. */
export function CustomizeHeader({
  title,
  description,
  query,
  onQuery,
  placeholder,
  actions,
}: {
  title: string
  description: string
  query: string
  onQuery: (value: string) => void
  placeholder: string
  actions?: ReactNode
}) {
  useLanguage()
  return (
    <header className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-[22px] leading-tight font-semibold text-foreground">{title}</h2>
          <p className="m-0 text-control text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-none items-center gap-1.5">{actions}</div>
      </div>
      <SearchInput
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        maxLength={200}
        onChange={(event) => onQuery(event.target.value)}
        onClear={() => onQuery('')}
      />
    </header>
  )
}

/**
 * The full manager for a part of Customize, folded away: identity accounts, sign-in by address, copies' source
 * changes and the rest that most people never need.
 */
export function Advanced({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group mt-8 border-t border-line pt-4">
      <summary className="cursor-pointer text-control text-muted-foreground hover:text-foreground">{title}</summary>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </details>
  )
}

/** A quiet line for an empty or loading list. */
export function Quiet({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <p
      role={alert ? 'alert' : 'status'}
      className={cn('m-0 px-2 py-3 text-caption', alert ? 'text-bad' : 'text-muted-foreground')}
    >
      {children}
    </p>
  )
}
