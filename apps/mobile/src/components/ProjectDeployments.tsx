import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, View } from 'react-native'
import { ExternalLink, RotateCcw } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import type { ProjectDeployment, UptimeStatus, UsageReport } from '@ramu/shared/types/deploy'
import { deploymentsView, rollbackConfirmation } from '../runtime/deployments'
import { useStore } from '../runtime/store'
import { VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { font, space, useTheme } from '../theme'
import { BrandIcon } from './Logos'
import { Button, Divider, SectionLabel, Sheet, T } from './ui'

const time = (at: number) => new Date(at).toLocaleString()
const open = (url: string) => void Linking.openURL(/^https?:\/\//i.test(url) ? url : `https://${url}`).catch(() => {})

interface Loaded {
  key: string
  status?: ProjectDeployment
  uptime?: UptimeStatus | null
  usage?: UsageReport[]
  error?: string
}

/**
 * A project's deployments on its host: the latest ones with their state and address, the live address watch and the
 * platform's usage, read through the host's deploy calls. Roll back asks first, naming the address that changes, as
 * the desktop's Deploy sheet does; linking, deploying and settings stay on a computer.
 */
export function ProjectDeployments({
  hostId,
  projectId,
  projectName,
  open: visible,
  onClose,
}: {
  hostId: string
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string, values?: Record<string, string>) => translate(store.language, key, values)
  const key = JSON.stringify([hostId, projectId])
  const active = useRef(key)
  active.current = key
  const runtime = useRef(store)
  runtime.current = store
  const [data, setData] = useState<Loaded>({ key })
  const [busy, setBusy] = useState(false)
  const online = store.isOnline(hostId)
  const viewOnly = store.computers?.find((host) => host.id === hostId)?.access === 'viewer'
  const writable = () =>
    active.current === key &&
    runtime.current.isOnline(hostId) &&
    runtime.current.computers?.find((host) => host.id === hostId)?.access !== 'viewer'

  const read = useCallback(async () => {
    const mine = key
    try {
      const [status, uptime, usage] = await Promise.all([
        runtime.current.invoke(hostId, 'deploy.project', projectId),
        // A host whose platform cannot report these still shows its deployments.
        runtime.current.invoke(hostId, 'deploy.uptime', projectId).catch(() => null),
        runtime.current.invoke(hostId, 'deploy.usage', projectId).catch(() => []),
      ])
      if (active.current === mine) setData({ key: mine, status, uptime, usage })
    } catch (reason) {
      if (active.current === mine)
        setData({ key: mine, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }, [key, hostId, projectId])

  useEffect(() => {
    setData({ key })
    if (visible && online && !viewOnly) void read()
  }, [key, visible, online, viewOnly, read])

  const loaded = data.key === key ? data : { key }
  const status = loaded.status
  const view = status ? deploymentsView(status, loaded.uptime ?? null, loaded.usage ?? [], t, time) : null

  const rollBack = (deploymentId: string) => {
    const target = status?.deployments.find((entry) => entry.id === deploymentId)
    if (!status || !target || !writable() || busy) return
    const { title, message } = rollbackConfirmation(status, target, t, time)
    Alert.alert(title, message, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Roll back'),
        style: 'destructive',
        onPress: () => {
          if (!writable()) return
          setBusy(true)
          void runtime.current
            .invoke(hostId, 'deploy.rollback', projectId, deploymentId)
            .then(
              () => read(),
              (reason: unknown) =>
                Alert.alert(t('Could not roll back'), reason instanceof Error ? reason.message : String(reason)),
            )
            .finally(() => setBusy(false))
        },
      },
    ])
  }

  return (
    <Sheet open={visible} onClose={onClose} title={t('Deployments')}>
      <View style={{ padding: space.m, gap: space.m }}>
        <T tone="muted">{`${store.computers?.find((host) => host.id === hostId)?.name ?? hostId} · ${projectName}`}</T>
        {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
        {!online ? <T tone="muted">{t('Reconnect to see this project’s deployments.')}</T> : null}
        {loaded.error ? <T tone="bad">{loaded.error}</T> : null}
        {online && !viewOnly && !status && !loaded.error ? <ActivityIndicator color={c.accent} /> : null}
        {status && !status.binding ? (
          <T tone="muted">{t('This project has no deploy target yet. Open Deploy… on the project on a computer.')}</T>
        ) : null}
        {status?.binding && view ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <BrandIcon brand={status.binding.platform} size={16} />
              <T style={{ flex: 1 }} weight="600">
                {view.target}
              </T>
            </View>
            {view.live ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <T style={{ flex: 1 }} numberOfLines={1}>
                  {t('Live at {0}', { 0: view.live })}
                </T>
                <Button
                  title={t('Open')}
                  accessibilityLabel={t('Open {0}', { 0: view.live })}
                  icon={ExternalLink}
                  kind="secondary"
                  onPress={() => open(view.live!)}
                />
              </View>
            ) : null}
            {view.error ? <T tone="bad">{view.error}</T> : null}
          </>
        ) : null}
      </View>
      {status?.binding && view ? (
        <>
          <SectionLabel>{t('Latest deployments')}</SectionLabel>
          <View style={{ paddingHorizontal: space.m, gap: space.s }}>
            {!view.rows.length && !view.error ? <T tone="muted">{t('No deployments yet.')}</T> : null}
            {view.rows.map((row, index) => (
              <View key={row.id} style={{ gap: space.xs }}>
                {index > 0 ? <Divider /> : null}
                <T weight="600" tone={row.failed ? 'bad' : undefined}>
                  {row.state}
                </T>
                <T size={font.caption} tone="muted">
                  {row.detail}
                </T>
                {row.message ? (
                  <T size={font.caption} numberOfLines={2}>
                    {row.message}
                  </T>
                ) : null}
                {row.url || row.rollBack ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                    {row.url ? (
                      <Button
                        title={t('Open')}
                        accessibilityLabel={t('Open {0}', { 0: row.url })}
                        icon={ExternalLink}
                        kind="ghost"
                        onPress={() => open(row.url!)}
                      />
                    ) : null}
                    {row.rollBack ? (
                      <Button
                        title={t('Roll back')}
                        accessibilityLabel={`${t('Roll back')}: ${row.detail}`}
                        icon={RotateCcw}
                        kind="secondary"
                        disabled={viewOnly || !online || busy}
                        onPress={() => rollBack(row.id)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
          {view.uptime.lines.length ? (
            <>
              <SectionLabel>{t('Uptime')}</SectionLabel>
              <View style={{ paddingHorizontal: space.m, gap: space.xs }} accessibilityLiveRegion="polite">
                {view.uptime.lines.map((line, index) => (
                  <T key={index} size={font.caption} tone={view.uptime.down && index > 0 ? 'bad' : 'muted'}>
                    {line}
                  </T>
                ))}
              </View>
            </>
          ) : null}
          {view.usage.length ? (
            <>
              <SectionLabel>{t('Usage this billing period')}</SectionLabel>
              <View style={{ paddingHorizontal: space.m, gap: space.m }}>
                {view.usage.map((report) => (
                  <View key={report.platform} style={{ gap: space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                      <BrandIcon brand={report.platform} size={16} />
                      <T style={{ flex: 1 }} weight="600">
                        {report.title}
                      </T>
                      <Button
                        title={t('Open billing')}
                        icon={ExternalLink}
                        kind="ghost"
                        onPress={() => open(report.billingPage)}
                      />
                    </View>
                    {report.lines.map((line) => (
                      <T key={line.text} size={font.caption} tone={line.warn ? 'bad' : 'muted'}>
                        {line.text}
                      </T>
                    ))}
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </Sheet>
  )
}
