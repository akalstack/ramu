import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { RULE_BODY_LIMIT, RULE_NAME_LIMIT, type AgentProvider, type Rule, type RuleRevision } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dialog, Dropdown, timeAgo } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { SettingsCard, SettingsCardList } from './cards'
import { ruleReach } from './rulesView'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { useContext } from 'react'

const CAPTION = 'm-0 text-caption text-muted-foreground'
const ALL = ''

function RuleEditor({
  rule,
  projects,
  onClose,
  onSaved,
}: {
  rule: Rule | null
  projects: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  useLanguage()
  const invoke = useSettingsInvoke()
  const [name, setName] = useState(rule?.name ?? '')
  const [body, setBody] = useState(rule?.body ?? '')
  const [projectId, setProjectId] = useState(rule?.projectId ?? ALL)
  const [provider, setProvider] = useState<string>(rule?.providers.length === 1 ? rule.providers[0]! : ALL)
  const [activation, setActivation] = useState<'always' | 'manual'>(rule?.activation ?? 'always')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const history = useQuery({
    queryKey: ['rule-history', rule?.id, rule?.revision],
    queryFn: () => invoke('rules.history', rule!.id),
    enabled: !!rule,
  })
  const invalid = !name.trim() || name.length > RULE_NAME_LIMIT || !body.trim() || body.length > RULE_BODY_LIMIT
  const save = async () => {
    if (invalid || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await invoke('rules.save', {
        ...(rule ? { id: rule.id, baseRevision: rule.revision } : {}),
        name,
        body,
        projectId: projectId || null,
        providers: provider ? [provider as AgentProvider] : [],
        activation,
        enabled,
      })
      onSaved()
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const restore = async (revision: RuleRevision) => {
    if (!rule || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await invoke('rules.restore', rule.id, revision.revision)
      onSaved()
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={rule ? t('Edit rule') : t('New rule')}
      confirmLabel={t('Save')}
      confirmDisabled={invalid}
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={() => {
        if (!pending.current) onClose()
      }}
    >
      <p>
        {t('Rules are instructions for how agents work. They never grant permissions; use Permissions for access.')}
      </p>
      <Input
        autoFocus
        aria-label={t('Rule name')}
        placeholder={t('Rule name')}
        value={name}
        maxLength={RULE_NAME_LIMIT}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        aria-label={t('Rule text')}
        placeholder={t('What should agents do?')}
        value={body}
        rows={8}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
      />
      <p className={CAPTION}>{`${body.length} / ${RULE_BODY_LIMIT}`}</p>
      <Dropdown
        label={t('Applies to')}
        value={projectId}
        options={[{ value: ALL, label: t('Every project') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        onChange={setProjectId}
      />
      <Dropdown
        label={t('Provider')}
        value={provider}
        options={[
          { value: ALL, label: t('Every provider') },
          ...AGENT_PROVIDERS.map((p) => ({ value: p, label: providerName(p) })),
        ]}
        onChange={setProvider}
      />
      <Dropdown
        label={t('When')}
        value={activation}
        options={[
          { value: 'always', label: t('Always, at the start of a thread') },
          { value: 'manual', label: t('Manual: kept here, not sent on its own') },
        ]}
        onChange={(value) => setActivation(value === 'manual' ? 'manual' : 'always')}
      />
      <label className="flex items-center gap-2 text-control">
        <Switch aria-label={t('Rule enabled')} checked={enabled} disabled={busy} onCheckedChange={setEnabled} />
        {t('Enabled')}
      </label>
      {rule && (history.data?.length ?? 0) > 1 && (
        <details className={CAPTION}>
          <summary className="cursor-pointer select-none">{t('History')}</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {history.data!.map((entry) => (
              <li key={entry.revision} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {t('Revision {0}', { '0': String(entry.revision) })} · {timeAgo(entry.at)}
                </span>
                {entry.revision !== rule.revision && (
                  <Button variant="ghost" size="xs" disabled={busy} onClick={() => void restore(entry)}>
                    {t('Restore')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Dialog>
  )
}

/** Settings → Agent setup → Rules: shared user instructions with revisions. */
export function RulesSettings() {
  useLanguage()
  const invoke = useSettingsInvoke(),
    on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const hostKey = scope?.primaryId ?? ''
  const ready = !scope || (scope.ready && !scope.stale)
  const rules = useQuery({ queryKey: ['rules', hostKey], queryFn: () => invoke('rules.list'), enabled: ready })
  const projects = useQuery({
    queryKey: ['rule-projects', hostKey],
    queryFn: () => invoke('projects.list'),
    enabled: ready,
  })
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refetch = rules.refetch
  useEffect(() => on('rules:changed', () => void refetch()), [on, refetch])
  useEffect(() => setEditing(null), [hostKey])
  const projectName = useCallback(
    (id: string | null) =>
      id ? (projects.data?.find((p) => p.id === id)?.name ?? t('Unavailable project')) : t('Every project'),
    [projects.data],
  )
  const act = async (work: () => Promise<unknown>) => {
    setError(null)
    try {
      await work()
      await refetch()
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  return (
    <>
      <SettingsGroupTitle className="mt-8">{t('Rules')}</SettingsGroupTitle>
      <p className={`${CAPTION} mb-4`}>
        {t('Instructions for how agents work, sent at the start of a thread. They never grant permissions.')}
      </p>
      {(error || rules.error) && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error ?? errorText(rules.error)}</AlertDescription>
        </Alert>
      )}
      <SettingsCardList>
        {(rules.data ?? []).map((rule) => (
          <SettingsCard
            key={rule.id}
            title={rule.name}
            meta={[
              projectName(rule.projectId),
              ruleReach(rule),
              rule.activation === 'manual' ? t('Manual') : t('Always'),
              rule.enabled ? null : t('Off'),
            ]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <>
                <Switch
                  aria-label={t('{0} enabled', { '0': rule.name })}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) =>
                    void act(() =>
                      invoke('rules.save', {
                        id: rule.id,
                        baseRevision: rule.revision,
                        name: rule.name,
                        body: rule.body,
                        projectId: rule.projectId,
                        providers: rule.providers,
                        activation: rule.activation,
                        enabled,
                      }),
                    )
                  }
                />
                <Button variant="ghost" size="xs" onClick={() => setEditing(rule)}>
                  {t('Edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    if (confirm(t('Delete “{name}”?', { name: rule.name })))
                      void act(() => invoke('rules.remove', rule.id))
                  }}
                >
                  {t('Delete')}
                </Button>
              </>
            }
          />
        ))}
      </SettingsCardList>
      {rules.data?.length === 0 && <p className={CAPTION}>{t('No rules yet.')}</p>}
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
          {t('New rule')}
        </Button>
      </div>
      {editing && (
        <RuleEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`}
          rule={editing === 'new' ? null : editing}
          projects={projects.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => void refetch()}
        />
      )}
    </>
  )
}
