import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import type { InstalledPlugin } from '@ramu/shared/plugins'
import { useStore } from '../runtime/store'
import { space, useTheme } from '../theme'
import { RowLabel } from './SettingRows'
import { Card, Divider, Row, SectionLabel, T } from './ui'

/**
 * A host's installed plugins and what each still needs, read-only: installing, pasting a credential and removing stay
 * on the host, which keeps the credentials. An agent's install card still reaches the phone like any approval.
 */
export function PluginSettings({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const online = store.isOnline(hostId)
  const [plugins, setPlugins] = useState<InstalledPlugin[] | null>(null)
  const [error, setError] = useState('')
  const runtime = useRef(store)
  runtime.current = store
  useEffect(() => {
    if (!online) return
    let active = true
    const read = () =>
      void runtime.current.invoke(hostId, 'plugins.list').then(
        (next) => active && setPlugins(next),
        (reason: unknown) => active && setError(reason instanceof Error ? reason.message : String(reason)),
      )
    read()
    const unsubscribe = runtime.current.subscribe(hostId, (...[channel]) => {
      if (channel === 'plugins:changed') read()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [hostId, online])
  return (
    <View>
      <SectionLabel>{t('Installed plugins')}</SectionLabel>
      {error ? (
        <T tone="bad" style={{ paddingHorizontal: space.l }}>
          {error}
        </T>
      ) : null}
      <Card style={{ marginHorizontal: space.l }}>
        {plugins === null && online ? <ActivityIndicator color={c.accent} style={{ padding: space.m }} /> : null}
        {plugins && !plugins.length ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel title={t('No plugins yet')} help={t('Install one in Settings → Plugins on the host.')} />
          </Row>
        ) : null}
        {plugins?.map((plugin, index) => {
          const missing = plugin.credentials.filter((slot) => slot.state !== 'saved')
          return (
            <View key={plugin.id}>
              {index ? <Divider inset={space.l} /> : null}
              <Row style={{ paddingVertical: space.m }}>
                <RowLabel
                  title={plugin.name}
                  description={plugin.contents.description ?? ''}
                  help={[
                    !plugin.enabled ? t('Off') : null,
                    plugin.byRamu ? t('By Ramu') : null,
                    plugin.source.kind === 'development' ? t('Development') : null,
                    missing.length ? t('Needs {what}', { what: missing.map((slot) => slot.label).join(', ') }) : null,
                    plugin.update ? t('Update available') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </Row>
            </View>
          )
        })}
      </Card>
      <T size={13} tone="muted" style={{ paddingHorizontal: space.l }}>
        {t('Plugins are installed and their credentials pasted on the host, which keeps them.')}
      </T>
    </View>
  )
}
