import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, View } from 'react-native'
import { ExternalLink } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { DEPLOY_TARGET_PLUGINS } from '@ramu/shared/plugins'
import { DEPLOY_TARGETS } from '@ramu/shared/stacks'
import type { DeployStatus, UptimeStatus } from '@ramu/shared/types/deploy'
import { deployCheckRows, uptimeLines } from '../runtime/projectDeploy'
import { useStore } from '../runtime/store'
import { VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { font, space, useTheme } from '../theme'
import { BrandIcon } from './Logos'
import { Button, Divider, SectionLabel, Sheet, T, Toggle } from './ui'

const time = (at: number) => new Date(at).toLocaleString()
const open = (url: string) => void Linking.openURL(url).catch(() => {})

interface Loaded {
  key: string
  status?: DeployStatus
  uptime?: UptimeStatus | null
  database?: { command: string | null; addressSaved: boolean } | null
  error?: string
}

/**
 * A project's Deploy view on its host, mirroring the desktop's Deploy sheet: the platform its stack names, the latest
 * deploy as the Git host reports it, and the live address watch, which can be turned on or off here. The plugin, the
 * live address and the production database address are set on a computer.
 */
export function ProjectDeploy({
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

  const read = useCallback(async () => {
    const mine = key
    try {
      const [status, uptime, database] = await Promise.all([
        runtime.current.invoke(hostId, 'deploy.status', projectId),
        runtime.current.invoke(hostId, 'deploy.uptime', projectId).catch(() => null),
        runtime.current.invoke(hostId, 'deploy.migrations', projectId).catch(() => null),
      ])
      if (active.current === mine) setData({ key: mine, status, uptime, database })
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
  const target = status?.recommended ?? null
  const uptime = uptimeLines(loaded.uptime ?? null, t, time)

  // Off forgets the watch's checks and closes an open incident, as on the desktop.
  const setUptime = (enabled: boolean) => {
    if (busy || active.current !== key || !runtime.current.isOnline(hostId) || viewOnly) return
    setBusy(true)
    void runtime.current
      .invoke(hostId, 'deploy.setUptime', projectId, enabled)
      .then(
        (next) => {
          if (active.current === key) setData((current) => ({ ...current, uptime: next }))
        },
        (reason: unknown) =>
          Alert.alert(t('That didn’t work'), reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false))
  }

  return (
    <Sheet open={visible} onClose={onClose} title={t('Deploy')}>
      <View style={{ padding: space.m, gap: space.m }}>
        <T tone="muted">{`${store.computers?.find((host) => host.id === hostId)?.name ?? hostId} · ${projectName}`}</T>
        {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
        {!online ? <T tone="muted">{t('Reconnect to see this project’s deployments.')}</T> : null}
        {loaded.error ? <T tone="bad">{loaded.error}</T> : null}
        {online && !viewOnly && !status && !loaded.error ? <ActivityIndicator color={c.accent} /> : null}
        {status ? (
          target ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <BrandIcon brand={target} size={16} />
              <T style={{ flex: 1 }}>
                {t('{0} suits this project’s stack, through the {1} plugin.', {
                  0: DEPLOY_TARGETS[target],
                  1: DEPLOY_TARGET_PLUGINS[target].name,
                })}
              </T>
            </View>
          ) : (
            <T tone="muted">
              {t(
                'Install the plugin for the platform you deploy to from Customize → Plugins, then ask the project’s agent to deploy.',
              )}
            </T>
          )
        ) : null}
      </View>
      {status ? (
        <>
          <SectionLabel>{t('Latest deploy')}</SectionLabel>
          <View style={{ paddingHorizontal: space.m, gap: space.s }}>
            {!status.repositories.length ? (
              <T size={font.caption} tone="muted">
                {t(
                  'Ramu reads each deploy from the checks the Git host lists on the default branch. Connect the platform to the repository, and its deploys show here.',
                )}
              </T>
            ) : null}
            {deployCheckRows(status, t).map((repository, index) => (
              <View key={repository.repoId} style={{ gap: space.xs }}>
                {index > 0 ? <Divider /> : null}
                <T size={font.caption} tone="muted">
                  {repository.title}
                </T>
                {!repository.checks.length ? (
                  <T size={font.caption} tone="muted">
                    {t('No checks on this commit yet.')}
                  </T>
                ) : null}
                {repository.checks.map((check) => (
                  <View key={check.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <View style={{ flex: 1 }}>
                      <T weight="600" numberOfLines={1}>
                        {check.name}
                      </T>
                      <T size={font.caption} tone={check.failed ? 'bad' : 'muted'}>
                        {check.state}
                      </T>
                    </View>
                    {check.url ? (
                      <Button
                        title={t('Open')}
                        accessibilityLabel={t('Open {0}', { 0: check.name })}
                        icon={ExternalLink}
                        kind="secondary"
                        onPress={() => open(check.url!)}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </View>
          <SectionLabel
            right={
              loaded.uptime ? (
                <Toggle
                  accessibilityLabel={t('Watch the live address')}
                  value={loaded.uptime.enabled}
                  disabled={busy || !online || viewOnly}
                  onValueChange={setUptime}
                />
              ) : null
            }
          >
            {t('Live address')}
          </SectionLabel>
          <View style={{ paddingHorizontal: space.m, gap: space.xs }} accessibilityLiveRegion="polite">
            {uptime.lines.map((line, index) => (
              <T key={index} size={font.caption} tone={uptime.down && index > 0 ? 'bad' : 'muted'}>
                {line}
              </T>
            ))}
          </View>
          {loaded.database ? (
            <>
              <SectionLabel>{t('Production database')}</SectionLabel>
              <View style={{ paddingHorizontal: space.m, gap: space.xs }}>
                <T size={font.caption} tone="muted">
                  {loaded.database.command
                    ? t('Before each production deploy, Ramu runs {0} against this database.', {
                        0: loaded.database.command,
                      })
                    : t(
                        'Add a migrate command to ramu.json, and Ramu runs it against this database before each production deploy.',
                      )}
                </T>
                <T size={font.caption} tone="muted">
                  {loaded.database.addressSaved
                    ? t('An address is saved on this computer.')
                    : t('No address is saved yet. Add it in the Deploy sheet on the host’s own computer.')}
                </T>
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </Sheet>
  )
}
