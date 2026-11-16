import { useState } from 'react'
import { Eye, RefreshCw, Settings2, TriangleAlert } from 'lucide-react'
import {
  accessGroups,
  groupReadFailure,
  readFailureKey,
  type AccessGroup,
  type AccessRepo,
  type ReadFailure,
} from '@ramu/shared/pullRequestAccess'
import { forgeBrand } from '@ramu/shared/brands'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { DeviceIcon } from '@/components/device-icon'
import { cn } from 'cn'
import { t } from '../i18n'
import { HostProvider } from '../workspace/HostProvider'
import { projectCtx } from '../workspace/workspace'
import { statusText, type ScopedHost } from '../workspace/computers'
import { ForgeAccessPanel, forgeUnavailableText, openHostingSettings } from '../sidebar/scm/ForgeAccessPanel'
import { PullRequestNotice, RawError } from './PullRequestNotice'

type Repo = AccessRepo

/** A host whose pull requests are missing: offline, or connected but its list could not be read. */
export interface HostTrouble {
  host: ScopedHost
  /** Why the connected host's list failed; null while it is offline. */
  error: string | null
  onRetry: () => void
}

const HIDDEN_KEY = 'ramu.pull-requests-hidden-access'
/** More notices than this fold behind one line, so the pull requests stay near the top. */
const MAX_SHOWN = 3

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

const hostKey = (host: string) => `host\n${host}`

function groupTitle(group: AccessGroup): string {
  if (group.problem === 'error')
    return group.repos.length === 1
      ? t('{0} could not be read', { '0': repoLabel(group.repos[0]!) })
      : t('{0} repositories could not be read', { '0': group.repos.length })
  if (group.problem === 'no-cli') return t('GitHub CLI is not installed')
  if (group.problem === 'choose-account') return t('Choose a GitHub account')
  return t('{0} is not connected', { '0': FORGE_NAMES[group.service] })
}

/** The one button that fixes a sign-in problem, named for what it does there. */
function connectLabel(group: AccessGroup): string {
  if (group.problem === 'choose-account') return t('Choose account')
  if (group.problem === 'no-cli') return t('Set up')
  return t('Connect')
}

/** A sign-in or access failure is fixed in Hosting accounts; the rest are worth another try. */
const fixedInSettings = (failure: ReadFailure) => failure === 'signed-out' || failure === 'no-access'

/**
 * Why some pull requests are missing, above the list and out of its way: one card per host that is offline or failed,
 * and one per host and hosting service that needs a sign-in or could not be read, instead of a panel per repository.
 * Each says what happened in plain words with the action that fixes it, opens to the per-repository details, and can be
 * hidden on this device; hidden ones, and any past the first few, fold into one line that shows them again.
 */
export function RepositoryAccessNotices({
  repos,
  hosts,
  hostName,
  manyHosts,
  onRetry,
  retrying,
}: {
  repos: Repo[]
  hosts: HostTrouble[]
  hostName: (host: string) => string
  manyHosts: boolean
  /** Reads every host's pull requests again from the services. */
  onRetry: () => void
  retrying: boolean
}) {
  const [hidden, setHidden] = useState<string[]>(savedHidden)
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const groups = accessGroups(repos)
  const save = (next: string[]) => {
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
      // Hidden until the page closes.
    }
  }
  const named = (host: string) => hostName(host) || t('This host')
  const toggle = (key: string) => setOpen(open === key ? null : key)
  const hide = (key: string) => save([...hidden, key])

  const hostCard = ({ host, error, onRetry: retryHost }: HostTrouble) => {
    const key = hostKey(host.id)
    if (error === null)
      return {
        key,
        node: (
          <PullRequestNotice
            key={key}
            icon={<DeviceIcon name={host.name} size={14} />}
            title={named(host.id)}
            detail={`${statusText(host.status)} · ${t('Its pull requests show when it is back.')}`}
            onDismiss={() => hide(key)}
          />
        ),
      }
    return {
      key,
      node: (
        <PullRequestNotice
          key={key}
          tone="warn"
          icon={<TriangleAlert size={14} />}
          title={t('Pull requests on {0} could not be listed', { '0': named(host.id) })}
          detail={t('The host answered with an error. Try again in a moment.')}
          expanded={open === key}
          onToggle={() => toggle(key)}
          onDismiss={() => hide(key)}
          actions={
            <Button variant="secondary" size="xs" onClick={retryHost}>
              <RefreshCw size={12} />
              {t('Retry')}
            </Button>
          }
        >
          <RawError>{error}</RawError>
        </PullRequestNotice>
      ),
    }
  }

  const groupCard = (group: AccessGroup) => {
    const expanded = open === group.key
    const service = FORGE_NAMES[group.service]
    const where = manyHosts ? t('On {0}', { '0': named(group.host) }) : ''
    const names = group.repos.map(repoLabel).join(', ')
    const settings = () => openHostingSettings(group.host)

    if (group.problem === 'error') {
      const errors = group.repos.map((repo) => repo.error ?? '')
      const failure = groupReadFailure(errors)
      // One shared message is shown once under the list of repositories rather than repeated for each.
      const same = errors.every((error) => error === errors[0])
      return {
        key: group.key,
        node: (
          <PullRequestNotice
            key={group.key}
            tone="warn"
            icon={<TriangleAlert size={14} />}
            title={groupTitle(group)}
            detail={t(readFailureKey(failure), { '0': service })}
            expanded={expanded}
            onToggle={() => toggle(group.key)}
            onDismiss={() => hide(group.key)}
            actions={
              fixedInSettings(failure) ? (
                <Button variant="secondary" size="xs" onClick={settings}>
                  <Settings2 size={12} />
                  {t('Hosting accounts')}
                </Button>
              ) : (
                <Button variant="secondary" size="xs" disabled={retrying} onClick={onRetry}>
                  <RefreshCw size={12} className={cn(retrying && 'animate-spin motion-reduce:animate-none')} />
                  {t('Retry')}
                </Button>
              )
            }
          >
            {where && <p className="m-0 text-caption text-muted-foreground">{where}</p>}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {group.repos.map((repo) => (
                <li key={`${repo.host}\n${repo.repoId}`} className="flex min-w-0 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-caption text-foreground">
                    <BrandIcon brand={forgeBrand(group.service)} size={12} className="flex-none" />
                    <span className="truncate">{repoLabel(repo)}</span>
                  </span>
                  {!same && repo.error && <RawError>{repo.error}</RawError>}
                </li>
              ))}
            </ul>
            {same && errors[0] && <RawError>{errors[0]}</RawError>}
          </PullRequestNotice>
        ),
      }
    }

    return {
      key: group.key,
      node: (
        <PullRequestNotice
          key={group.key}
          icon={<BrandIcon brand={forgeBrand(group.service)} size={14} />}
          title={groupTitle(group)}
          detail={[where, names].filter(Boolean).join(' · ')}
          expanded={expanded}
          onToggle={() => toggle(group.key)}
          onDismiss={() => hide(group.key)}
          actions={
            <Button variant="secondary" size="xs" onClick={settings}>
              {connectLabel(group)}
            </Button>
          }
        >
          <p className="m-0 text-caption text-muted-foreground">{forgeUnavailableText(group.problem, group.service)}</p>
          {group.repos.map((repo) => (
            <div key={`${repo.host}\n${repo.repoId}`} className="flex flex-col gap-1">
              <span className="text-caption text-foreground">{repoLabel(repo)}</span>
              {/* The check runs on the host whose checkout it is. */}
              <HostProvider hostId={repo.host}>
                <ForgeAccessPanel taskId={projectCtx(repo.projectId)} repoId={repo.repoId} service={repo.service} />
              </HostProvider>
            </div>
          ))}
        </PullRequestNotice>
      ),
    }
  }

  // Whole hosts first, then reads that failed, then sign-ins: the order in which they hide the most.
  const cards = [
    ...hosts.map(hostCard),
    ...groups.filter((group) => group.problem === 'error').map(groupCard),
    ...groups.filter((group) => group.problem !== 'error').map(groupCard),
  ]
  if (!cards.length) return null
  const visible = cards.filter((card) => !hidden.includes(card.key))
  const folded = cards.length - visible.length
  const shown = showAll ? visible : visible.slice(0, MAX_SHOWN)
  const more = visible.length - shown.length

  return (
    <div className="mx-1 mb-1.5 flex flex-col gap-1">
      {shown.map((card) => card.node)}
      {(more > 0 || folded > 0) && (
        <div className="flex min-h-7 items-center gap-1 px-1.5 text-caption text-muted-foreground">
          {more > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setShowAll(true)}>
              {t('{0} more notices', { '0': more })}
            </Button>
          )}
          {folded > 0 && (
            <>
              <span className="min-w-0 flex-1 truncate text-right">{t('{0} hidden', { '0': folded })}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => save(hidden.filter((key) => !cards.some((card) => card.key === key)))}
              >
                <Eye size={12} />
                {t('Show')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
