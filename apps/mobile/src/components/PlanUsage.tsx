import { UsageAcrossHosts } from './UsageAcrossHosts'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ProviderIcon } from './Logos'
import { Pressable, View } from 'react-native'
import { Gauge, Monitor, Network, Settings } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { useRouter } from 'expo-router'
import type { AgentProvider, UsageReading } from '@ramu/shared/types'
import { planName, providerEnabled } from '@ramu/shared/providers/providers'
import {
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
  const id = language === 'id'
  const color = percent === null ? c.muted : tone === 'bad' ? c.bad : tone === 'warn' ? c.warn : c.primary
  // How long until it resets reads at a glance; the exact time stays for when it is far off.
  const until = r.resetsAt ? r.resetsAt - now : null
  const reset =
    until === null
      ? id
        ? 'Waktu reset tidak dilaporkan'
        : 'No reset time reported'
      : until <= 0
        ? id
          ? 'Menunggu reset dilaporkan'
          : 'Awaiting the reset'
        : until < 24 * 60 * 60_000
          ? `${id ? 'Reset dalam' : 'Resets in'} ${duration(until)}`
          : `${id ? 'Reset' : 'Resets'} ${new Date(r.resetsAt!).toLocaleString(id ? 'id-ID' : 'en-US', {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}`
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      {!compact ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ProviderIcon provider={r.provider} size={16} />
          <T weight="600" style={{ flexShrink: 1 }}>
            {providerNames[r.provider]} · {r.accountId ?? 'default'}
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
      {scopeHint ? (
        <T tone="muted" size={font.caption}>
          {scopeHint}
        </T>
      ) : null}
      <T tone="muted" size={font.caption}>
        {[
          reset,
          r.plan ? planName(r.plan) : null,
          details
            ? `${lastKnown ? (id ? 'terakhir dilaporkan' : 'last reported') : id ? 'diperbarui' : 'updated'} ${relative(r.updatedAt, id)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </T>
    </View>
  )
}

/** "2 h 15 min", "45 min": how long until a limit resets. */
function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`
}

function relative(at: number, id: boolean): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return id ? 'baru saja' : 'just now'
  if (minutes < 60) return id ? `${minutes} menit lalu` : `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return id ? `${hours} jam lalu` : `${hours} h ago`
  return new Date(at).toLocaleDateString(id ? 'id-ID' : 'en-US')
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
    setFilter(null)
    if (!open) return
    const read = (id: string) => {
      void readAccounts(id, request).catch(() => {
        if (request !== generation.current) return
        setErrors((all) => ({
          ...all,
          [id]:
            store.language === 'id'
              ? 'Tidak dapat memuat akun. Data terakhir tetap ditampilkan.'
              : 'Could not load accounts. Last-known readings remain visible.',
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
                          {providerNames[group.provider]} · {group.readings.length}{' '}
                          {store.language === 'id' ? 'jendela' : group.readings.length === 1 ? 'window' : 'windows'}
                          {group.attention
                            ? ` · ${group.attention} ${store.language === 'id' ? 'perlu perhatian' : 'need attention'}`
                            : ''}
                        </T>
                      </View>
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
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                                <ProviderIcon provider={group.provider} size={18} />
                                <T weight="600" style={{ flexShrink: 1 }}>
                                  {providerNames[group.provider]} · {title}
                                </T>
                              </View>
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
