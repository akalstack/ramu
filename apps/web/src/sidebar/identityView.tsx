// The sidebar's identity view, on each device: every project (the default), projects under a heading per identity,
// or only one identity's until cleared, with the active filter shown above the list so no project seems lost. Search,
// the Inbox and notifications keep showing every identity.
import { Fragment, useState, type ReactNode } from 'react'
import type { Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Menu } from '../Menu'
import { Rows3, X } from 'lucide-react'
import { cn } from 'cn'
import { t } from '../i18n'
import { IdentityDot } from '../settings/IdentityChip'
import { useIdentities } from '../workspace/identities'

type View = 'all' | 'group' | `only:${string}`
const key = (hostId: string) => `ramu:identity-view:${hostId}`

function read(hostId: string): View {
  try {
    const value = localStorage.getItem(key(hostId))
    return value === 'group' || value?.startsWith('only:') ? (value as View) : 'all'
  } catch {
    return 'all'
  }
}

/** The view and its picker for one host's projects; the picker is absent with fewer than two identities. */
export function useIdentityView(hostId: string) {
  const snapshot = useIdentities(hostId)
  const [view, setView] = useState<View>(() => read(hostId))
  const identities = snapshot && snapshot.settings.identities.length >= 2 ? snapshot.settings.identities : null
  const choose = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(key(hostId), next)
    } catch {
      // Private storage: the choice lasts until the window closes.
    }
  }
  const active: View = identities
    ? view.startsWith('only:') && !identities.some((entry) => `only:${entry.id}` === view)
      ? 'all'
      : view
    : 'all'
  const only = identities?.find((identity) => `only:${identity.id}` === active)
  const viewName = only
    ? t('Only {name}', { name: only.name })
    : active === 'group'
      ? t('Grouped by identity')
      : t('All identities')
  // A compact trigger that shows the state itself: the identities' colors when all show, and the one identity's name
  // when narrowed, so a filtered list never looks like missing projects.
  const picker = identities ? (
    <Menu
      label={`${t('Show projects')} · ${viewName}`}
      align="end"
      className={cn(
        'h-6 min-h-6 flex-none gap-1 rounded-(--radius-s) border-0 px-1 text-caption shadow-none hover:bg-hover! hover:text-foreground aria-expanded:bg-hover!',
        only ? 'bg-fill! px-1.5 text-foreground' : 'bg-transparent! text-muted-foreground',
      )}
      icon={
        only ? (
          <>
            <IdentityDot color={only.color} />
            <span className="max-w-[7rem] truncate">{only.name}</span>
            <X
              size={11}
              aria-hidden
              className="opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                choose('all')
              }}
            />
          </>
        ) : (
          <>
            <span className="flex -space-x-1" aria-hidden>
              {identities.slice(0, 4).map((identity) => (
                <IdentityDot
                  key={identity.id}
                  color={identity.color}
                  className="size-2.5 ring-[1.5px] ring-(--sidebar)"
                />
              ))}
            </span>
            {active === 'group' && <Rows3 size={12} aria-hidden />}
          </>
        )
      }
      items={[
        { key: 'show', heading: t('Show') },
        { key: 'all', label: t('All identities'), selected: active === 'all', onSelect: () => choose('all') },
        ...identities.map((identity) => ({
          key: `only:${identity.id}`,
          label: (
            <span className="inline-flex items-center gap-2">
              <IdentityDot color={identity.color} />
              {t('Only {name}', { name: identity.name })}
            </span>
          ),
          selected: active === `only:${identity.id}`,
          onSelect: () => choose(`only:${identity.id}`),
        })),
        { key: 'sep', separator: true as const },
        {
          key: 'group',
          label: t('Group by identity'),
          selected: active === 'group',
          onSelect: () => choose(active === 'group' ? 'all' : 'group'),
        },
      ]}
    />
  ) : null

  /** The projects in view order, with headings when grouped and the filter line when narrowed. */
  const arrange = (projects: Project[], render: (project: Project) => ReactNode): ReactNode => {
    if (!identities || !snapshot || active === 'all') return projects.map(render)
    const of = (project: Project) => snapshot.projects.find((entry) => entry.projectId === project.id)?.identityId
    if (active === 'group')
      return identities.map((identity) => {
        const caught = projects.filter((project) => of(project) === identity.id)
        return caught.length ? (
          <Fragment key={identity.id}>
            <p className="m-0 flex items-center gap-1.5 px-2 pt-3 pb-1 text-caption font-medium text-muted-foreground first:pt-1">
              <IdentityDot color={identity.color} />
              {identity.name}
              <span className="font-normal tabular-nums opacity-70">{caught.length}</span>
            </p>
            {caught.map(render)}
          </Fragment>
        ) : null
      })
    if (!only) return projects.map(render)
    const shown = projects.filter((project) => of(project) === only.id)
    return (
      <>
        <p className="m-0 flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-caption text-muted-foreground" role="status">
          <IdentityDot color={only.color} />
          {t('Showing only {name}: {hidden} more hidden', { name: only.name, hidden: projects.length - shown.length })}
          <Button size="xs" variant="ghost" onClick={() => choose('all')}>
            {t('Show all')}
          </Button>
        </p>
        {shown.map(render)}
      </>
    )
  }
  return { picker, arrange }
}
