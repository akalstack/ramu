import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react-native'
import type { ProjectActionSettings } from '@ramu/shared/types'
import { useStore } from '../runtime/store'
import { isMethodMissing } from '../runtime/goalVerify'
import { useT } from '../i18n'
import { font, space, useTheme } from '../theme'
import { Button, Sheet, T } from './ui'

/** Manage commands on their owning host. Opening this sheet never launches a terminal. */
export function ProjectCommandSettings({
  hostId,
  projectId,
  projectName,
  open,
  onClose,
}: {
  hostId: string
  projectId: string
  projectName?: string
  open: boolean
  onClose: () => void
}) {
  const store = useStore()
  const t = useT()
  const { c } = useTheme()
  const key = JSON.stringify([hostId, projectId])
  const active = useRef(key)
  active.current = key
  const lifecycle = useRef({ version: 0 }).current
  const runtime = useRef({ store, unsupported: t.actionSettingsUnsupported })
  runtime.current = { store, unsupported: t.actionSettingsUnsupported }
  const sequence = useRef(0)
  const pending = useRef<number | null>(null)
  const [data, setData] = useState<{
    key: string
    settings?: ProjectActionSettings
    error?: string
    unsupported?: boolean
  }>({ key })
  const [busy, setBusy] = useState(false)
  const online = store.isOnline(hostId)
  const settings = data.key === key ? data.settings : undefined
  const read = useCallback(
    async (version: number) => {
      if (version !== lifecycle.version || active.current !== key || !open || !runtime.current.store.isOnline(hostId))
        return
      const request = ++sequence.current
      try {
        const settings = await runtime.current.store.invoke(hostId, 'projects.actionSettings', projectId)
        if (version === lifecycle.version && active.current === key && request === sequence.current)
          setData({ key, settings })
      } catch (reason) {
        if (version === lifecycle.version && active.current === key && request === sequence.current)
          setData((previous) => ({
            ...(previous.key === key ? previous : { key }),
            key,
            error: isMethodMissing(reason)
              ? runtime.current.unsupported
              : reason instanceof Error
                ? reason.message
                : String(reason),
            unsupported: isMethodMissing(reason),
          }))
      }
    },
    [lifecycle, key, open, hostId, projectId],
  )
  useEffect(() => {
    const version = ++lifecycle.version
    pending.current = null
    setBusy(false)
    if (!open || !online) return
    void read(version)
    const off = runtime.current.store.subscribe(hostId, (channel) => {
      if (channel === 'workspace:changed') void read(version)
    })
    return () => {
      ++lifecycle.version
      off()
    }
  }, [lifecycle, hostId, open, online, read])
  const disabled = Boolean(busy || !online || !settings || data.unsupported)
  const mutate = async (operation: () => Promise<unknown>) => {
    if (disabled || pending.current !== null || active.current !== key || !store.isOnline(hostId)) return
    const version = lifecycle.version
    pending.current = version
    setBusy(true)
    try {
      await operation()
      if (version === lifecycle.version && active.current === key) await read(version)
    } catch (reason) {
      if (version === lifecycle.version && active.current === key)
        setData((previous) => ({ ...previous, error: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      if (version === lifecycle.version && active.current === key) {
        pending.current = null
        setBusy(false)
      }
    }
  }
  const hidden = new Set(settings?.hiddenIds)
  const visible = settings?.actions.filter((action) => !hidden.has(action.id)) ?? []
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= visible.length) return
    const actions = [...visible]
    actions.splice(to, 0, actions.splice(from, 1)[0]!)
    void mutate(() =>
      store.invoke(
        hostId,
        'projects.reorderActions',
        projectId,
        actions.map((action) => action.id),
      ),
    )
  }
  return (
    <Sheet open={open} onClose={onClose} title={t.manageProjectActions}>
      <View style={{ padding: space.m, gap: space.m }}>
        <T tone="muted">{`${store.computers?.find((host) => host.id === hostId)?.name ?? hostId} · ${projectName ?? projectId}`}</T>
        {!online ? <T tone="muted">{t.actionSettingsOffline}</T> : null}
        {data.key === key && data.error ? <T tone="bad">{data.error}</T> : null}
        {data.key === key && data.error && !data.unsupported ? (
          <Button
            title={t.retryProjectActions}
            kind="secondary"
            disabled={!online || busy}
            onPress={() => void read(lifecycle.version)}
          />
        ) : null}
        {online && !settings && !data.error ? <ActivityIndicator color={c.accent} /> : null}
        {settings && !settings.actions.length ? <T tone="muted">{t.noProjectActions}</T> : null}
        {settings?.actions.map((action) => {
          const isHidden = hidden.has(action.id)
          const index = visible.findIndex((item) => item.id === action.id)
          return (
            <View key={action.id} style={{ gap: space.s }}>
              <T weight="600">
                {action.name}
                {isHidden ? ` · ${t.hiddenAction}` : ''}
              </T>
              <T tone="muted" size={font.caption}>
                {action.command}
              </T>
              <T tone="muted" size={font.caption}>
                {action.source ?? t.localAction}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {!isHidden ? (
                  <>
                    <Button
                      title={t.moveActionUp}
                      accessibilityLabel={`${t.moveActionUp}: ${action.name}`}
                      icon={ArrowUp}
                      kind="ghost"
                      disabled={disabled || index === 0}
                      onPress={() => move(index, index - 1)}
                    />
                    <Button
                      title={t.moveActionDown}
                      accessibilityLabel={`${t.moveActionDown}: ${action.name}`}
                      icon={ArrowDown}
                      kind="ghost"
                      disabled={disabled || index === visible.length - 1}
                      onPress={() => move(index, index + 1)}
                    />
                  </>
                ) : null}
                <Button
                  title={isHidden ? t.showProjectAction : t.hideProjectAction}
                  accessibilityLabel={`${isHidden ? t.showProjectAction : t.hideProjectAction}: ${action.name}`}
                  icon={isHidden ? Eye : EyeOff}
                  kind="secondary"
                  disabled={disabled}
                  onPress={() =>
                    void mutate(() =>
                      store.invoke(hostId, 'projects.setActionVisibility', projectId, action.id, !isHidden),
                    )
                  }
                />
              </View>
            </View>
          )
        })}
        {settings?.hiddenIds.length ? (
          <T tone="muted" size={font.caption}>
            {t.hiddenActionsHint}
          </T>
        ) : null}
        {settings?.customOrder ? (
          <Button
            title={t.useRepositoryOrder}
            kind="secondary"
            disabled={disabled}
            onPress={() => void mutate(() => store.invoke(hostId, 'projects.resetActionOrder', projectId))}
          />
        ) : null}
      </View>
    </Sheet>
  )
}
