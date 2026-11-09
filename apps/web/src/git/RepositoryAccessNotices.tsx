import { useState } from 'react'
import { ChevronDown, Eye, X } from 'lucide-react'
import { accessGroups, type AccessGroup, type AccessRepo } from '@ramu/shared/pullRequestAccess'
import { forgeBrand } from '@ramu/shared/brands'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { cn } from 'cn'
import { t } from '../i18n'
import { HostProvider } from '../workspace/HostProvider'
import { projectCtx } from '../workspace/workspace'
import { ForgeAccessPanel, forgeUnavailableText, openHostingSettings } from '../sidebar/scm/ForgeAccessPanel'

type Repo = AccessRepo

const HIDDEN_KEY = 'ramu.pull-requests-hidden-access'

/** The notices hidden on this device; storage may be unavailable, which hides none. */
function savedHidden(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const repoLabel = (repo: Pick<Repo, 'projectName' | 'repoName'>) =>
  repo.projectName === repo.repoName ? repo.repoName : `${repo.projectName} / ${repo.repoName}`

function groupTitle(group: AccessGroup): string {
  if (group.problem === 'error')
    return group.repos.length === 1
      ? t('{0} could not be read', { '0': repoLabel(group.repos[0]!) })
      : t('{0} repositories could not be read', { '0': group.repos.length })
  if (group.problem === 'no-cli') return t('GitHub CLI is not installed')
  if (group.problem === 'choose-account') return t('Choose a GitHub account')
  return t('{0} is not connected', { '0': FORGE_NAMES[group.service] })
}

/**
 * Repositories whose pull requests could not be listed, as one line per host and hosting service instead of a panel
 * per repository, so the pull requests stay in view. Each opens to the fix and per-repository access checks, and can
 * be hidden on this device; hidden ones fold into a single line that shows them again.
 */
export function RepositoryAccessNotices({
  repos,
  hostName,
  manyHosts,
  activeHost,
}: {
  repos: Repo[]
  hostName: (host: string) => string
  manyHosts: boolean
  activeHost: string
}) {
  const [hidden, setHidden] = useState<string[]>(savedHidden)
  const [open, setOpen] = useState<string | null>(null)
  const groups = accessGroups(repos)
  if (!groups.length) return null
  const save = (next: string[]) => {
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
      // Hidden until the page closes.
    }
  }
  const shown = groups.filter((group) => !hidden.includes(group.key))
  const folded = groups.filter((group) => hidden.includes(group.key))
  const foldedRepos = folded.reduce((sum, group) => sum + group.repos.length, 0)
  return (
    <div className="mx-1 mb-1 flex flex-col gap-1">
      {shown.map((group) => {
        const expanded = open === group.key
        // Settings change the host on screen, so the shortcut is offered only for its own repositories.
        const canConnect = group.problem !== 'error' && group.service !== 'gitlab' && group.host === activeHost
        const names = group.repos.map(repoLabel).join(', ')
        return (
          <section
            key={group.key}
            aria-label={groupTitle(group)}
            className="rounded-(--radius-m) border border-(--line) bg-card"
          >
            <div className="flex min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-2.5">
              <BrandIcon brand={forgeBrand(group.service)} size={14} className="flex-none" />
              <RowButton
                stacked
                className="min-h-0 flex-1 p-0 hover:bg-transparent"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : group.key)}
              >
                <span
                  className={cn(
                    'block w-full truncate text-caption',
                    group.problem === 'error' ? 'text-bad' : 'text-foreground',
                  )}
                >
                  {groupTitle(group)}
                </span>
                <span className="block w-full truncate text-caption text-muted-foreground">
                  {[manyHosts ? t('On {0}', { '0': hostName(group.host) }) : '', names].filter(Boolean).join(' · ')}
                </span>
              </RowButton>
              {canConnect && (
                <Button variant="secondary" size="xs" onClick={openHostingSettings}>
                  {t('Connect')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={expanded ? t('Hide details') : t('Show details')}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : group.key)}
              >
                <ChevronDown size={13} className={cn('transition-transform', expanded && 'rotate-180')} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Hide this notice')}
                title={t('Hide this notice')}
                onClick={() => save([...hidden, group.key])}
              >
                <X size={13} />
              </Button>
            </div>
            {expanded && (
              <div className="flex flex-col gap-2.5 border-t border-(--line) px-2.5 py-2">
                {group.problem !== 'error' && (
                  <p className="m-0 text-caption text-muted-foreground">
                    {forgeUnavailableText(group.problem, group.service)}
                  </p>
                )}
                {group.repos.map((repo) => (
                  <div key={repo.repoId} className="flex flex-col gap-1">
                    <span className="text-caption text-foreground">{repoLabel(repo)}</span>
                    {repo.error ? (
                      <p className="m-0 text-caption text-bad">{repo.error}</p>
                    ) : (
                      // The check runs on the host whose checkout it is.
                      <HostProvider hostId={repo.host}>
                        <ForgeAccessPanel
                          taskId={projectCtx(repo.projectId)}
                          repoId={repo.repoId}
                          service={repo.service}
                        />
                      </HostProvider>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
      {folded.length > 0 && (
        <p className="m-0 flex items-center gap-1 px-1.5 text-caption text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {t('{0} repositories that need access are hidden', { '0': foldedRepos })}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => save(hidden.filter((key) => !folded.some((group) => group.key === key)))}
          >
            <Eye size={12} />
            {t('Show')}
          </Button>
        </p>
      )}
    </div>
  )
}
