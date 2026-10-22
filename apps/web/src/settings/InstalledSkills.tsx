import { useCallback, useEffect, useState } from 'react'
import type { ManagedSkill, SkillInstallPreview, Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dialog, Dropdown } from '../Menu'
import { useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList, usePaged } from './cards'
import { useWorkspace } from '../workspace/workspace'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { t } from '../i18n'
import { errorText } from '../lib/errors'

export function InstalledSkills() {
  const invoke = useSettingsInvoke(),
    ws = useWorkspace()
  const [projects, setProjects] = useState<Project[]>(ws.projects)
  const [skills, setSkills] = useState<ManagedSkill[]>([]),
    [available, setAvailable] = useState(true)
  const [source, setSource] = useState(''),
    [name, setName] = useState(''),
    [projectId, setProjectId] = useState('')
  const [preview, setPreview] = useState<SkillInstallPreview | null>(null),
    [scripts, setScripts] = useState(false)
  const [removing, setRemoving] = useState<ManagedSkill | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const paged = usePaged(skills, 10)
  const load = useCallback(async () => {
    const snapshot = await invoke('learning.get')
    setSkills(snapshot.skills.filter((skill) => skill.installation))
    setProjects(await invoke('projects.list'))
  }, [invoke])
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)))
    void invoke('skills.availability')
      .then((v) => setAvailable(v.available))
      .catch(() => {})
  }, [load, invoke])
  const act = async (work: () => Promise<unknown>) => {
    setError('')
    setBusy(true)
    try {
      await work()
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const stage = (value: SkillInstallPreview) => {
    setScripts(false)
    setPreview(value)
  }
  return (
    <div className="flex flex-col gap-3 mt-6">
      <SettingsGroupTitle>{t('Installed skills')}</SettingsGroupTitle>
      {!available && (
        <p role="status">
          {t('Install Node.js to install skills.')}{' '}
          <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">
            {t('Install instructions')}
          </a>
        </p>
      )}
      <Input
        aria-label={t('Skill source')}
        placeholder={t('Repository, URL or local path')}
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <Input
        aria-label={t('Skill name (optional)')}
        placeholder={t('Skill name (optional)')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Dropdown
        label={t('Skill scope')}
        value={projectId}
        options={[
          { value: '', label: t('All projects') },
          ...projects.map((project) => ({ value: project.id, label: project.name })),
        ]}
        onChange={setProjectId}
      />
      <Button
        variant="outline"
        disabled={!source.trim() || busy || !available}
        onClick={() =>
          void act(async () =>
            stage(
              await invoke('skills.stage', {
                source: source.trim(),
                skill: name.trim() || undefined,
                projectId: projectId || null,
              }),
            ),
          )
        }
      >
        {busy ? t('Preparing…') : t('Preview skill')}
      </Button>
      {error && (
        <p role="alert" className="text-bad">
          {error}
        </p>
      )}
      <SettingsCardList>
        {paged.shown.map((skill) => (
          <SettingsCard
            key={skill.id}
            title={skill.name}
            badges={
              <>
                <Badge variant="secondary">{t('Installed')}</Badge>
                <Badge variant="outline">
                  {skill.projectId ? projects.find((p) => p.id === skill.projectId)?.name : t('All projects')}
                </Badge>
              </>
            }
            meta={skill.description}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !available}
                  onClick={() => void act(async () => stage(await invoke('skills.updateSource', skill.id)))}
                >
                  {t('Update')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      invoke('learning.control', skill.id, skill.status === 'active' ? 'disable' : 'restore'),
                    )
                  }
                >
                  {skill.status === 'active' ? t('Disable') : t('Enable')}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(skill)}>
                  {t('Remove')}
                </Button>
              </>
            }
          >
            <p className="m-0 truncate text-caption text-muted-foreground">
              {skill.installation!.source} · {t(skill.status)}
            </p>
            <fieldset className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-0 p-0">
              <legend className="sr-only">{t('Providers for {name}', { name: skill.name })}</legend>
              <span className="text-caption text-muted-foreground">{t('Providers')}</span>
              {AGENT_PROVIDERS.map((provider) => {
                const on = !skill.providers?.length || skill.providers.includes(provider)
                const chosen = skill.providers?.length ? skill.providers : [...AGENT_PROVIDERS]
                return (
                  <label key={provider} className="flex items-center gap-1.5 text-caption">
                    <Checkbox
                      checked={on}
                      disabled={busy || (on && chosen.length === 1)}
                      onCheckedChange={(checked) =>
                        void act(() =>
                          invoke(
                            'skills.setProviders',
                            skill.id,
                            checked ? [...chosen, provider] : chosen.filter((entry) => entry !== provider),
                          ),
                        )
                      }
                    />
                    {providerName(provider)}
                  </label>
                )
              })}
            </fieldset>
            <Dropdown
              label={`${t('Move skill')}: ${skill.name}`}
              value={skill.projectId ?? ''}
              options={[
                { value: '', label: t('All projects') },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(id) => void act(() => invoke('skills.move', skill.id, id || null))}
              disabled={busy}
            />
          </SettingsCard>
        ))}
        {paged.more}
      </SettingsCardList>
      {preview && (
        <Dialog
          title={t('Review skill installation')}
          confirmLabel={t('Install skill')}
          busy={busy}
          error={error}
          onCancel={() => {
            void invoke('skills.cancel', preview.id)
            setPreview(null)
          }}
          onConfirm={() =>
            void act(async () => {
              await invoke('skills.confirm', preview.id, scripts)
              setPreview(null)
            })
          }
        >
          <strong>{preview.name}</strong>
          <p>{preview.description}</p>
          <p className="break-all">
            {preview.source} ·{' '}
            {preview.projectId ? projects.find((p) => p.id === preview.projectId)?.name : t('All projects')}
          </p>
          <p>{t('Review the files before installing. Scripts are skipped unless you approve them separately.')}</p>
          <ul>
            {preview.files.map((file) => (
              <li key={file.path}>
                {file.path} · {file.bytes} B {file.script && <Badge variant="outline">{t('Script')}</Badge>}
              </li>
            ))}
          </ul>
          {preview.updatingId && (
            <pre className="whitespace-pre-wrap text-caption">{JSON.stringify(preview.changes, null, 2)}</pre>
          )}
          <details>
            <summary>{t('Skill instructions')}</summary>
            <pre className="whitespace-pre-wrap max-h-60 overflow-auto text-caption">{preview.markdown}</pre>
          </details>
          {preview.files.some((file) => file.script) && (
            <label className="flex items-center gap-2">
              <Checkbox checked={scripts} onCheckedChange={(value) => setScripts(value === true)} />
              {t('Also copy the listed scripts. Ramu will not run them.')}
            </label>
          )}
        </Dialog>
      )}
      {removing && (
        <Dialog
          title={t('Remove installed skill?')}
          confirmLabel={t('Remove')}
          busy={busy}
          error={error}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void act(async () => {
              await invoke('skills.remove', removing.id)
              setRemoving(null)
            })
          }
        >
          <p>
            {removing.name} · {t('This removes the skill from Ramu and every provider export.')}
          </p>
        </Dialog>
      )}
    </div>
  )
}
