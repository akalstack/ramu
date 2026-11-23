import { LINK_LIMITS, linkUsageLevel, recommendRoutes, type RouteKind, type RouteOption } from '@ramu/shared/ramuLink'
import type { NetworkStatus } from '@ramu/shared/types'
import { formatSize } from '@ramu/shared/formatSize'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { LocalInlineAction } from '@/components/inline-action'
import { CopyButton } from './CopyAddressButton'
import { ramu } from '../ipc'
import { t } from '../i18n'

/** A route the person can switch to from here: a tunnel choice, or a page to open. */
export type RouteChoice = 'tailscale' | 'quick' | 'ngrok' | 'own-relay'

const ROUTE_TITLE: Record<RouteKind, string> = {
  link: 'Ramu Link',
  tailscale: 'Tailscale Funnel',
  'own-relay': 'Your own Ramu Link relay',
  quick: 'Quick tunnel (Cloudflare)',
  ngrok: 'ngrok',
  'install-tailscale': 'Install Tailscale',
}
const ROUTE_WHY: Record<RouteOption['reason'], string> = {
  'free-stable': 'Free, with an address that stays the same.',
  private: 'Installed here. Private and stable.',
  'your-cloudflare': 'The same relay on your free Cloudflare account, with no slot to wait for.',
  temporary: 'Works now. The address changes each time Ramu starts.',
  installed: 'Installed here, with your ngrok account.',
  'free-to-install': 'Free. Install it on this computer and your devices.',
}
/** The relay's reasons in words; anything else (a network error) is shown as the host reported it. */
const LINK_REASON: Record<string, string> = {
  'relay-error': 'the relay could not set up the tunnel',
  'account-unreachable': 'the Ramu account did not answer',
}
export const OWN_RELAY_GUIDE = 'https://github.com/akalstack/ramu/tree/main/apps/link#run-your-own'
const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download'

const line = 'muted text-muted-foreground small text-caption m-[0_0_12px] flex flex-wrap items-center gap-x-1.5'

const openSignIn = () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'account' } }))
const open = (url: string) => void ramu.invoke('app.openExternal', url).catch(() => {})

/**
 * What else reaches this host from anywhere while Ramu Link cannot be had, best first for what this computer has:
 * Tailscale when installed, the person's own relay, the quick tunnel when cloudflared is here, ngrok when installed.
 */
function OtherRoutes({ status, onChoose }: { status: NetworkStatus; onChoose: (route: RouteChoice) => void }) {
  const tunnel = status.tunnel!
  const options = recommendRoutes({
    link: tunnel.link ?? null,
    pool: tunnel.pool ?? null,
    signedIn: tunnel.link?.state !== 'signed-out',
    tools: tunnel.tools,
  }).filter((option) => option.kind !== 'link')
  return (
    <div className="mb-3 flex flex-col gap-2" role="group" aria-label={t('Other ways to reach this host')}>
      <p className="muted text-muted-foreground small text-caption m-0">{t('Meanwhile, you can use:')}</p>
      {options.map((option) => (
        <div
          key={option.kind}
          className="flex items-center justify-between gap-3 rounded-(--radius-m) bg-fill px-3 py-2"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-body font-medium">
              {t(ROUTE_TITLE[option.kind])}
              {option.recommended ? (
                <Badge variant="secondary" className="font-normal">
                  {t('Recommended')}
                </Badge>
              ) : null}
            </div>
            <div className="muted text-muted-foreground small text-caption">{t(ROUTE_WHY[option.reason])}</div>
          </div>
          {option.kind === 'install-tailscale' ? (
            <Button
              size="sm"
              variant={option.recommended ? 'default' : 'secondary'}
              onClick={() => open(TAILSCALE_DOWNLOAD)}
            >
              {t('Download')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant={option.recommended ? 'default' : 'secondary'}
              onClick={() => onChoose(option.kind as RouteChoice)}
            >
              {option.kind === 'own-relay' ? t('Set up') : t('Use this')}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Ramu Link's state under the tunnel choice: the address and this month's use while it runs, and otherwise why not
 * (full, paused, on another host, signed out) with what to do about it. `staged` is a choice not saved yet: a full pool
 * says so before saving, which would join the waitlist.
 */
export function RamuLinkState({
  status,
  staged,
  onChoose,
  onRelease,
}: {
  status: NetworkStatus
  staged: boolean
  onChoose: (route: RouteChoice) => void
  onRelease: () => void
}) {
  const tunnel = status.tunnel
  if (!tunnel) return null
  const link = tunnel.link ?? null
  const pool = tunnel.pool ?? null
  const full = !!pool && pool.used >= pool.capacity
  if (staged) {
    if (!full)
      return pool ? (
        <p className={line}>{t('{0} free slots. Save to take one.', { 0: pool.capacity - pool.used })}</p>
      ) : null
    return (
      <>
        <p className={line} role="status">
          {t(
            'Ramu Link is full right now. Saving puts this computer on the waitlist; it switches on its own when a slot frees.',
          )}
        </p>
        <OtherRoutes status={status} onChoose={onChoose} />
      </>
    )
  }
  if (!link || (link.state === 'unavailable' && !link.reason && tunnel.state === 'starting'))
    return (
      <p className={line} role="status">
        {status.enabled ? t('Asking Ramu Link for an address…') : t('Starts once Allow other devices is on.')}
      </p>
    )
  if (link.state === 'signed-out')
    return (
      <p className={line} role="status">
        {t('Ramu Link needs the Ramu account on this computer.')}
        <LocalInlineAction onClick={openSignIn}>{t('Sign in')}</LocalInlineAction>
      </p>
    )
  if (link.state === 'waitlisted')
    return (
      <>
        <p className={line} role="status">
          {t(
            'Ramu Link is full right now. This computer is number {0} in line and switches on its own when a slot frees.',
            {
              0: link.position ?? '?',
            },
          )}
          <LocalInlineAction onClick={onRelease}>{t('Leave the waitlist')}</LocalInlineAction>
        </p>
        <OtherRoutes status={status} onChoose={onChoose} />
      </>
    )
  if (link.state === 'suspended')
    return (
      <>
        <p className={`${line} text-warn`} role="status">
          {t('Ramu Link used this month’s {0} and is paused until {1}. Your network and VPN still work.', {
            0: formatSize(LINK_LIMITS.monthlyBytes),
            1: new Date(link.until ?? 0).toLocaleDateString(),
          })}
        </p>
        <OtherRoutes status={status} onChoose={onChoose} />
      </>
    )
  if (link.state === 'taken')
    return (
      <>
        <p className={line} role="status">
          {t(
            'Your Ramu account’s link is used by {0}. Give it back there (Settings → Remote access), or use another way here.',
            {
              0: link.takenBy ?? t('another computer'),
            },
          )}
        </p>
        <OtherRoutes status={status} onChoose={onChoose} />
      </>
    )
  // Without cloudflared the relay was never asked, so there is nothing to say about the link yet; the line about
  // installing it stands alone.
  if (link.state === 'unavailable' && (tunnel.state === 'missing' || !tunnel.tools.cloudflared)) return null
  if (link.state === 'unavailable') {
    const known = link.reason ? LINK_REASON[link.reason] : undefined
    const reason = known ? t(known) : link.reason
    return (
      <>
        <p className={`${line} text-warn`} role="status">
          {t('Ramu Link can’t be reached right now{0}. Ramu will ask again.', { 0: reason ? `: ${reason}` : '' })}
        </p>
        <OtherRoutes status={status} onChoose={onChoose} />
      </>
    )
  }
  const usage = link.usage?.bytes ?? 0
  const level = linkUsageLevel(usage)
  return (
    <div className="mb-3 flex flex-col gap-1" role="status">
      {tunnel.state === 'running' && tunnel.url ? (
        <p className={`${line} m-0`}>
          {t('Reachable at {0}', { 0: tunnel.url })}
          <CopyButton text={tunnel.url} label={t('Copy the tunnel address')} />
        </p>
      ) : (
        <p className={`${line} m-0`}>{t('Connecting to Ramu Link…')}</p>
      )}
      <p className={`${line} m-0 ${level === 'ok' ? '' : 'text-warn'}`}>
        {t('{0} of {1} this month · {2} of {3} devices connected through it', {
          0: formatSize(usage),
          1: formatSize(LINK_LIMITS.monthlyBytes),
          2: link.devices,
          3: LINK_LIMITS.devices,
        })}
      </p>
      {link.releasesAt ? (
        <p className={`${line} m-0`}>
          {t('Kept while you use it. Unused, the address is released on {0}.', {
            0: new Date(link.releasesAt).toLocaleDateString(),
          })}
          <LocalInlineAction onClick={onRelease}>{t('Give the slot back')}</LocalInlineAction>
        </p>
      ) : null}
    </div>
  )
}
