import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { font, space } from '../theme'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { Row, SectionLabel, T } from './ui'

/** Runs pages do on their own, under Schedules as on the desktop; a row opens its page. */
export function PageScheduleRows({ hosts }: { hosts: readonly string[] }) {
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  const [pages, setPages] = useState<{ host: string; page: ArtifactInfo }[]>([])
  const key = hosts.join(',')
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      key
        .split(',')
        .filter(Boolean)
        .map((host) =>
          store.invoke(host, 'artifacts.list').then(
            (list) => list.map((page) => ({ host, page })),
            () => [],
          ),
        ),
    ).then((all) => !cancelled && setPages(all.flat()))
    return () => {
      cancelled = true
    }
  }, [key, store])
  const rows = pages.flatMap(({ host, page }) =>
    (page.capabilities.schedules ?? []).map((schedule, index) => ({ host, page, schedule, index })),
  )
  if (!rows.length) return null
  return (
    <View>
      <SectionLabel>{say('Page runs')}</SectionLabel>
      {rows.map(({ host, page, schedule, index }) => (
        <Row
          key={`${host}:${page.id}:${index}`}
          onPress={() =>
            router.push({ pathname: '/artifact/[computer]/[id]', params: { computer: host, id: page.id } })
          }
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}
        >
          <T size={20}>{page.icon}</T>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T numberOfLines={1}>{page.capabilities.runs?.[schedule.run]?.label ?? schedule.run}</T>
            <T size={font.caption} tone="muted" numberOfLines={1}>
              {page.title} ·{' '}
              {schedule.every === 'hourly'
                ? say('Every hour')
                : schedule.every === 'daily'
                  ? say('Every day at {time}', { time: schedule.at ?? '08:00' })
                  : say('Every Monday at {time}', { time: schedule.at ?? '08:00' })}
              {page.grants.schedules && page.grants.ai ? '' : ` · ${say('Not allowed')}`}
            </T>
          </View>
        </Row>
      ))}
    </View>
  )
}
