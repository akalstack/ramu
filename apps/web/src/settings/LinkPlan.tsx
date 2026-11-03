// The Ramu Link account's plan, relayed time and sharing, under the Ramu Link settings of this host. Paying happens in
// the browser on Paddle's checkout; this only opens it and watches for Plus to arrive.
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, UserPlus, X } from 'lucide-react'
import type { LinkShare } from '@ramu/shared/link/account'
import { planSummary } from '@ramu/shared/link/plan'
import type { LinkBillingInterval } from '@ramu/shared/link/protocol'
import type { NetworkStatus } from '@ramu/shared/types'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { formatLocale, t } from '../i18n'
import { useSettingsInvoke } from './SettingsScope'

/** Paddle confirms a payment within seconds to a minute; stop watching after this. */
const WATCH_MS = 10 * 60_000
const WATCH_EVERY_MS = 5000

const day = (at: number) => new Date(at).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'long' })

function planText(plan: NonNullable<NetworkStatus['link']['plan']>) {
  const summary = planSummary(plan)
  const hosts =
    plan.hostLimit === null
      ? t('{0} hosts linked', { 0: plan.hosts })
      : t('{0} of {1} hosts', { 0: plan.hosts, 1: plan.hostLimit })
  if (plan.plan === 'free')
    return [
      t('Free'),
      hosts,
      t('{0} of {1} relayed hours this month', { 0: summary.hoursUsed, 1: summary.hoursLimit ?? 0 }),
    ].join(' · ')
  const until =
    plan.source === 'self-hosted'
      ? t('every feature on your own service')
      : plan.expiresAt === null
        ? null
        : plan.renews
          ? t('renews {0}', { 0: day(plan.expiresAt) })
          : t('ends {0}', { 0: day(plan.expiresAt) })
  return [t('Plus'), hosts, ...(until ? [until] : [])].join(' · ')
}

export function LinkPlanSettings({
  status,
  setStatus,
}: {
  status: NetworkStatus
  setStatus(next: NetworkStatus): void
}) {
  const invoke = useSettingsInvoke()
  const plan = status.link.plan
  const [watching, setWatching] = useState(false)
  const [busy, setBusy] = useState(false)
  const setRef = useRef(setStatus)
  setRef.current = setStatus

  // Settings opening is when the month's hours matter; ask the service once rather than on every status change.
  useEffect(() => {
    void Promise.resolve(invoke('network.linkRefresh')).then(
      (next) => setRef.current(next),
      () => {},
    )
  }, [invoke])

  // After checkout opens, follow the plan until Plus arrives or the watch runs out.
  useEffect(() => {
    if (!watching) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      if (Date.now() - started > WATCH_MS) return setWatching(false)
      void Promise.resolve(invoke('network.linkRefresh')).then(
        (next) => {
          setRef.current(next)
          if (next.link.plan?.plan === 'plus') setWatching(false)
        },
        () => {},
      )
    }, WATCH_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [watching, invoke])

  if (!plan) return null
  const summary = planSummary(plan)
  const getPlus = async (interval: LinkBillingInterval) => {
    setBusy(true)
    try {
      const { url } = await invoke('network.linkCheckout', interval)
      await ramu.invoke('app.openExternal', url)
      setWatching(true)
    } catch (error) {
      notifyError(errorText(error), t('Ramu Plus'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SettingsRow>
        <SettingsLabel
          title={t('Plan')}
          help={
            summary.outOfHours
              ? `${planText(plan)}. ${t('Ramu Link takes no new connections until the 1st; this host’s own network still works.')}`
              : summary.atHostLimit && summary.canGetPlus
                ? `${planText(plan)}. ${t('Linking another host needs Plus, or unlinking one.')}`
                : planText(plan)
          }
        />
        {summary.canGetPlus && (
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void getPlus('year')}>
              <ExternalLink size={14} />
              {t('Get Plus yearly')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void getPlus('month')}>
              {t('Monthly')}
            </Button>
          </div>
        )}
      </SettingsRow>
      {watching && (
        <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role="status">
          {t('Finish paying in your browser. Plus shows here once Paddle confirms it.')}
        </p>
      )}
      <LinkShares plus={plan.plan === 'plus'} canGetPlus={summary.canGetPlus} />
    </>
  )
}

/** Another Ramu Link account that may reach this host; the host still pairs it, and only as a viewer. */
function LinkShares({ plus, canGetPlus }: { plus: boolean; canGetPlus: boolean }) {
  const invoke = useSettingsInvoke()
  const [shares, setShares] = useState<LinkShare[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!plus) return
    let alive = true
    void Promise.resolve(invoke('network.linkShares')).then(
      (next) => alive && setShares(next),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [plus, invoke])
  if (!plus && !canGetPlus) return null
  const run = async (work: () => Promise<LinkShare[]>) => {
    setBusy(true)
    try {
      setShares(await work())
      setEmail('')
    } catch (error) {
      notifyError(errorText(error), t('Share this host'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SettingsRow>
        <SettingsLabel
          title={t('Share this host')}
          help={
            plus
              ? t(
                  'Let another Ramu Link account reach this host. They pair once you allow them, and can only view threads and answer requests.',
                )
              : t('With Plus, another Ramu Link account can reach this host as a viewer.')
          }
        />
        {plus && (
          <div className="flex gap-2">
            <Input
              aria-label={t('Email of their Ramu Link account')}
              placeholder={t('Email of their Ramu Link account')}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button
              disabled={busy || !email.trim()}
              onClick={() => void run(() => invoke('network.linkShare', email.trim()))}
            >
              <UserPlus size={14} />
              {t('Share')}
            </Button>
          </div>
        )}
      </SettingsRow>
      {shares.map((share) => (
        <SettingsRow key={share.userId}>
          <SettingsLabel title={share.name} help={share.email} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Stop sharing with {0}', { 0: share.email })}
            title={t('Stop sharing with {0}', { 0: share.email })}
            disabled={busy}
            onClick={() => void run(() => invoke('network.linkUnshare', share.userId))}
          >
            <X size={14} />
          </Button>
        </SettingsRow>
      ))}
    </>
  )
}
