import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, Plus, RefreshCw, Sparkle } from 'lucide-react'
import type { DirectorySkill, ManagedSkill, Project, SkillInstallPreview } from '@ramu/shared/types'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from 'cn'
import { Dialog, Dropdown, Menu } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../lib/errors'
import { formatLocale, t, useLanguage } from '../i18n'
import { InstalledSkills } from '../settings/InstalledSkills'
import { SkillFiles } from './SkillFiles'
import type { WaitingTool } from '@ramu/shared/toolSync'
import { Advanced, CustomizeHeader, ExtensionGrid, ExtensionItem, Quiet, SectionTitle } from './parts'
import { AvailableOn, useToolSync, WaitingTools } from './toolSync'

const fromPlugin = (skill: ManagedSkill) => skill.installation?.source.startsWith('plugin:') === true
const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (skill: ManagedSkill, query: string) =>
  words(query).every((word) => `${skill.name} ${skill.description}`.toLowerCase().includes(word))
const installs = (count: number) =>
  t('{0} installs', { '0': new Intl.NumberFormat(formatLocale(), { notation: 'compact' }).format(count) })

type Draft = { id?: string; revision?: number; name: string; description: string; content: string; projectId: string }

/**
 * Skills: the ones you wrote, the ones installed from a repository or a plugin, and the skills.sh directory to add more
 * from, searched as you type.
 */
export function SkillsSection({ onOpenPlugins }: { onOpenPlugins: () => void }) {
  useLanguage()
  const { invoke } = useHost()
  const [skills, setSkills] = useState<ManagedSkill[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [popular, setPopular] = useState<DirectorySkill[] | null>(null)
  const [results, setResults] = useState<{ query: string; skills: DirectorySkill[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<SkillInstallPreview | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [adding, setAdding] = useState(false)
  const { status: sync, reload: reloadSync } = useToolSync()
  const load = useCallback(async () => {
    const snapshot = await invoke('learning.get')
    setSkills(
      snapshot.skills.filter((skill) => skill.installation || (skill.changedBy === 'user' && !skill.sourceSessionId)),
    )
    reloadSync()
  }, [invoke, reloadSync])
  useEffect(() => {
    load().catch((reason) => setError(errorText(reason)))
    void invoke('projects.list').then(setProjects, () => {})
    invoke('skills.popular').then(setPopular, (reason) => setDirectoryError(errorText(reason)))
  }, [load, invoke])
  // The directory is searched once typing pauses, and only for two letters or more.
  const latest = useRef('')
  useEffect(() => {
    const text = query.trim()
    latest.current = text
    if (text.length < 2) {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      invoke('skills.search', text)
        .then(
          (found) => {
            if (latest.current === text) setResults({ query: text, skills: found })
          },
          (reason) => setDirectoryError(errorText(reason)),
        )
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, invoke])
  /** Runs one action; false when it failed, so a dialog that started it stays open with what was typed. */
  const act = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await work()
      await load()
      return true
    } catch (reason) {
      setError(errorText(reason))
      return false
    } finally {
      setBusy(null)
    }
  }
  const install = (key: string, source: string, skill?: string, updatingId?: string) =>
    act(key, async () =>
      setPreview(
        await invoke('skills.stage', { source, skill, projectId: null, ...(updatingId ? { updatingId } : {}) }),
      ),
    )
  /** A skill another host sent: an installed one is fetched from its source again, a written one opens in the editor. */
  const reviewWaiting = (entry: WaitingTool) => {
    if (entry.tool.kind !== 'skill') return
    const tool = entry.tool
    const here = (skills ?? []).find((skill) => skill.name === tool.name && !skill.projectId)
    if (tool.source) void install(entry.key, tool.source, tool.name, here?.installation ? here.id : undefined)
    else
      setDraft({
        ...(here && !here.installation ? { id: here.id, revision: here.revision } : {}),
        name: tool.name,
        description: tool.description,
        content: tool.content ?? '',
        projectId: '',
      })
  }
  const all = skills ?? []
  const own = all.filter((skill) => !skill.installation && matches(skill, query))
  const installed = all.filter((skill) => skill.installation && matches(skill, query))
  const have = new Set(all.flatMap((skill) => [skill.name, skill.installation?.source ?? '']))
  const directory = (results?.skills ?? popular ?? []).filter((entry) => !have.has(entry.name))
  const open = all.find((skill) => skill.id === openId) ?? null
  const scopeOf = (skill: ManagedSkill) =>
    skill.projectId ? (projects.find((project) => project.id === skill.projectId)?.name ?? t('One project')) : null
  const skillItem = (skill: ManagedSkill) => (
    <ExtensionItem
      key={skill.id}
      name={skill.name}
      icon={<BookOpen size={16} />}
      subtitle={skill.description}
      muted={skill.status !== 'active'}
      badge={
        <>
          {fromPlugin(skill) && <Badge variant="outline">{skill.installation!.source.slice(7)}</Badge>}
          {scopeOf(skill) && <Badge variant="outline">{scopeOf(skill)}</Badge>}
          {skill.status !== 'active' && <Badge variant="outline">{t('Off')}</Badge>}
        </>
      }
      onOpen={() => setOpenId(skill.id)}
      action={<Check size={15} className="text-muted-foreground" aria-label={t('Installed')} />}
    />
  )
  const directoryItem = (entry: DirectorySkill) => (
    <ExtensionItem
      key={entry.id}
      name={entry.name}
      icon={<Sparkle size={16} />}
      subtitle={`${entry.source} · ${installs(entry.installs)}`}
      onOpen={() => void install(entry.id, entry.source, entry.skill)}
      action={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('Install {name}', { name: entry.name })}
          title={t('Install {name}', { name: entry.name })}
          disabled={busy !== null}
          onClick={() => void install(entry.id, entry.source, entry.skill)}
        >
          {busy === entry.id ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={16} />}
        </Button>
      }
    />
  )
  return (
    <div className="flex flex-col">
      <CustomizeHeader
        title={t('Skills')}
        description={t('Instructions an agent picks up when a task needs them. Search to find more on skills.sh.')}
        query={query}
        onQuery={setQuery}
        placeholder={t('Search your skills and skills.sh')}
        actions={
          <Menu
            standard
            label={t('Add')}
            icon={
              <>
                {t('Add')}
                <ChevronDown size={13} />
              </>
            }
            className="h-8 gap-1 rounded-(--radius-s) bg-fill px-3 text-control text-foreground hover:bg-fill-hover"
            align="end"
            items={[
              {
                key: 'write',
                label: t('Write a skill…'),
                onSelect: () => setDraft({ name: '', description: '', content: '', projectId: '' }),
              },
              { key: 'source', label: t('From a repository, address or folder…'), onSelect: () => setAdding(true) },
            ]}
          />
        }
      />
      {error && <Quiet alert>{error}</Quiet>}
      {!skills ? (
        <Quiet>{t('Loading skills…')}</Quiet>
      ) : (
        <>
          <WaitingTools kind="skill" status={sync} busy={busy} onReview={reviewWaiting} />
          {own.length > 0 && (
            <>
              <SectionTitle title={t('Your skills')} count={own.length} help={t('Learning never changes them.')} />
              <ExtensionGrid label={t('Your skills')}>{own.map(skillItem)}</ExtensionGrid>
            </>
          )}
          <SectionTitle title={t('Installed')} count={installed.length} />
          {installed.length ? (
            <ExtensionGrid label={t('Installed')}>{installed.map(skillItem)}</ExtensionGrid>
          ) : (
            <Quiet>{query ? t('No installed skill matches.') : t('Nothing installed yet. Pick one below.')}</Quiet>
          )}
          <SectionTitle
            title={results ? t('On skills.sh') : t('Popular on skills.sh')}
            help={results ? undefined : t('The most installed skills in the open directory.')}
          />
          {directoryError && !directory.length ? (
            <Quiet>{directoryError}</Quiet>
          ) : searching && !results ? (
            <Quiet>{t('Searching skills.sh…')}</Quiet>
          ) : directory.length ? (
            <ExtensionGrid label={t('skills.sh')}>{directory.map(directoryItem)}</ExtensionGrid>
          ) : (
            <Quiet>{results ? t('No skill on skills.sh matches "{0}".', { '0': results.query }) : t('Loading…')}</Quiet>
          )}
        </>
      )}
      <Advanced title={t('Advanced: copies, their source changes and supporting files')}>
        <InstalledSkills />
      </Advanced>
      {preview && (
        <SkillReview
          preview={preview}
          busy={busy === 'confirm'}
          onCancel={() => {
            void invoke('skills.cancel', preview.id).catch(() => {})
            setPreview(null)
          }}
          onConfirm={(scripts) =>
            void act('confirm', async () => {
              await invoke('skills.confirm', preview.id, scripts)
              setPreview(null)
            })
          }
        />
      )}
      {open && (
        <SkillDetail
          skill={open}
          sync={sync}
          projects={projects}
          busy={busy}
          onClose={() => setOpenId(null)}
          onOpenPlugins={onOpenPlugins}
          act={act}
          onEdit={(skill) =>
            setDraft({
              id: skill.id,
              revision: skill.revision,
              name: skill.name,
              description: skill.description,
              content: skill.content,
              projectId: skill.projectId ?? '',
            })
          }
          onUpdate={(skill) =>
            void act('update', async () => setPreview(await invoke('skills.updateSource', skill.id)))
          }
        />
      )}
      {draft && (
        <SkillEditor
          draft={draft}
          projects={projects}
          busy={busy === 'save'}
          onCancel={() => setDraft(null)}
          onSave={(value) =>
            void act('save', async () => {
              if (value.id)
                await invoke(
                  'skills.edit',
                  value.id,
                  { description: value.description, content: value.content },
                  value.revision ?? 0,
                )
              else
                await invoke('skills.create', {
                  name: value.name,
                  description: value.description,
                  content: value.content,
                  projectId: value.projectId || null,
                })
              setDraft(null)
            })
          }
        />
      )}
      {adding && (
        <AddSkillSource
          busy={busy === 'source'}
          error={error}
          onCancel={() => {
            setAdding(false)
            setError(null)
          }}
          onSubmit={(source, name) =>
            void install('source', source, name || undefined).then((done) => done && setAdding(false))
          }
        />
      )}
    </div>
  )
}

/** An installed or written skill: who uses it and where, and what to do with it. */
function SkillDetail({
  skill,
  sync,
  projects,
  busy,
  onClose,
  onOpenPlugins,
  act,
  onEdit,
  onUpdate,
}: {
  skill: ManagedSkill
  sync: ReturnType<typeof useToolSync>['status']
  projects: Project[]
  busy: string | null
  onClose: () => void
  onOpenPlugins: () => void
  act: (key: string, work: () => Promise<unknown>) => Promise<unknown>
  onEdit: (skill: ManagedSkill) => void
  onUpdate: (skill: ManagedSkill) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const read = useCallback((path: string) => invoke('skills.fileText', { skillId: skill.id }, path), [invoke, skill.id])
  const bundle = skill.installation ?? skill.bundle
  const plugin = fromPlugin(skill)
  const chosen = skill.providers?.length ? skill.providers : [...AGENT_PROVIDERS]
  if (confirmRemove)
    return (
      <Dialog
        title={t('Remove {name}?', { name: skill.name })}
        confirmLabel={t('Remove')}
        danger
        busy={busy === 'remove'}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          void act('remove', async () => {
            await invoke('skills.remove', skill.id)
            onClose()
          })
        }
      >
        <p className="m-0 text-control">{t('Agents stop using it in new turns.')}</p>
      </Dialog>
    )
  return (
    <Dialog
      title={skill.name}
      confirmLabel={t('Done')}
      cancellable={false}
      onConfirm={onClose}
      onCancel={onClose}
      footerLeading={
        plugin ? undefined : (
          <Button size="sm" variant="ghost" className="hover:text-bad" onClick={() => setConfirmRemove(true)}>
            {t('Remove')}
          </Button>
        )
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {skill.description && <p className="m-0 text-control text-soft">{skill.description}</p>}
        {skill.installation && (
          <p className="m-0 truncate text-caption text-muted-foreground" title={skill.installation.source}>
            {plugin
              ? t('Comes with the {0} plugin: it updates, turns off and is removed with it.', {
                  '0': skill.installation.source.slice(7),
                })
              : t('From {source}. Update brings in its changes; make a copy to edit it yourself.', {
                  source: skill.installation.source,
                })}
          </p>
        )}
        {showFiles ? (
          <div className="dialog-wide">
            <SkillFiles
              markdown={bundle?.markdown ?? skill.content}
              files={
                bundle
                  ? Object.entries(bundle.files).map(([path, data]) => ({
                      path,
                      bytes: Math.floor((data.length * 3) / 4),
                    }))
                  : []
              }
              read={read}
            />
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowFiles(true)}>
            <BookOpen size={13} />
            {t('Show what it tells agents')}
          </Button>
        )}
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" disabled={busy !== null}>
          <legend className="mb-1.5 text-caption text-muted-foreground">{t('Used by')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_PROVIDERS.map((provider) => {
              const on = chosen.includes(provider)
              return (
                <Button
                  key={provider}
                  size="sm"
                  variant="ghost"
                  aria-pressed={on}
                  disabled={on && chosen.length === 1}
                  className={cn(
                    'h-7 rounded-full border border-line px-2.5 text-caption',
                    on ? 'bg-fill text-foreground' : 'text-muted-foreground',
                  )}
                  onClick={() =>
                    void act('providers', () =>
                      invoke(
                        'skills.setProviders',
                        skill.id,
                        on ? chosen.filter((entry) => entry !== provider) : [...chosen, provider],
                      ),
                    )
                  }
                >
                  {on && <Check size={12} />}
                  {providerName(provider)}
                </Button>
              )
            })}
          </div>
        </fieldset>
        {!plugin && projects.length > 0 && (
          <Dropdown
            label={t('Use in')}
            value={skill.projectId ?? ''}
            options={[
              { value: '', label: t('All projects') },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={(value) => void act('move', () => invoke('skills.move', skill.id, value || null))}
            disabled={busy !== null}
          />
        )}
        {!plugin && <AvailableOn toolKey={`skill:${skill.name}`} status={sync} />}
        <div className="flex flex-wrap gap-1.5">
          {plugin ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onClose()
                onOpenPlugins()
              }}
            >
              {t('Open in Plugins')}
            </Button>
          ) : (
            <>
              {skill.installation ? (
                <>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => onUpdate(skill)}>
                    {t('Check for update')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      void act('fork', async () => {
                        onEdit(await invoke('skills.fork', skill.id))
                        onClose()
                      })
                    }
                  >
                    {t('Edit a copy')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    onEdit(skill)
                    onClose()
                  }}
                >
                  {t('Edit')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void act('toggle', () =>
                    invoke('learning.control', skill.id, skill.status === 'active' ? 'disable' : 'restore'),
                  )
                }
              >
                {skill.status === 'active' ? t('Turn off') : t('Turn on')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** What a skill would add, before it is saved. */
function SkillReview({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: SkillInstallPreview
  busy: boolean
  onConfirm: (scripts: boolean) => void
  onCancel: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [scripts, setScripts] = useState(false)
  const scriptFiles = preview.files.filter((file) => file.script)
  const read = useCallback(
    (path: string) => invoke('skills.fileText', { stageId: preview.id }, path),
    [invoke, preview.id],
  )
  return (
    <Dialog
      title={
        preview.updatingId ? t('Update {name}', { name: preview.name }) : t('Install {name}', { name: preview.name })
      }
      confirmLabel={preview.updatingId ? t('Update') : t('Install')}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => onConfirm(scripts)}
    >
      <div className="dialog-wide flex min-w-0 flex-col gap-3">
        {preview.description && <p className="m-0 text-control text-soft">{preview.description}</p>}
        <p className="m-0 truncate text-caption text-muted-foreground" title={preview.source}>
          {preview.source}
        </p>
        {preview.updatingId && (
          <p className="m-0 text-caption text-muted-foreground">
            {[
              preview.changes.added.length ? t('{0} added', { '0': preview.changes.added.length }) : '',
              preview.changes.changed.length ? t('{0} changed', { '0': preview.changes.changed.length }) : '',
              preview.changes.removed.length ? t('{0} removed', { '0': preview.changes.removed.length }) : '',
            ]
              .filter(Boolean)
              .join(' · ') || t('No file changes')}
          </p>
        )}
        <SkillFiles
          markdown={preview.markdown}
          files={preview.files}
          read={read}
          changed={preview.updatingId ? new Set([...preview.changes.added, ...preview.changes.changed]) : undefined}
        />
        {scriptFiles.length > 0 && (
          <label className="flex items-start gap-2 text-caption">
            <Checkbox checked={scripts} onCheckedChange={(value) => setScripts(value === true)} />
            <span>{t('Also copy its {0} scripts. Ramu will not run them.', { '0': scriptFiles.length })}</span>
          </label>
        )}
      </div>
    </Dialog>
  )
}

function SkillEditor({
  draft,
  projects,
  busy,
  onSave,
  onCancel,
}: {
  draft: Draft
  projects: Project[]
  busy: boolean
  onSave: (draft: Draft) => void
  onCancel: () => void
}) {
  useLanguage()
  const [value, setValue] = useState(draft)
  return (
    <Dialog
      title={draft.id ? t('Edit {name}', { name: draft.name }) : t('Write a skill')}
      confirmLabel={t('Save')}
      busy={busy}
      confirmDisabled={!value.name.trim() || !value.description.trim() || !value.content.trim()}
      onCancel={onCancel}
      onConfirm={() => onSave(value)}
    >
      <div className="flex min-w-0 flex-col gap-2.5">
        {!draft.id && (
          <Input
            autoFocus
            aria-label={t('Name')}
            placeholder={t('Name, such as release-notes')}
            value={value.name}
            onChange={(event) => setValue({ ...value, name: event.target.value })}
          />
        )}
        <Input
          aria-label={t('When to use it')}
          placeholder={t('When an agent should use it, in one sentence')}
          value={value.description}
          onChange={(event) => setValue({ ...value, description: event.target.value })}
        />
        <Textarea
          aria-label={t('Instructions')}
          placeholder={t('The steps an agent follows, in plain sentences')}
          className="min-h-48 font-mono text-caption"
          value={value.content}
          onChange={(event) => setValue({ ...value, content: event.target.value })}
        />
        {!draft.id && projects.length > 0 && (
          <Dropdown
            label={t('Use in')}
            value={value.projectId}
            options={[
              { value: '', label: t('All projects') },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={(projectId) => setValue({ ...value, projectId })}
          />
        )}
      </div>
    </Dialog>
  )
}

function AddSkillSource({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  /** Why the last try failed, shown in the dialog so the source can be corrected without typing it again. */
  error: string | null
  onCancel: () => void
  onSubmit: (source: string, name: string) => void
}) {
  useLanguage()
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  return (
    <Dialog
      title={t('Add a skill from its source')}
      confirmLabel={t('Review')}
      busy={busy}
      confirmDisabled={!source.trim()}
      onCancel={onCancel}
      onConfirm={() => onSubmit(source.trim(), name.trim())}
    >
      <div className="flex flex-col gap-2">
        <Input
          autoFocus
          aria-label={t('Skill source')}
          placeholder={t('owner/repo, an address or a folder')}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <Input
          aria-label={t('Skill name (optional)')}
          placeholder={t('Skill name, when the repository has several')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <Quiet alert>{error}</Quiet>}
      </div>
    </Dialog>
  )
}
