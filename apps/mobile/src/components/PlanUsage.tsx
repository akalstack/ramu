import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ProviderIcon } from './Logos'
import { Pressable, View } from 'react-native'
import { Eye, EyeOff, Gauge, RefreshCw, Settings } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { useRouter } from 'expo-router'
import type { AgentProvider, UsageReading } from '@ramu/shared/types'
import {
  AGENT_PROVIDERS,
  accountName,
  planName,
  providerEnabled,
  type AccountLogin,
} from '@ramu/shared/providers/providers'
import {
  activityAcrossHosts,
  loginRows,
  loginsWithRoom,
  providerLoginRows,
  type ActivityRow,
  type ActivityTotal,
  type LoginRow,
} from '@ramu/shared/usageAcrossHosts'
import { summaryUsage, usagePercent, usageStale, usageTone, usageWindow } from '@ramu/shared/usage/presentation'
import { useStore } from '../runtime/store'
import { useAccountLogins } from '../runtime/useAccountLogins'
import { setUsageReveal, useUsageReveal } from '../runtime/usageReveal'
import { useSay } from '../i18n'
import { providerNames } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { Card, Chip, Divider, Pill, SectionLabel, Sheet, T } from './ui'
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
    <View style={{ paddingHorizontal: space.m, paddingVertical: compact ? space.s : space.m, gap: space.s }}>
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
          <T weight="700" size={compact ? font.body : 20} style={{ color, fontVariant: ['tabular-nums'] }}>
            {Math.round(percent)}%
          </T>
        )}
      </View>
      {percent !== null ? (
        <View
          accessibilityLabel={value}
          style={{ height: compact ? 6 : 8, borderRadius: 4, backgroundColor: c.fill, overflow: 'hidden' }}
        >
          <View
            style={{ height: '100%', borderRadius: 4, width: `${Math.max(2, percent)}%`, backgroundColor: color }}
          />
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

/** Windows in reading order: the short window, then the weekly or monthly allowance, then model-specific ones. */
const windowOrder = (reading: UsageReading) =>
  (reading.scope ? 2 : 0) + (reading.window === 'five_hour' ? 0 : reading.window === 'quota' ? 1.5 : 1)

/** Each provider's sign-in emails by account id, from a host's logins, for matching a login across hosts. */
const emailsOf = (logins: Record<string, Record<string, AccountLogin>> | undefined) =>
  Object.fromEntries(
    Object.entries(logins ?? {}).map(([provider, accounts]) => [
      provider,
      Object.fromEntries(
        Object.entries(accounts).flatMap(([id, login]) => (login.email ? [[id, login.email] as const] : [])),
      ),
    ]),
  )

/**
 * Plan usage for every login on the given hosts: one section per provider, one card per login with all its windows,
 * the login threads use marked, and the week's activity. Labels and emails stay hidden until asked for, since the
 * phone may be showing its screen to others.
 */
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
  const [busy, setBusy] = useState(false)
  const reveal = useUsageReveal()
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
  const name = (id: string) => store.computers.find((h) => h.id === id)?.name ?? id
  const config = (id: string) => store.appPreferences[id]?.providerBinaries
  const multiHost = hosts.length > 1
  const offline = hosts.filter((id) => !store.isOnline(id))
  const rows = loginRows(
    hosts.map((id) => ({
      hostId: id,
      host: name(id),
      readings: (accounts[id] ?? store.usage[id] ?? []).filter((r) => providerEnabled(config(id), r.provider)),
      emails: emailsOf(logins[id]),
      config: config(id),
    })),
  ).filter(
    (row) =>
      (!provider || row.provider === provider) &&
      (!accountId || row.places.some((place) => place.accountId === accountId)),
  )
  const sections = AGENT_PROVIDERS.flatMap((id) => {
    const own = providerLoginRows(rows, id)
    return own.length ? [{ provider: id, rows: own }] : []
  })
  // Claude is the provider that can be asked for its usage outside a session; the others report while they run.
  const refreshHosts = hosts.filter((id) => store.isOnline(id))
  const canRefresh = (!provider || provider === 'claude-code') && refreshHosts.length > 0
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
        } catch {
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
  const failed = hosts.filter((id) => errors[id])
  return (
    <Sheet presentation="screen" open={open} onClose={onClose} title={say('Plan usage')}>
      {context}
      <View style={{ paddingHorizontal: space.l, paddingTop: space.s, gap: space.m }}>
        <T tone="muted" size={font.control}>
          {multiHost
            ? say('Every login on every connected host. A login signed in on several hosts shows once.')
            : say('Every login on this host. At a limit, fallback moves a thread only to a login with an API key.')}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          <Chip
            small
            fill
            icon={reveal ? EyeOff : Eye}
            label={reveal ? say('Hide accounts') : say('Show accounts')}
            accessibilityLabel={reveal ? say('Hide account names and emails') : say('Show account names and emails')}
            onPress={() => setUsageReveal(!reveal)}
          />
          {canRefresh ? (
            <Chip
              small
              fill
              icon={RefreshCw}
              label={busy ? say('Refreshing…') : say('Refresh Claude usage')}
              onPress={() => void refresh()}
            />
          ) : null}
        </View>
        {failed.map((id) => (
          <T key={id} tone="bad" size={font.caption}>
            {multiHost ? `${name(id)} · ${errors[id]}` : errors[id]}
          </T>
        ))}
        {offline.length ? (
          <T tone="warn" size={font.caption}>
            {say('Offline: {0}. Last-known readings are shown.', { 0: offline.map(name).join(', ') })}
          </T>
        ) : null}
      </View>
      {sections.length ? (
        sections.map((section) => (
          <View key={section.provider}>
            <SectionLabel
              right={
                section.rows.length > 1 ? (
                  <T size={font.caption} tone="muted">
                    {say('{0} logins · {1} with room', {
                      0: section.rows.length,
                      1: loginsWithRoom(section.rows),
                    })}
                  </T>
                ) : undefined
              }
            >
              {providerNames[section.provider]}
            </SectionLabel>
            <Card style={{ marginHorizontal: space.l }}>
              {section.rows.map((row, index) => {
                const source = row.namedBy.hostId
                const title = accountName(
                  config(source),
                  row.provider,
                  row.namedBy.accountId,
                  logins[source]?.[row.provider]?.[row.namedBy.accountId],
                  say,
                  reveal,
                )
                return (
                  <View
                    key={`${row.email ?? ''}:${row.places.map((place) => `${place.hostId}/${place.accountId}`).join(',')}`}
                  >
                    {index ? <Divider /> : null}
                    <LoginCard
                      row={row}
                      title={title}
                      multiHost={multiHost}
                      offline={row.where.every((place) => !store.isOnline(place.hostId))}
                    />
                  </View>
                )
              })}
            </Card>
          </View>
        ))
      ) : (
        <T tone="muted" style={{ padding: space.l }}>
          {say('No usage reported yet. It appears once a provider runs.')}
        </T>
      )}
      {provider ? null : <WeekActivity hosts={hosts} />}
      <View style={{ paddingTop: space.l }}>
        <SheetGroup>
          <SheetOption
            icon={Settings}
            title={say('Models & access settings')}
            onPress={() => {
              if (hosts.length === 1) store.select(hosts[0]!)
              onClose()
              router.push('/settings/providers')
            }}
          />
        </SheetGroup>
      </View>
    </Sheet>
  )
}

/** One login: its name, whether threads use it and its plan, where it is signed in, then each limit window. */
function LoginCard({
  row,
  title,
  multiHost,
  offline,
}: {
  row: LoginRow
  title: string
  multiHost: boolean
  offline: boolean
}) {
  const { c } = useTheme()
  const { language } = useStore()
  const say = useSay()
  const now = Date.now()
  const stale = offline || row.readings.every((reading) => usageStale(reading, now))
  const readings = [...row.readings].sort((a, b) => windowOrder(a) - windowOrder(b))
  return (
    <View style={{ paddingVertical: space.s }}>
      <View style={{ paddingHorizontal: space.m, paddingTop: space.xs, gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ProviderIcon provider={row.provider} size={16} />
          <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </T>
          {row.inUse ? (
            <Pill tone="accent" wash={c.accentSoft}>
              {say('In use')}
            </Pill>
          ) : null}
          {row.plan ? <Pill>{planName(row.plan)}</Pill> : null}
        </View>
        {multiHost
          ? row.where.map((place) => (
              <View
                key={place.hostId}
                accessibilityLabel={place.inUse ? say('Threads on {0} use this login', { 0: place.host }) : place.host}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: place.inUse ? c.primary : c.lineStrong,
                  }}
                />
                <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {place.inUse ? say('{0} · in use', { 0: place.host }) : place.host}
                </T>
              </View>
            ))
          : null}
        {row.matchedBy === 'limits' ? (
          <T size={font.caption} tone="muted">
            {say('Matched by its limits')}
          </T>
        ) : null}
        {stale ? (
          <T size={font.caption} tone="warn">
            {say('Updated {0}', { 0: relative(row.newest, say, language === 'id') })}
          </T>
        ) : null}
      </View>
      {readings.map((reading) => (
        <PlanUsageReading key={`${reading.window}:${reading.scope ?? ''}`} reading={reading} compact />
      ))}
    </View>
  )
}

/** This week's finished turns, reported cost and tokens, added across hosts; a host not read is named, not zero. */
function WeekActivity({ hosts }: { hosts: string[] }) {
  const say = useSay()
  const store = useStore()
  const [week, setWeek] = useState<ActivityTotal | null>(null)
  const name = (id: string) => store.computers.find((pc) => pc.id === id)?.name ?? id
  const key = hosts.map((id) => `${id}:${store.isOnline(id)}`).join(',')
  useEffect(() => {
    let live = true
    void Promise.all(
      hosts.map(async (id) => ({
        host: name(id),
        rows: store.isOnline(id)
          ? await (store.invoke(id, 'usage.activity', 7) as Promise<ActivityRow[]>).catch(() => null)
          : null,
      })),
    ).then((rows) => live && setWeek(activityAcrossHosts(rows)))
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the hosts and whether each is online
  if (!week?.turns) return null
  const locale = store.language === 'id' ? 'id-ID' : 'en-US'
  const figures = [
    say('{0} turns', { 0: week.turns }),
    week.costUsd > 0 ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(week.costUsd) : '',
    week.tokens > 0 ? say('{0} tokens', { 0: compactCount(week.tokens, locale) }) : '',
  ].filter(Boolean)
  const notes = [
    week.byHost.length > 1 ? week.byHost.map((entry) => `${entry.host} ${entry.turns}`).join(', ') : '',
    week.unpricedOn.length ? say('Some providers on {0} report no cost', { 0: week.unpricedOn.join(', ') }) : '',
    week.tokens > 0 && week.untokenedOn.length
      ? say('Some providers on {0} report no tokens', { 0: week.untokenedOn.join(', ') })
      : '',
    week.missing.length ? say('Not counted: {0}', { 0: week.missing.join(', ') }) : '',
  ].filter(Boolean)
  return (
    <View>
      <SectionLabel>{say('This week')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l, padding: space.m, gap: space.xs }}>
        <T weight="600" style={{ fontVariant: ['tabular-nums'] }}>
          {figures.join(' · ')}
        </T>
        {notes.map((note) => (
          <T key={note} size={font.caption} tone="muted">
            {note}
          </T>
        ))}
      </Card>
    </View>
  )
}

/** "51.4M": a large count short enough for one line; Hermes formats compact notation unreliably. */
function compactCount(count: number, locale: string): string {
  const [divisor, suffix] = count >= 1e9 ? [1e9, 'B'] : count >= 1e6 ? [1e6, 'M'] : count >= 1e3 ? [1e3, 'K'] : [1, '']
  return `${(count / divisor).toLocaleString(locale, { maximumFractionDigits: divisor === 1 ? 0 : 1 })}${suffix}`
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
