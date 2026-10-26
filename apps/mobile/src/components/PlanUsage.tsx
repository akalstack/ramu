import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Gauge, Monitor, Network, Settings } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { isMethodMissing } from '../runtime/goalVerify'
import type { AgentProvider, NextMessageRoute, UsageReading } from '@ramu/shared/types'
import { providerEnabled } from '@ramu/shared/providers/providers'
import {
  relevantUsage,
  summaryUsage,
  usagePercent,
  usageStale,
  usageTone,
  usageWindow,
  usageScopeHint,
  groupUsageByProvider,
} from '@ramu/shared/usage/presentation'
import { useStore } from '../runtime/store'
import { providerNames } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { Card, Divider, Row, SectionLabel, Sheet, T, Toggle } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

export function PlanUsageReading({
  reading: r,
  offline = false,
  compact = false,
  details = true,
}: {
  reading: UsageReading
  offline?: boolean
  compact?: boolean
  details?: boolean
}) {
  const { c } = useTheme()
  const { language } = useStore()
  const now = Date.now()
  const percent = usagePercent(r)
  const tone = usageTone(r)
  const used = language === 'id' ? 'terpakai' : 'used'
  const value =
    percent === null
      ? r.source === 'notice'
        ? language === 'id'
          ? 'Batas dilaporkan; penggunaan tidak tersedia'
          : 'Limit reported; usage unavailable'
        : language === 'id'
          ? 'Tidak dilaporkan'
          : 'Not reported'
      : `${Math.round(percent)}% ${used}`
  const lastKnown = offline || usageStale(r, now)
  const scopeHint = usageScopeHint(r, language)
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      {!compact ? (
        <T weight="600">
          {providerNames[r.provider]} · {r.accountId ?? 'default'}
        </T>
      ) : null}
      <T size={font.control}>
        {usageWindow(r, false, language)} · {value}
        {r.plan ? ` · ${r.plan}` : ''}
      </T>
      {scopeHint ? (
        <T tone="muted" size={font.caption}>
          {scopeHint}
        </T>
      ) : null}
      {percent !== null ? (
        <View style={{ height: 5, borderRadius: 3, backgroundColor: c.fill, overflow: 'hidden' }}>
          <View
            style={{
              height: 5,
              width: `${percent}%`,
              backgroundColor: tone === 'bad' ? c.bad : tone === 'warn' ? c.warn : c.primary,
            }}
          />
        </View>
      ) : null}
      {details ? (
        <T tone="muted" size={font.caption}>
          {lastKnown
            ? language === 'id'
              ? 'Terakhir dilaporkan'
              : 'Last reported'
            : language === 'id'
              ? 'Diperbarui'
              : 'Updated'}{' '}
          {new Date(r.updatedAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US')}
        </T>
      ) : null}
      <T tone="muted" size={font.caption}>
        {!r.resetsAt
          ? language === 'id'
            ? 'Waktu reset tidak dilaporkan'
            : 'No reset time reported'
          : r.resetsAt <= now
            ? language === 'id'
              ? 'Waktu reset lewat; menunggu pembaruan'
              : 'Reset time passed; awaiting update'
            : `${language === 'id' ? 'Reset' : 'Resets'} ${new Date(r.resetsAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US')}`}
      </T>
    </View>
  )
}

export function PlanUsageSheet({
  hosts,
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
  const [unsupportedRefresh, setUnsupportedRefresh] = useState<string[]>([])
  const [filter, setFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(() => store.drafts?.['usage-show-details'] === 'yes')
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
    setUnsupportedRefresh([])
    setFilter(null)
    if (!open) return
    const read = (id: string) => {
      void readAccounts(id, request).catch((error) => {
        if (request !== generation.current) return
        setErrors((all) => ({
          ...all,
          [id]:
            store.language === 'id'
              ? isMethodMissing(error)
                ? 'Perbarui host untuk melihat penggunaan per akun.'
                : 'Tidak dapat memuat akun. Data terakhir tetap ditampilkan.'
              : isMethodMissing(error)
                ? 'Update this host to inspect usage by account.'
                : 'Could not load accounts. Last-known readings remain visible.',
        }))
      })
    }
    const subscriptions = hosts
      .filter((id) => store.isOnline(id))
      .map((id) => {
        read(id)
        return store.subscribe(id, (channel) => {
          if (channel === 'usage:changed') read(id)
        })
      })
    return () => {
      ++generation.current
      for (const off of subscriptions) off()
    }
  }, [open, key, connectionKey, store.language])
  const refreshHosts = hosts.filter(
    (id) => (!filter || filter === id) && store.isOnline(id) && !unsupportedRefresh.includes(id),
  )
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
          if (isMethodMissing(error)) setUnsupportedRefresh((all) => [...new Set([...all, id])])
          setErrors((all) => ({
            ...all,
            [id]:
              store.language === 'id'
                ? 'Pembaruan tidak tersedia. Data terakhir tetap ditampilkan.'
                : 'Refresh unavailable. Last-known readings remain visible.',
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
    <Sheet
      presentation="screen"
      open={open}
      onClose={onClose}
      title={store.language === 'id' ? 'Penggunaan paket' : 'Plan usage'}
    >
      {context}
      <Card style={{ marginHorizontal: space.m, marginTop: space.m }}>
        <Row>
          <View style={{ flex: 1, gap: space.xs }}>
            <T>{store.language === 'id' ? 'Detail akun' : 'Account details'}</T>
            <T size={font.caption} tone="muted">
              {store.language === 'id'
                ? 'Tampilkan ID akun dan waktu pembaruan.'
                : 'Show account IDs and update times.'}
            </T>
          </View>
          <Toggle
            accessibilityLabel={store.language === 'id' ? 'Detail akun' : 'Account details'}
            value={details}
            onValueChange={(value) => {
              setDetails(value)
              store.setDraft('usage-show-details', value ? 'yes' : '')
            }}
          />
        </Row>
      </Card>
      <T tone="muted" style={{ padding: space.m }}>
        {store.language === 'id' ? 'Dibagikan antar thread pada akun ini' : 'Shared across threads on this account'}
      </T>
      {!provider || provider === 'claude-code' ? (
        <Row onPress={busy || !refreshHosts.length ? undefined : () => void refresh()}>
          <T tone="muted">
            {store.language === 'id'
              ? busy
                ? 'Memperbarui…'
                : 'Perbarui penggunaan Claude'
              : busy
                ? 'Refreshing…'
                : 'Refresh Claude usage'}
          </T>
        </Row>
      ) : null}
      {hosts.length > 1 ? (
        <SheetGroup>
          <SheetOption
            icon={Network}
            title={store.language === 'id' ? 'Semua host' : 'All hosts'}
            selected={!filter}
            onPress={() => setFilter(null)}
          />
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
                {store.isOnline(id) ? '' : store.language === 'id' ? ' · Luring' : ' · Offline'}
              </SectionLabel>
              {errors[id] ? (
                <T tone="bad" style={{ padding: space.m }}>
                  {errors[id]}
                </T>
              ) : null}
              {!rows.length ? (
                <T tone="muted" style={{ padding: space.m }}>
                  {store.language === 'id' ? 'Tidak dilaporkan' : 'Not reported'}
                </T>
              ) : (
                groupUsageByProvider(rows).map((group) => (
                  <View key={`${id}:${group.provider}`}>
                    {provider ? null : (
                      <T tone="muted" size={font.caption} style={{ paddingHorizontal: space.m, paddingTop: space.s }}>
                        {providerNames[group.provider]} · {group.readings.length}{' '}
                        {store.language === 'id' ? 'jendela' : group.readings.length === 1 ? 'window' : 'windows'}
                        {group.attention
                          ? ` · ${group.attention} ${store.language === 'id' ? 'perlu perhatian' : 'need attention'}`
                          : ''}
                      </T>
                    )}
                    {Array.from(new Set(group.readings.map((reading) => reading.accountId ?? 'default'))).map(
                      (account, index) => {
                        const readings = group.readings.filter(
                          (reading) => (reading.accountId ?? 'default') === account,
                        )
                        const title =
                          account === 'default'
                            ? store.language === 'id'
                              ? 'Akun default'
                              : 'Default account'
                            : /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(account)
                              ? `${store.language === 'id' ? 'Akun' : 'Account'} ${index + 1}`
                              : account
                        return (
                          <Card key={account} style={{ margin: space.m }}>
                            <View style={{ padding: space.m, gap: space.xs }}>
                              <T weight="600">
                                {providerNames[group.provider]} · {title}
                              </T>
                              {details && title !== account ? (
                                <T size={font.caption} tone="muted" copyable={account}>
                                  {account}
                                </T>
                              ) : null}
                            </View>
                            {readings.map((reading) => (
                              <View key={`${reading.window}:${reading.scope ?? ''}`}>
                                <Divider />
                                <PlanUsageReading
                                  reading={reading}
                                  compact
                                  details={details}
                                  offline={!store.isOnline(id)}
                                />
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
          title={store.language === 'id' ? 'Pengaturan model & akses' : 'Models & access settings'}
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
  const label = store.language === 'id' ? 'Penggunaan paket' : 'Plan usage'
  const value = !summary
    ? store.language === 'id'
      ? 'Tidak dilaporkan'
      : 'Not reported'
    : `${hostIds.length > 1 ? `${store.computers.find((h) => h.id === summary.hostId)?.name ?? summary.hostId} · ` : ''}${providerNames[summary.reading.provider]} · ${percent === null ? (summary.reading.source === 'notice' ? (store.language === 'id' ? 'Batas dilaporkan' : 'Limit reported') : store.language === 'id' ? 'Tidak dilaporkan' : 'Not reported') : `${Math.round(percent)}% ${store.language === 'id' ? 'terpakai' : 'used'}`}${summary.lastKnown ? (store.language === 'id' ? ' · Terakhir dilaporkan' : ' · Last reported') : ''}`
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
        {actionOnly && percent !== null ? <UsageRing percent={percent} /> : <Gauge size={16} color={c.soft} />}
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
export function ThreadUsageChip({
  hostId,
  provider: selectedProvider,
  accountId: selectedAccountId,
  model: selectedModel,
  sessionId,
}: {
  hostId: string
  provider: AgentProvider
  accountId?: string
  model: string
  /** The thread whose next message is previewed; without one the chip describes the selection. */
  sessionId?: string | null
}) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const { width } = useWindowDimensions()
  // The host's own answer for where the next message runs. Older hosts lack it, so the selection stays shown.
  const [route, setRoute] = useState<NextMessageRoute | null>(null)
  const usageKey = JSON.stringify(store.usage[hostId] ?? [])
  useEffect(() => {
    if (!sessionId) return setRoute(null)
    let current = true
    store.invoke(hostId, 'agent.nextRoute', sessionId).then(
      (next) => current && setRoute(next.state === 'unknown' ? null : next),
      () => current && setRoute(null),
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, sessionId, selectedProvider, selectedModel, selectedAccountId, usageKey, store.isOnline(hostId)])
  const target = route?.state === 'switch' && !route.held ? route : null
  const provider = target?.provider ?? selectedProvider
  const model = target?.model ?? selectedModel
  const accountId = target ? target.accountId : selectedAccountId
  if (store.appPreferences[hostId]?.showUsageLimits === false) return null
  const reading = relevantUsage(store.usage[hostId] ?? [], { provider, accountId, model })
  const percent = reading ? usagePercent(reading) : null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${store.language === 'id' ? 'Penggunaan paket' : 'Plan usage'}, ${providerNames[provider]}, ${percent === null ? (store.language === 'id' ? 'tidak dilaporkan' : 'not reported') : `${Math.round(percent)}% ${store.language === 'id' ? 'terpakai' : 'used'}`}`}
        onPress={() => setOpen(true)}
        style={{ padding: space.s, minHeight: 34, justifyContent: 'center', flexShrink: 1 }}
      >
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {width >= 430 && percent !== null
            ? `${Math.round(percent)}% ${store.language === 'id' ? 'terpakai' : 'used'}`
            : store.language === 'id'
              ? 'Paket'
              : 'Usage'}
        </T>
      </Pressable>
      <PlanUsageSheet
        hosts={[hostId]}
        open={open}
        onClose={() => setOpen(false)}
        provider={provider}
        accountId={accountId}
      />
    </>
  )
}
