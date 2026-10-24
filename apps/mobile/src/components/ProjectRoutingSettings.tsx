import { useEffect, useRef, useState } from 'react'
import { TextInput, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import type { MobileProject } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, Sheet, T } from './ui'

/** Host-owned routing metadata, edited without creating a thread or changing a draft destination. */
export function ProjectRoutingSettings({ project, onClose }: { project: MobileProject; onClose: () => void }) {
  const store = useStore()
  const scope = `${project.computerId}:${project.id}`
  const latest = useRef({ store, scope })
  latest.current = { store, scope }
  const { c } = useTheme()
  const t = (key: string) => translate(store.language, key)
  const [aliases, setAliases] = useState((project.aliases ?? []).join(', '))
  const [description, setDescription] = useState(project.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const list = aliases
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const invalid = list.length > 8 || list.some((value) => value.length > 80) || description.length > 280
  const online = store.isOnline(project.computerId)
  const owner = store.computers.find((computer) => computer.id === project.computerId)?.access !== 'viewer'
  const save = async () => {
    const current = latest.current
    if (
      current.scope !== scope ||
      pending.current ||
      invalid ||
      !current.store.isOnline(project.computerId) ||
      current.store.computers.find((host) => host.id === project.computerId)?.access === 'viewer'
    )
      return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const raw = project.id.slice(project.id.indexOf(':') + 1)
      await store.invoke(project.computerId, 'projects.setRouting', raw, list, description.trim())
      await store.refresh(project.computerId)
      if (live.current) onClose()
    } catch (reason) {
      if (live.current) {
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(/unknown method/i.test(message) ? t('Update this host to name projects for Auto.') : message)
      }
    } finally {
      pending.current = false
      if (live.current) setBusy(false)
    }
  }
  const inputStyle = {
    color: c.text,
    fontSize: font.body,
    padding: space.m,
    borderRadius: radius.m,
    backgroundColor: c.raised2,
  }
  return (
    <Sheet
      open
      title={t('Names for Auto…')}
      onClose={() => {
        if (!pending.current) onClose()
      }}
    >
      <View style={{ padding: space.l, gap: space.m }}>
        <T weight="600">{project.name}</T>
        <T tone="muted">
          {t('Auto matches these names in your first message. The description is shared with the model that chooses.')}
        </T>
        <TextInput
          autoFocus
          value={aliases}
          onChangeText={setAliases}
          editable={!busy && owner}
          accessibilityLabel={t('Other names, separated by commas')}
          placeholder={t('Other names, separated by commas')}
          placeholderTextColor={c.placeholder}
          style={inputStyle}
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          editable={!busy && owner}
          multiline
          maxLength={280}
          accessibilityLabel={t('What this project is')}
          placeholder={t('What this project is')}
          placeholderTextColor={c.placeholder}
          style={inputStyle}
        />
        {error ? <T tone="bad">{error}</T> : null}
        {!online ? <T tone="muted">{t('Reconnect to use these controls.')}</T> : null}
        {!owner ? (
          <T tone="muted">
            {t('This device is view-only, so it cannot change this. Ask the host owner to pair it with full access.')}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
          <Button kind="ghost" title={t('Cancel')} disabled={busy} onPress={onClose} />
          <Button title={t('Save')} disabled={busy || invalid || !online || !owner} onPress={() => void save()} />
        </View>
      </View>
    </Sheet>
  )
}
