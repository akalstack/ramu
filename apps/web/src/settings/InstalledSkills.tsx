import { SkillCopyUpdateReview } from './SkillCopyUpdateReview'
import { useStaging } from './stagedChanges'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ManagedSkill, SkillInstallPreview, SkillCopyUpdate, Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dialog, Dropdown } from '../Menu'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { SettingsScopeContext, useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList, SettingsEmpty } from './cards'
import { ListCount, ListEmpty, ListToolbar, useListView } from './ListView'
import { useWorkspace } from '../workspace/workspace'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { t } from '../i18n'
import { errorText } from '../lib/errors'

export function InstalledSkills() {
  const invoke = useSettingsInvoke(),
    ws = useWorkspace()
  const scope = useContext(SettingsScopeContext)
  const host = scope?.primaryId ?? ''
  const viewOnly = scope?.targets?.some((target) => target.viewOnly) ?? false
  const access = useRef({ host, viewOnly })
  access.current = { host, viewOnly }
  const allowed = () => access.current.host === host && !access.current.viewOnly
  const [loadedHost, setLoadedHost] = useState(host)
  const currentHost = loadedHost === host
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
  const [own, setOwn] = useState<ManagedSkill[]>([])
  const [sources, setSources] = useState<Record<string, number>>({})
  const [copyUpdate, setCopyUpdate] = useState<SkillCopyUpdate | null>(null)
  const reviewGeneration = useRef({ active: false })
  useEffect(() => {
    const generation = { active: true }
    reviewGeneration.current = generation
    setCopyUpdate(null)
    setDraft(null)
    setPreview(null)
    setRemoving(null)
    setSkills([])
    setOwn([])
    setSources({})
    setSource('')
    setName('')
    setProjectId('')
    setProjects([])
    setBusy(false)
    return () => {
      generation.active = false
    }
  }, [host])
  // The editor for a skill the person writes or copies. `id` is set when changing an existing one.
  const [draft, setDraft] = useState<{
    id?: string
    revision?: number
    name: string
    description: string
    content: string
    projectId: string
  } | null>(null)
  const [skillScope, setSkillScope] = useState('all')
  // A plugin's skills follow its switch in Plugins: a turned-off plugin's skills are not listed as if they were in use.
  const fromPlugin = (skill: ManagedSkill) => skill.installation?.source.startsWith('plugin:') === true
  const hiddenOff = skills.filter((skill) => fromPlugin(skill) && skill.status !== 'active').length
  const listed = skills.filter((skill) => !fromPlugin(skill) || skill.status === 'active')
  const view = useListView(currentHost ? listed : [], {
    text: (skill) => `${skill.name} ${skill.description}`,
    match: (skill) =>
      skillScope === 'all' || (skillScope === 'global' ? !skill.projectId : skill.projectId === skillScope),
    size: 10,
    filterKey: skillScope,
  })
  const paged = view.paged
  const load = useCallback(async () => {
    if (viewOnly || access.current.host !== host || access.current.viewOnly) return
    const snapshot = await invoke('learning.get')
    if (access.current.host !== host || access.current.viewOnly) return
    setSkills(snapshot.skills.filter((skill) => skill.installation))
    setSources(Object.fromEntries(snapshot.skills.map((skill) => [skill.id, skill.revision])))
    setOwn(
      snapshot.skills.filter((skill) => !skill.installation && skill.changedBy === 'user' && !skill.sourceSessionId),
    )
    const projects = await invoke('projects.list')
    if (access.current.host === host && !access.current.viewOnly) {
      setProjects(projects)
      setLoadedHost(host)
    }
  }, [invoke, host, viewOnly])
  useEffect(() => {
    if (viewOnly) return
    void load().catch((e) => setError(errorText(e)))
    void invoke('skills.availability')
      .then((v) => setAvailable(v.available))
      .catch(() => {})
  }, [load, invoke, viewOnly])
  const { valueOf, stage: stageSetting } = useStaging()
  const act = async (work: () => Promise<unknown>) => {
    if (!allowed()) return
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
  const reviewSource = async (id: string) => {
    if (!allowed()) return
    const generation = reviewGeneration.current
    setBusy(true)
    setError('')
    try {
      const update = await invoke('skills.copyUpdate', id)
      if (generation.active && allowed()) setCopyUpdate(update)
    } catch (reason) {
      if (generation.active) setError(errorText(reason))
    } finally {
      if (generation.active) setBusy(false)
    }
  }
  const stage = (value: SkillInstallPreview) => {
    setScripts(false)
    setPreview(value)
  }
  return (
    <div className="flex flex-col gap-2 mt-6">
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <fieldset disabled={viewOnly || !currentHost} className="contents">
        <SettingsGroupTitle className="mb-1">{t('Your skills')}</SettingsGroupTitle>
        <p className="m-0 text-caption text-muted-foreground">
          {t('Write instructions an agent can use whenever they apply. Learning never changes them.')}
        </p>
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setDraft({ name: '', description: '', content: '', projectId: '' })}
          >
            {t('Create skill')}
          </Button>
        </div>
        {currentHost && !own.length && !draft && (
          <SettingsEmpty>
            {t('No skills of your own yet. Create one to give agents instructions they can reuse.')}
          </SettingsEmpty>
        )}
        <SettingsCardList>
          {(currentHost ? own : []).map((skill) => (
            <SettingsCard
              key={skill.id}
              title={skill.name}
              badges={
                <Badge variant="outline">
                  {skill.projectId ? projects.find((p) => p.id === skill.projectId)?.name : t('All projects')}
                </Badge>
              }
              meta={
                <>
                  {skill.description}
                  {skill.copiedFrom && (
                    <span className="block text-muted-foreground">
                      {t('Your copy of {name}. Its source changes reach it only after you review them.', {
                        name:
                          skills.find((entry) => entry.id === skill.copiedFrom!.id)?.name ?? t('an installed skill'),
                      })}
                    </span>
                  )}
                </>
              }
              actions={
                <>
                  {skill.copiedFrom &&
                    sources[skill.copiedFrom.id] !== undefined &&
                    sources[skill.copiedFrom.id] !== skill.copiedFrom.revision && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reviewSource(skill.id)}>
                        {t('Review source changes')}
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      setDraft({
                        id: skill.id,
                        revision: skill.revision,
                        name: skill.name,
                        description: skill.description,
                        content: skill.content,
                        projectId: skill.projectId ?? '',
                      })
                    }
                  >
                    {t('Edit')}
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
              {skill.bundle && Object.keys(skill.bundle.files).some((path) => path !== 'SKILL.md') && (
                <details className="text-caption text-muted-foreground">
                  <summary className="cursor-pointer">{t('Supporting files')}</summary>
                  <p>{t('Approved files stay in this copy. Source updates never replace them.')}</p>
                  <ul className="max-h-32 overflow-auto font-mono">
                    {Object.keys(skill.bundle.files)
                      .filter((path) => path !== 'SKILL.md')
                      .sort()
                      .map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                  </ul>
                </details>
              )}
            </SettingsCard>
          ))}
        </SettingsCardList>
        <SettingsGroupTitle className="mb-1 mt-4">{t('Installed skills')}</SettingsGroupTitle>
        {!available && (
          <p role="status">
            {t('Install Node.js to install skills.')}{' '}
            <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">
              {t('Install instructions')}
            </a>
          </p>
        )}
        <div className="flex flex-col gap-2 rounded-(--radius-m) bg-fill p-3">
          <Input
            aria-label={t('Skill source')}
            placeholder={t('Repository, URL or local path')}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              aria-label={t('Skill name (optional)')}
              placeholder={t('Skill name (optional)')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Dropdown
              className="w-[150px]! flex-none"
              label={t('Skill scope')}
              value={projectId}
              options={[
                { value: '', label: t('All projects') },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              onChange={setProjectId}
            />
            <Button
              variant="secondary"
              className="bg-card hover:bg-card-hover flex-none"
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
          </div>
        </div>
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
        <ListToolbar
          view={view}
          label={t('Search installed skills')}
          filters={
            projects.length
              ? [
                  {
                    key: 'scope',
                    label: t('Scope'),
                    value: skillScope,
                    width: 'wide',
                    options: [
                      { value: 'all', label: t('Everything') },
                      { value: 'global', label: t('All projects') },
                      ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ],
                    onChange: setSkillScope,
                  },
                ]
              : []
          }
        />
        <ListCount view={view} />
        {hiddenOff > 0 && (
          <p className="m-0 text-caption text-muted-foreground">
            {hiddenOff === 1
              ? t('1 skill from a turned-off plugin is hidden.')
              : t('{0} skills from turned-off plugins are hidden.', { 0: hiddenOff })}
          </p>
        )}
        <ListEmpty
          view={view}
          none="No installed skills yet."
          filtered="No installed skills match your search."
          onReset={() => setSkillScope('all')}
        />
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
              meta={
                <>
                  {skill.description}
                  {skill.installation && (
                    <span className="block text-muted-foreground [overflow-wrap:anywhere]">
                      {t('From {source}. Update brings in its changes. Make a copy to edit it yourself.', {
                        source: skill.installation.source,
                      })}
                    </span>
                  )}
                </>
              }
              actions={
                fromPlugin(skill) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    title={t('Comes with a plugin: it updates, turns off and is removed with it.')}
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'plugins' } }))
                    }
                  >
                    {t('Manage in Plugins')}
                  </Button>
                ) : (
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
                      title={t('Make your own editable copy. The installed skill keeps updating from its source.')}
                      onClick={() =>
                        void act(async () => {
                          const copy = await invoke('skills.fork', skill.id)
                          setDraft({
                            id: copy.id,
                            revision: copy.revision,
                            name: copy.name,
                            description: copy.description,
                            content: copy.content,
                            projectId: copy.projectId ?? '',
                          })
                        })
                      }
                    >
                      {t('Edit a copy')}
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
                )
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
                value={valueOf(`skill-project:${skill.id}`, skill.projectId ?? '')}
                options={[
                  { value: '', label: t('All projects') },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
                onChange={(id) =>
                  stageSetting(`skill-project:${skill.id}`, id, skill.projectId ?? '', (value) =>
                    act(() => invoke('skills.move', skill.id, value || null)),
                  )
                }
                disabled={busy}
              />
            </SettingsCard>
          ))}
          {paged.more}
        </SettingsCardList>
      </fieldset>
      {currentHost && preview && (
        <Dialog
          title={t('Review skill installation')}
          confirmLabel={t('Install skill')}
          busy={busy}
          confirmDisabled={viewOnly}
          error={error}
          onCancel={() => {
            if (allowed()) void invoke('skills.cancel', preview.id).catch(() => {})
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
              <Checkbox disabled={viewOnly} checked={scripts} onCheckedChange={(value) => setScripts(value === true)} />
              {t('Also copy the listed scripts. Ramu will not run them.')}
            </label>
          )}
        </Dialog>
      )}
      {currentHost && copyUpdate && (
        <SkillCopyUpdateReview
          key={`${copyUpdate.id}:${copyUpdate.revision}`}
          preview={copyUpdate}
          readOnly={viewOnly}
          busy={busy}
          error={error}
          onCancel={() => setCopyUpdate(null)}
          onSave={(changes) =>
            void act(async () => {
              await invoke(
                'skills.applyCopyUpdate',
                copyUpdate.id,
                copyUpdate.revision,
                copyUpdate.sourceRevision,
                changes,
              )
              setCopyUpdate(null)
            })
          }
        />
      )}
      {currentHost && draft && (
        <Dialog
          title={draft.id ? t('Edit skill') : t('Create skill')}
          confirmLabel={t('Save skill')}
          busy={busy}
          confirmDisabled={viewOnly}
          error={error}
          onCancel={() => setDraft(null)}
          onConfirm={() =>
            void act(async () => {
              if (draft.id)
                await invoke(
                  'skills.edit',
                  draft.id,
                  { description: draft.description, content: draft.content },
                  draft.revision ?? 0,
                )
              else
                await invoke('skills.create', {
                  name: draft.name.trim(),
                  description: draft.description,
                  content: draft.content,
                  projectId: draft.projectId || null,
                })
              setDraft(null)
            })
          }
        >
          <div className="flex flex-col gap-2">
            <Input
              aria-label={t('Skill name')}
              placeholder={t('review-checklist')}
              value={draft.name}
              disabled={viewOnly || !!draft.id}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Input
              aria-label={t('When to use it')}
              placeholder={t('When should an agent use this skill?')}
              readOnly={viewOnly}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <Textarea
              aria-label={t('Instructions')}
              placeholder={t('What should the agent do?')}
              className="min-h-40"
              readOnly={viewOnly}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
            {!draft.id && (
              <Dropdown
                disabled={viewOnly}
                label={t('Skill scope')}
                value={draft.projectId}
                options={[
                  { value: '', label: t('All projects') },
                  ...projects.map((project) => ({ value: project.id, label: project.name })),
                ]}
                onChange={(projectId) => setDraft({ ...draft, projectId })}
              />
            )}
          </div>
        </Dialog>
      )}
      {currentHost && removing && (
        <Dialog
          title={removing.installation ? t('Remove installed skill?') : t('Remove skill?')}
          confirmLabel={t('Remove')}
          busy={busy}
          confirmDisabled={viewOnly}
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
