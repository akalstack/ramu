import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { PermissionRemoval, SavedPermissionRule } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { SettingsScopeContext, useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList } from './cards'
import { ListCount, ListToolbar, useListView } from './ListView'

export function PermissionRules({ disabled }: { disabled: boolean }) {
  const invoke = useSettingsInvoke()
  const scope = useContext(SettingsScopeContext)
  const host = scope?.primaryId ?? ''
  const viewOnly = scope?.targets?.some((target) => target.viewOnly) ?? false
  const access = useRef({ host, viewOnly, disabled })
  access.current = { host, viewOnly, disabled }
  const [loadedHost, setLoadedHost] = useState(host)
  const currentHost = loadedHost === host
  const [rules, setRules] = useState<SavedPermissionRule[]>([])
  const [target, setTarget] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const load = useCallback(async () => {
    if (viewOnly || access.current.host !== host || access.current.viewOnly) return
    const current = ++revision.current
    try {
      const result = await invoke('settings.permissions.list')
      if (revision.current !== current || access.current.host !== host || access.current.viewOnly) return
      setRules(result)
      setLoadedHost(host)
      setError(null)
    } catch (error) {
      if (revision.current === current) setError(errorText(error))
    }
  }, [invoke, host, viewOnly])
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  useEffect(() => {
    if (viewOnly) return invalidate
    setRules([])
    setTarget('all')
    void load()
    return invalidate
  }, [load, invalidate, viewOnly])
  const change = async (id?: string) => {
    if (!currentHost || access.current.host !== host || access.current.viewOnly || access.current.disabled) return
    setBusy(true)
    setError(null)
    try {
      if (id) await invoke('settings.permissions.remove', id)
      else {
        const removal: PermissionRemoval = target.startsWith('project:')
          ? { scope: 'project', projectId: target.slice(8) }
          : { scope: target as 'all' | 'user' | 'projects' }
        await invoke('settings.permissions.clear', removal)
      }
      await load()
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const projects = [
    ...new Map(
      (currentHost ? rules : []).filter((rule) => rule.projectId).map((rule) => [rule.projectId!, rule.projectName!]),
    ).entries(),
  ]
  if (target.startsWith('project:') && !projects.some(([id]) => target === `project:${id}`))
    projects.push([target.slice(8), target.slice(8)])
  const shown = (currentHost ? rules : []).filter(
    (rule) =>
      target === 'all' ||
      (target === 'user' && rule.scope === 'user') ||
      (target === 'projects' && rule.scope === 'project') ||
      target === `project:${rule.projectId}`,
  )
  const view = useListView(shown, {
    text: (rule) => `${rule.label} ${rule.provider} ${rule.projectName ?? ''}`,
    filterKey: target,
  })
  const paged = view.paged
  return (
    <div className="space-y-3">
      <SettingsGroupTitle>{t('Saved approvals')}</SettingsGroupTitle>
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'Rules apply to the selected provider on this host. User rules cover all projects; project rules cover one project.',
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          label={t('Approval scope')}
          value={target}
          onChange={setTarget}
          options={[
            { value: 'all', label: t('All approvals') },
            { value: 'user', label: t('User approvals') },
            { value: 'projects', label: t('All project approvals') },
            ...projects.map(([id, name]) => ({ value: `project:${id}`, label: `${t('Project')}: ${name}` })),
          ]}
        />
        <Button
          variant="secondary"
          disabled={viewOnly || disabled || busy || !shown.length || view.query !== ''}
          title={view.query ? t('Clear the search to remove a whole scope.') : undefined}
          onClick={() => void change()}
        >
          {t('Remove displayed approvals')}
        </Button>
        <Button variant="ghost" disabled={viewOnly || busy} onClick={() => void load()}>
          {t('Refresh')}
        </Button>
      </div>
      <ListToolbar view={view} label={t('Search approvals')} />
      <ListCount view={view} />
      {!shown.length && (
        <p className="m-0 text-caption text-muted-foreground">{t('No saved approvals in this scope.')}</p>
      )}
      <SettingsCardList>
        {paged.shown.map((rule) => (
          <SettingsCard
            key={rule.id}
            title={<code className="truncate text-caption">{rule.label}</code>}
            meta={`${rule.provider} · ${
              rule.scope === 'user' ? t('User — all projects') : `${t('Project')}: ${rule.projectName}`
            }`}
            actions={
              <Button
                variant="ghost"
                size="sm"
                disabled={viewOnly || disabled || busy}
                onClick={() => void change(rule.id)}
              >
                {t('Remove')}
              </Button>
            }
          />
        ))}
        {paged.more}
      </SettingsCardList>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
