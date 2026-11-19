import { UsageAcrossHosts } from './UsageAcrossHosts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ProviderIcon } from './Logos'
import { Pressable, View } from 'react-native'
import { Gauge, Monitor, Network, Settings } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { useRouter } from 'expo-router'
import type { AgentProvider, UsageReading } from '@ramu/shared/types'
import { accountName, planName, providerEnabled } from '@ramu/shared/providers/providers'
import {
  summaryUsage,
  usagePercent,
  usageStale,
  usageTone,
  usageWindow,
  groupUsageByProvider,
} from '@ramu/shared/usage/presentation'
import { useStore } from '../runtime/store'
import { useAccountLogins } from '../runtime/useAccountLogins'
import { useSay } from '../i18n'
import { providerNames } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { Card, Divider, Row, SectionLabel, Sheet, T } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

export function PlanUsageReading({
  reading: r,
  offline = false,
  compact = false,
  account,
}: {
  /** The login's name as people read it; without one only the provider is named. */
  account?: string
  reading: UsageReading
  offline?: boolean
  /** Inside an account's card, which names the plan and how fresh its readings are once for all its windows. */
  compact?: boolean
}) {
  const { c } = useTheme()
  const { language } = useStore()
  const say = useSay()
  const now = Date.now()
  const percent = usagePercent(r)
  const tone = usageTone(r)
  const value =
    percent === null
      ? r.source === 'notice'
        ? say('Limit reported, usage unavailable')
        : say('Not reported')
      : say('{0}% used', { 0: Math.round(percent) })
  const lastKnown = offline || usageStale(r, now)
  const id = language === 'id'
  const color = percent === null ? c.muted : tone === 'bad' ? c.bad : tone === 'warn' ? c.warn : c.primary
  // How long until it resets reads at a glance; the exact time stays for when it is far off.
  const until = r.resetsAt ? r.resetsAt - now : null
  const reset =
    until === null
      ? say('No reset time reported')
      : until <= 0
        ? say('Awaiting the reset')
        : until < 24 * 60 * 60_000
          ? say('Resets in {0}', { 0: duration(until, say) })
          : say('Resets {0}', {
              0: new Date(r.resetsAt!).toLocaleString(id ? 'id-ID' : 'en-US', {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              }),
            })
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      {!compact ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ProviderIcon provider={r.provider} size={16} />
          <T weight="600" style={{ flexShrink: 1 }}>
            {account ? `${providerNames[r.provider]} · ${account}` : providerNames[r.provider]}
          </T>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
        <T weight="500" style={{ flex: 1 }} numberOfLines={1}>
          {usageWindow(r, false, language)}
        </T>
        {percent === null ? (
          <T tone="muted" size={font.caption}>
            {value}
          </T>
        ) : (
          <T weight="700" size={20} style={{ color, fontVariant: ['tabular-nums'] }}>
            {Math.round(percent)}%
          </T>
        )}
      </View>
      {percent !== null ? (
        <View
          accessibilityLabel={value}
          style={{ height: 8, borderRadius: 4, backgroundColor: c.fill, overflow: 'hidden' }}
        >
          <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, percent)}%`, backgroundColor: color }} />
        </View>
      ) : null}
      <T tone="muted" size={font.caption}>
        {[
          reset,
          !compact && r.plan ? planName(r.plan) : null,
          !compact
            ? lastKnown
              ? say('last reported {0}', { 0: relative(r.updatedAt, say, id) })
              : say('updated {0}', { 0: relative(r.updatedAt, say, id) })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </T>
    </View>
  )
}

/**
 * An account's plan, and when its readings are old how long ago they were updated, as the desktop shows them: once
 * for the account, not on every window.
 */
function AccountFacts({ readings, offline }: { readings: UsageReading[]; offline: boolean }) {
  const { language } = useStore()
  const say = useSay()
  const id = language === 'id'
  const now = Date.now()
  const plan = [...readings].filter((r) => r.plan).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.plan
  const newest = Math.max(...readings.map((r) => r.updatedAt))
  const stale = offline || readings.every((r) => usageStale(r, now))
  if (!plan && !stale) return null
  return (
    <T size={font.caption} tone={stale ? 'warn' : 'muted'}>
      {[plan ? planName(plan) : null, stale ? say('Updated {0}', { 0: relative(newest, say, id) }) : null]
        .filter(Boolean)
        .join(' · ')}
    </T>
  )
}

/** "2 h 15 min", "45 min": how long until a limit resets. */
function duration(ms: number, say: ReturnType<typeof useSay>): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours
    ? minutes % 60
      ? say('{0} h {1} min', { 0: hours, 1: minutes % 60 })
      : say('{0} h', { 0: hours })
    : say('{0} min', { 0: minutes })
}

function relative(at: number, say: ReturnType<typeof useSay>, id: boolean): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return say('just now')
  if (minutes < 60) return say('{0} min ago', { 0: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return say('{0} h ago', { 0: hours })
  return new Date(at).toLocaleDateString(id ? 'id-ID' : 'en-US')
}

export function PlanUsageSheet({
  hosts: hostList,
  open,
  onClose,
  provider,
  accountId,
  context,
}: {
  context?: ReactNode
  hosts: string[]
  open: boolean
  onClose: () => void
  provider?: AgentProvider
  accountId?: string
}) {
  const store = useStore()
  const router = useRouter()
  const [accounts, setAccounts] = useState<Record<string, UsageReading[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const say = useSay()
  const hostKey = hostList.join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the ids, so a caller's new array of the same hosts keeps it
  const hosts = useMemo(() => Array.from(new Set(hostList)), [hostKey])
  const logins = useAccountLogins(hosts, open)
  const refreshing = useRef<number | null>(null)
  const generation = useRef(0)
  const sequences = useRef(new Map<string, number>())
  const readAccounts = async (id: string, request: number) => {
    const sequence = (sequences.current.get(id) ?? 0) + 1
    sequences.current.set(id, sequence)
    let rows: UsageReading[]
    try {
      rows = await store.invoke(id, 'usage.accounts')
    } catch (error) {
      if (request === generation.current && sequences.current.get(id) === sequence) throw error
      return
    }
    if (request !== generation.current || sequences.current.get(id) !== sequence) return
    setAccounts((all) => ({ ...all, [id]: rows }))
    setErrors((all) => ({ ...all, [id]: '' }))
  }
  const key = JSON.stringify(hosts)
  const connectionKey = JSON.stringify(hosts.map((id) => store.isOnline(id)))
  useEffect(() => {
    const request = ++generation.current
    refreshing.current = null
    setBusy(false)
    setErrors({})
    setFilter(null)
    if (!open) return
    const read = (id: string) => {
      void readAccounts(id, request).catch(() => {
        if (request !== generation.current) return
        setErrors((all) => ({
          ...all,
          [id]: say('Could not load accounts. Last-known readings remain visible.'),
        }))
      })
    }
    const subscriptions = hosts
      .filter((id) => store.isOnline(id))
      .map((id) => {
        read(id)
        return store.subscribe(id, (...[channel]) => {
          if (channel === 'usage:changed') read(id)
        })
      })
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++generation.current
      for (const off of subscriptions) off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [open, key, connectionKey, store.language] by design; the values it reads beyond these are current as of that run
  }, [open, key, connectionKey, store.language])
  const refreshHosts = hosts.filter((id) => (!filter || filter === id) && store.isOnline(id))
  const refresh = async () => {
    if (refreshing.current !== null || !open) return
    const request = generation.current
    refreshing.current = request
    setBusy(true)
    try {
      for (const id of refreshHosts) {
        if (request !== generation.current) break
        try {
          // Refresh never implies support for readings the provider only reports during a session.
          await store.invoke(id, 'usage.refresh')
          if (request !== generation.current) break
          await readAccounts(id, request)
        } catch (error) {
          if (request !== generation.current) break
          setErrors((all) => ({
            ...all,
            [id]: say('Refresh unavailable. Last-known readings remain visible.'),
          }))
        }
      }
    } finally {
      if (request === generation.current) {
        refreshing.current = null
        setBusy(false)
      }
    }
  }
  return (
    <Sheet presentation="screen" open={open} onClose={onClose} title={say('Plan usage')}>
      {context}
      <T tone="muted" style={{ padding: space.m }}>
        {say('Shared across threads on this account')}
      </T>
      {!provider || provider === 'claude-code' ? (
        <Row onPress={busy || !refreshHosts.length ? undefined : () => void refresh()}>
          <T tone="muted">{busy ? say('Refreshing…') : say('Refresh Claude usage')}</T>
        </Row>
      ) : null}
      {hosts.length > 1 ? (
        <SheetGroup>
          <SheetOption icon={Network} title={say('All hosts')} selected={!filter} onPress={() => setFilter(null)} />
          {hosts.map((id) => (
            <SheetOption
              key={id}
              icon={Monitor}
              title={store.computers.find((h) => h.id === id)?.name ?? id}
              selected={filter === id}
              onPress={() => setFilter(id)}
            />
          ))}
        </SheetGroup>
      ) : null}
      {!filter && !provider ? (
        <UsageAcrossHosts
          hosts={hosts}
          readings={Object.fromEntries(hosts.map((id) => [id, accounts[id] ?? store.usage[id] ?? []]))}
        />
      ) : null}
      {hosts
        .filter((id) => !filter || id === filter)
        .map((id) => {
          const host = store.computers.find((h) => h.id === id)
          const rows = (accounts[id] ?? store.usage[id] ?? []).filter(
            (r) =>
              (!provider || r.provider === provider) &&
              (!accountId || (r.accountId ?? 'default') === accountId) &&
              providerEnabled(store.appPreferences[id]?.providerBinaries, r.provider),
          )
          return (
            <View key={id}>
              <SectionLabel>
                {host?.name ?? id}
                {store.isOnline(id) ? '' : ` · ${say('Offline')}`}
              </SectionLabel>
              {errors[id] ? (
                <T tone="bad" style={{ padding: space.m }}>
                  {errors[id]}
                </T>
              ) : null}
              {!rows.length ? (
                <T tone="muted" style={{ padding: space.m }}>
                  {say('Not reported')}
                </T>
              ) : (
                groupUsageByProvider(rows).map((group) => (
                  <View key={`${id}:${group.provider}`}>
                    {provider ? null : (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.s,
                          paddingHorizontal: space.m,
                          paddingTop: space.s,
                        }}
                      >
                        <ProviderIcon provider={group.provider} size={14} />
                        <T tone="muted" size={font.caption} style={{ flexShrink: 1 }}>
                          {providerNames[group.provider]} ·{' '}
                          {group.readings.length === 1
                            ? say('{0} window', { 0: 1 })
                            : say('{0} windows', { 0: group.readings.length })}
                          {group.attention ? ` · ${say('{0} need attention', { 0: group.attention })}` : ''}
                        </T>
                      </View>
                    )}
                    {Array.from(new Set(group.readings.map((reading) => reading.accountId ?? 'default'))).map(
                      (account) => {
                        const readings = group.readings.filter(
                          (reading) => (reading.accountId ?? 'default') === account,
                        )
                        const title = accountName(
                          store.appPreferences[id]?.providerBinaries,
                          group.provider,
                          account,
                          logins[id]?.[group.provider]?.[account],
                          say,
                        )
                        return (
                          <Card key={account} style={{ margin: space.m }}>
                            <View style={{ padding: space.m, gap: space.xs }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                                <ProviderIcon provider={group.provider} size={18} />
                                <T weight="600" style={{ flexShrink: 1 }}>
                                  {providerNames[group.provider]} · {title}
                                </T>
                              </View>
                              <AccountFacts readings={readings} offline={!store.isOnline(id)} />
                            </View>
                            {readings.map((reading) => (
                              <View key={`${reading.window}:${reading.scope ?? ''}`}>
                                <Divider />
                                <PlanUsageReading reading={reading} compact offline={!store.isOnline(id)} />
                              </View>
                            ))}
                          </Card>
                        )
                      },
                    )}
                  </View>
                ))
              )}
            </View>
          )
        })}
      <SheetGroup>
        <SheetOption
          icon={Settings}
          title={say('Models & access settings')}
          onPress={() => {
            const target = filter ?? (hosts.length === 1 ? hosts[0] : undefined)
            if (target) store.select(target)
            onClose()
            router.push('/settings/providers')
          }}
        />
      </SheetGroup>
    </Sheet>
  )
}

export function PlanUsageSummary({ hostIds, actionOnly = false }: { hostIds: string[]; actionOnly?: boolean }) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const hosts = hostIds.filter((id) => store.appPreferences[id]?.showUsageLimits !== false)
  const summary = summaryUsage(
    hosts.map((id) => ({
      id,
      online: store.isOnline(id),
      readings: (store.usage[id] ?? []).filter((r) =>
        providerEnabled(store.appPreferences[id]?.providerBinaries, r.provider),
      ),
    })),
    Date.now(),
  )
  if (!hosts.length) return null
  const percent = summary ? usagePercent(summary.reading) : null
  const label = say('Plan usage')
  const value = !summary
    ? say('Not reported')
    : `${hostIds.length > 1 ? `${store.computers.find((h) => h.id === summary.hostId)?.name ?? summary.hostId} · ` : ''}${providerNames[summary.reading.provider]} · ${percent === null ? (summary.reading.source === 'notice' ? say('Limit reported') : say('Not reported')) : say('{0}% used', { 0: Math.round(percent) })}${summary.lastKnown ? ` · ${say('Last reported')}` : ''}`
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        onPress={() => setOpen(true)}
        style={{
          paddingHorizontal: actionOnly ? space.s : space.l,
          paddingVertical: space.s,
          // As a header action it is an icon only, so large text can never push other actions off the row.
          minWidth: actionOnly ? 44 : undefined,
          minHeight: actionOnly ? 44 : undefined,
          justifyContent: actionOnly ? 'center' : undefined,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          flexShrink: 1,
        }}
      >
        {actionOnly && percent !== null ? (
          <UsageRing percent={percent} />
        ) : summary && !actionOnly ? (
          <ProviderIcon provider={summary.reading.provider} size={16} />
        ) : (
          <Gauge size={16} color={c.soft} />
        )}
        {actionOnly ? null : (
          <T size={font.caption} style={{ flexShrink: 1 }}>
            {label} · {value}
          </T>
        )}
      </Pressable>
      <PlanUsageSheet hosts={hostIds} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
/** The header's plan usage at a glance: the ring fills with the busiest limit and turns amber, then red, near it. */
function UsageRing({ percent }: { percent: number }) {
  const { c } = useTheme()
  const size = 20
  const stroke = 2.4
  const r = (size - stroke) / 2
  const around = 2 * Math.PI * r
  const used = Math.max(0, Math.min(100, percent))
  const tint = used >= 90 ? c.bad : used >= 70 ? c.warn : c.accent
  return (
    <Svg width={size} height={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.lineStrong} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={tint}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${(around * used) / 100} ${around}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  )
}
