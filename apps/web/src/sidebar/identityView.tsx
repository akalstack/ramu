// The sidebar's identity view, on each device: every project (the default), projects under a heading per identity,
// or only one identity's until cleared, with the active filter shown above the list so no project seems lost. Search,
// the Inbox and notifications keep showing every identity.
import { Fragment, useState, type ReactNode } from 'react'
import type { Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Dropdown } from '../Menu'
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
  const picker = identities ? (
    <Dropdown
      label={t('Show projects')}
      value={active}
      options={[
        { value: 'all', label: t('All projects') },
        { value: 'group', label: t('Group by identity') },
        ...identities.map((identity) => ({
          value: `only:${identity.id}`,
          label: t('Show only {name}', { name: identity.name }),
        })),
      ]}
      onChange={(value) => choose(value as View)}
      className="max-w-[9rem]"
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
            <p className="m-0 flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-caption text-muted-foreground">
              <IdentityDot color={identity.color} />
              {identity.name}
            </p>
            {caught.map(render)}
          </Fragment>
        ) : null
      })
    const only = identities.find((identity) => `only:${identity.id}` === active)!
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
