import type { IdentityColor, ProjectIdentity } from '@ramu/shared/identities'
import { cn } from 'cn'
import { t } from '../i18n'

const DOT: Record<IdentityColor, string> = {
  violet: 'bg-violet-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
  gray: 'bg-gray-500',
}

const TEXT: Record<IdentityColor, string> = {
  violet: 'text-violet-500',
  blue: 'text-blue-500',
  green: 'text-green-500',
  amber: 'text-amber-500',
  red: 'text-red-500',
  pink: 'text-pink-500',
  teal: 'text-teal-500',
  gray: 'text-gray-500',
}

/** The text color of an identity, for tinting an icon such as a project's folder. */
export const identityTextColor = (color: IdentityColor) => TEXT[color]

/** Why a project acts as its identity, for a tooltip. */
export function identityReason(identity: ProjectIdentity): string {
  return identity.reason === 'pinned'
    ? t('Pinned to {name}', { name: identity.name })
    : identity.reason === 'rule'
      ? t('{name}, picked by a rule', { name: identity.name })
      : t('{name}, the default identity', { name: identity.name })
}

/** An identity's color, as a small dot beside its name. */
export function IdentityDot({ color, className }: { color: IdentityColor; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 flex-none rounded-full', DOT[color], className)} />
}

/** A project's identity on its row and in a thread's header: its color and name, with why it was picked. */
export function IdentityChip({ identity, className }: { identity: ProjectIdentity; className?: string }) {
  const why = identityReason(identity)
  return (
    <span
      className={cn('inline-flex flex-none items-center gap-1 text-caption text-muted-foreground', className)}
      title={`${why} · ${identity.email}`}
    >
      <IdentityDot color={identity.color} />
      {identity.name}
    </span>
  )
}
