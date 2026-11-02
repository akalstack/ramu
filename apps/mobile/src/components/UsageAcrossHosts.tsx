import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { UsageReading } from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers/providers'
import {
  activityAcrossHosts,
  loginsAcrossHosts,
  peakOf,
  type ActivityRow,
  type ActivityTotal,
  type LoginUsage,
} from '@ramu/shared/usageAcrossHosts'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { T } from './ui'

/** All hosts at once: each login once with its newest reading, and this week's turns added across hosts. */
export function UsageAcrossHosts({ hosts, readings }: { hosts: string[]; readings: Record<string, UsageReading[]> }) {
  const say = useSay()
  const store = useStore()
  const [logins, setLogins] = useState<LoginUsage[]>([])
  const [week, setWeek] = useState<ActivityTotal | null>(null)
  const name = (id: string) => store.computers.find((pc) => pc.id === id)?.name ?? id
  const key = `${hosts.join(',')}|${hosts.map((id) => (readings[id] ?? []).length).join(',')}`
  useEffect(() => {
    let live = true
    void Promise.all(
      hosts.map(async (id) => {
        const online = store.isOnline(id)
        const [emails, rows] = await Promise.all([
          online
            ? (store.invoke(id, 'providers.accountEmails') as Promise<Record<string, Record<string, string>>>).catch(
                () => ({}),
              )
            : {},
          online ? (store.invoke(id, 'usage.activity', 7) as Promise<ActivityRow[]>).catch(() => null) : null,
        ])
        return { id, emails, rows }
      }),
    ).then((answers) => {
      if (!live) return
      setLogins(
        loginsAcrossHosts(
          answers.map(({ id, emails }) => ({ hostId: id, host: name(id), readings: readings[id] ?? [], emails })),
        ),
      )
      setWeek(activityAcrossHosts(answers.map(({ id, rows }) => ({ host: name(id), rows }))))
    })
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the hosts and how many readings each has
  if (hosts.length < 2 || (!logins.length && !week?.turns)) return null
  return (
    <View style={{ paddingHorizontal: space.m, paddingVertical: space.s, gap: space.xs }}>
      <T size={font.caption} tone="muted">
        {say('Across hosts')}
      </T>
      {logins.map((login) => {
        const peak = peakOf(login)
        return (
          <T key={`${login.provider}:${login.email ?? login.hosts.join(',')}`} size={font.caption} numberOfLines={1}>
            {[
              providerName(login.provider),
              login.email ?? say('Account on {0}', { 0: login.hosts.join(', ') }),
              peak ? `${Math.round(peak.usedPercent)}%` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </T>
        )
      })}
      {week?.turns ? (
        <T size={font.caption} tone="muted">
          {[
            `${say('This week')}: ${say('{0} turns', { 0: week.turns })}`,
            week.costUsd > 0 ? `$${week.costUsd.toFixed(2)}` : '',
            week.unpricedOn.length
              ? say('Some providers on {0} report no cost', { 0: week.unpricedOn.join(', ') })
              : '',
            week.missing.length ? say('Not counted: {0}', { 0: week.missing.join(', ') }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
      ) : null}
    </View>
  )
}
