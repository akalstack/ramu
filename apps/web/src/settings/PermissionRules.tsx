import { useCallback, useEffect, useRef, useState } from 'react'
import type { PermissionRemoval, SavedPermissionRule } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList, usePaged } from './cards'

export function PermissionRules({ disabled }: { disabled: boolean }) {
  const invoke = useSettingsInvoke()
  const [rules, setRules] = useState<SavedPermissionRule[]>([])
  const [target, setTarget] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const load = useCallback(async () => {
    const current = ++revision.current
    try {
      const result = await invoke('settings.permissions.list')
      if (revision.current !== current) return
      setRules(result)
      setError(null)
    } catch (error) {
      if (revision.current === current) setError(errorText(error))
    }
  }, [invoke])
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  useEffect(() => {
    setRules([])
    void load()
    return invalidate
  }, [load, invalidate])
  const change = async (id?: string) => {
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
    ...new Map(rules.filter((rule) => rule.projectId).map((rule) => [rule.projectId!, rule.projectName!])).entries(),
  ]
  if (target.startsWith('project:') && !projects.some(([id]) => target === `project:${id}`))
    projects.push([target.slice(8), target.slice(8)])
  const shown = rules.filter(
    (rule) =>
      target === 'all' ||
      (target === 'user' && rule.scope === 'user') ||
      (target === 'projects' && rule.scope === 'project') ||
      target === `project:${rule.projectId}`,
  )
  const paged = usePaged(shown, 20)
  return (
    <div className="space-y-3">
      <SettingsGroupTitle>{t('Saved approvals')}</SettingsGroupTitle>
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
        <Button variant="secondary" disabled={disabled || busy || !shown.length} onClick={() => void change()}>
          {t('Remove displayed approvals')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          {t('Refresh')}
        </Button>
      </div>
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
              <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void change(rule.id)}>
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
