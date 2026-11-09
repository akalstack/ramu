import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, View } from 'react-native'
import { ExternalLink, Rocket, RotateCcw, ScrollText } from 'lucide-react-native'
import { accountBrand } from '@ramu/shared/brands'
import { translate } from '@ramu/shared/i18n'
import type {
  DomainStatus,
  ProjectDeployment,
  ProjectResources,
  StoreRelease,
  StoreTarget,
  UptimeStatus,
  UsageReport,
} from '@ramu/shared/types/deploy'
import { deploymentsView, resourceRows, rollbackConfirmation, storeView } from '../runtime/deployments'
import { useStore } from '../runtime/store'
import { VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { font, space, useTheme } from '../theme'
import { BrandIcon } from './Logos'
import { Button, Divider, SectionLabel, Sheet, T, Toggle } from './ui'

const STORE_TARGET_LABEL: Record<StoreTarget, string> = { all: 'iOS and Android', ios: 'iOS', android: 'Android' }

const time = (at: number) => new Date(at).toLocaleString()
const open = (url: string) => void Linking.openURL(/^https?:\/\//i.test(url) ? url : `https://${url}`).catch(() => {})

interface Loaded {
  key: string
  status?: ProjectDeployment
  uptime?: UptimeStatus | null
  domains?: DomainStatus[]
  release?: StoreRelease | null
  resources?: ProjectResources | null
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
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null)
  const online = store.isOnline(hostId)
  const viewOnly = store.computers?.find((host) => host.id === hostId)?.access === 'viewer'
  const writable = () =>
    active.current === key &&
    runtime.current.isOnline(hostId) &&
    runtime.current.computers?.find((host) => host.id === hostId)?.access !== 'viewer'

  const read = useCallback(async () => {
    const mine = key
    try {
      const [status, uptime, usage, domains, release, resources] = await Promise.all([
        runtime.current.invoke(hostId, 'deploy.project', projectId),
        // A host whose platform cannot report these still shows its deployments.
        runtime.current.invoke(hostId, 'deploy.uptime', projectId).catch(() => null),
        runtime.current.invoke(hostId, 'deploy.usage', projectId).catch(() => []),
        runtime.current.invoke(hostId, 'deploy.domains', projectId).catch(() => []),
        runtime.current.invoke(hostId, 'deploy.release', projectId).catch(() => null),
        // A project's databases are read through its first repository, whose code says what it needs.
        runtime.current
          .invoke(hostId, 'repos.list', projectId)
          .then((repos) =>
            repos[0] ? runtime.current.invoke(hostId, 'deploy.resources', projectId, repos[0].id) : null,
          )
          .catch(() => null),
      ])
      if (active.current === mine) setData({ key: mine, status, uptime, usage, domains, release, resources })
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
  const view = status
    ? deploymentsView(status, loaded.uptime ?? null, loaded.usage ?? [], t, time, loaded.domains ?? [])
    : null

  // Off forgets the watch's checks and closes an open incident, as on the desktop.
  const setUptime = (enabled: boolean) => {
    if (!writable() || busy) return
    setBusy(true)
    void runtime.current
      .invoke(hostId, 'deploy.setUptime', projectId, enabled)
      .then(
        (uptime) => {
          if (active.current === key) setData((current) => ({ ...current, uptime }))
        },
        (reason: unknown) =>
          Alert.alert(t('That didn’t work'), reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false))
  }

  const stores = storeView(loaded.release ?? null, t, time)
  const databases = resourceRows(loaded.resources ?? null, t)
  // Release asks which stores (only those ready to release), then says what happens; the second press is the
  // approval, as on the desktop.
  const release = () => {
    if (!writable() || busy || !stores?.targets.length) return
    const start = (target: StoreTarget) =>
      Alert.alert(
        t('Release now'),
        t(
          'This builds the default branch on EAS and uploads it for testers. Nothing is submitted for review. The project’s latest thread hears how each build and upload went.',
        ),
        [
          { text: t('Cancel'), style: 'cancel' },
          {
            text: t('Release now'),
            onPress: () => {
              if (!writable()) return
              setBusy(true)
              void runtime.current
                .invoke(hostId, 'deploy.startRelease', projectId, target)
                .then(
                  () => read(),
                  (reason: unknown) =>
                    Alert.alert(t('That didn’t work'), reason instanceof Error ? reason.message : String(reason)),
                )
                .finally(() => setBusy(false))
            },
          },
        ],
      )
    if (stores.targets.length === 1) return start(stores.targets[0]!)
    // Android shows at most three buttons, so with all three stores Cancel is dropped there and a tap outside closes it.
    Alert.alert(
      t('Release'),
      t('Which stores?'),
      [
        ...stores.targets.map((target) => ({ text: t(STORE_TARGET_LABEL[target]), onPress: () => start(target) })),
        { text: t('Cancel'), style: 'cancel' as const },
      ],
      { cancelable: true },
    )
  }

  // The build's log, as the desktop's Logs shows it: why a deploy failed, readable away from the computer.
  const showLogs = (deploymentId: string) => {
    if (!runtime.current.isOnline(hostId) || busy) return
    setBusy(true)
    void runtime.current
      .invoke(hostId, 'deploy.logs', projectId, deploymentId)
      .then(
        (text) => {
          if (active.current === key) setLogs({ id: deploymentId, text: text || t('No log output.') })
        },
        (reason: unknown) =>
          Alert.alert(t('That didn’t work'), reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false))
  }
  // As on the desktop: the button says what it builds and where, and the second press is the approval.
  const deployProduction = () => {
    if (!status?.binding || !writable() || busy) return
    Alert.alert(
      t('Deploy to production'),
      t('This builds {0} and replaces what visitors see at {1}.', {
        0: status.binding.productionBranch,
        1: status.productionUrl ?? status.binding.siteName,
      }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Deploy now'),
          onPress: () => {
            if (!writable()) return
            setBusy(true)
            void runtime.current
              .invoke(hostId, 'deploy.production', projectId)
              .then(
                () => read(),
                (reason: unknown) =>
                  Alert.alert(t('That didn’t work'), reason instanceof Error ? reason.message : String(reason)),
              )
              .finally(() => setBusy(false))
          },
        },
      ],
    )
  }

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
        {/* An Expo app with no hosting link ships through the stores, as the desktop's sheet treats it. */}
        {status && !status.binding && !(status.recommended === 'expo' && stores) ? (
          <T tone="muted">{t('This project has no deploy target yet. Open Deploy… on the project on a computer.')}</T>
        ) : null}
        {status?.binding && view ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <BrandIcon brand={accountBrand(status.binding.platform)} size={16} />
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
            {status.capabilities.includes('deployProduction') ? (
              <Button
                title={t('Deploy to production')}
                icon={Rocket}
                kind="secondary"
                disabled={viewOnly || !online || busy}
                onPress={deployProduction}
              />
            ) : null}
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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  <Button
                    title={t('Logs')}
                    accessibilityLabel={`${t('Logs')}: ${row.detail}`}
                    icon={ScrollText}
                    kind="ghost"
                    disabled={!online || busy}
                    onPress={() => (logs?.id === row.id ? setLogs(null) : showLogs(row.id))}
                  />
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
                {logs?.id === row.id ? (
                  <ScrollView horizontal style={{ maxHeight: 320 }}>
                    <T
                      size={font.caption}
                      selectable
                      style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}
                    >
                      {logs.text}
                    </T>
                  </ScrollView>
                ) : null}
              </View>
            ))}
          </View>
          {view.domains.length ? (
            <>
              <SectionLabel>{t('Domains')}</SectionLabel>
              <View style={{ paddingHorizontal: space.m, gap: space.s }}>
                {view.domains.map((domain) => (
                  <View key={domain.name} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <View style={{ flex: 1 }}>
                      <T weight="600">{domain.name}</T>
                      <T size={font.caption} tone={domain.live ? 'muted' : 'warn'}>
                        {domain.state}
                      </T>
                    </View>
                    {domain.live ? (
                      <Button
                        title={t('Open')}
                        accessibilityLabel={t('Open {0}', { 0: domain.name })}
                        icon={ExternalLink}
                        kind="secondary"
                        onPress={() => open(domain.name)}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            </>
          ) : null}
          {view.uptime.lines.length ? (
            <>
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
                {t('Uptime')}
              </SectionLabel>
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
                      <BrandIcon brand={accountBrand(report.platform)} size={16} />
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
      {databases.length ? (
        <>
          <SectionLabel>{t('Databases')}</SectionLabel>
          <View style={{ paddingHorizontal: space.m, gap: space.s }}>
            {databases.map((database) => (
              <View key={database.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <View style={{ flex: 1 }}>
                  <T weight="600">{database.name}</T>
                  <T size={font.caption} tone="muted">
                    {database.detail}
                  </T>
                </View>
                <Button
                  title={t('Open')}
                  accessibilityLabel={t('Open {0}', { 0: database.name })}
                  icon={ExternalLink}
                  kind="secondary"
                  onPress={() => open(database.page)}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {stores ? (
        <>
          <SectionLabel
            right={
              <Button
                title={t('Release')}
                kind="secondary"
                disabled={busy || !online || viewOnly || !stores.targets.length}
                onPress={release}
              />
            }
          >
            {t('Store releases')}
          </SectionLabel>
          <View style={{ paddingHorizontal: space.m, gap: space.m }}>
            {stores.blocked ? (
              <T size={font.caption} tone="muted">
                {stores.blocked}
              </T>
            ) : null}
            {stores.builds.map((build) => (
              <View key={build.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T weight="600" tone={build.failed ? 'bad' : 'text'}>
                    {build.state}
                  </T>
                  <T size={font.caption} tone="muted">
                    {build.detail}
                  </T>
                  {build.message ? (
                    <T size={font.caption} numberOfLines={1}>
                      {build.message}
                    </T>
                  ) : null}
                  {build.error ? (
                    <T size={font.caption} tone="bad">
                      {build.error}
                    </T>
                  ) : null}
                  {build.upload ? (
                    <T size={font.caption} tone={build.upload.failed ? 'bad' : 'muted'}>
                      {build.upload.text}
                    </T>
                  ) : null}
                </View>
                <Button
                  title={t('Open')}
                  accessibilityLabel={t('Open {0}', { 0: build.detail })}
                  icon={ExternalLink}
                  kind="secondary"
                  onPress={() => open(build.page)}
                />
              </View>
            ))}
            {!stores.builds.length && !stores.blocked ? (
              <T size={font.caption} tone="muted">
                {t('No store builds yet.')}
              </T>
            ) : null}
          </View>
        </>
      ) : null}
    </Sheet>
  )
}
