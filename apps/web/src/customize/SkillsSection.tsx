import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, RefreshCw, Sparkle } from 'lucide-react'
import type { DirectorySkill, ManagedSkill, Project, SkillInstallPreview } from '@ramu/shared/types'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, Dropdown, Menu } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../lib/errors'
import { formatLocale, t, useLanguage } from '../i18n'
import { InstalledSkills } from '../settings/InstalledSkills'
import { SkillFiles } from './SkillFiles'
import type { WaitingTool } from '@ramu/shared/toolSync'
import { Advanced, CustomizeHeader, ExtensionGrid, ExtensionItem, Quiet, SectionTitle } from './parts'
import { AvailableOn, RemoveElsewhere, useRemoveElsewhere, useToolSync, WaitingTools } from './toolSync'
import { SafetyCheck } from './SafetyCheck'
import { EVERY_USE, UseFor, type UseChoice } from './UseFor'
import {
  LEARNED_STATUSES,
  LEARNED_STATUS_LABELS,
  LearnedSkillDetail,
  SkillHistory,
  learnedByRamu,
  type LearnedStatus,
} from './LearnedSkills'
import { takeLibraryFocus } from '../summaries/libraryFocus'

const fromPlugin = (skill: ManagedSkill) => skill.installation?.source.startsWith('plugin:') === true
const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (skill: ManagedSkill, query: string) =>
  words(query).every((word) => `${skill.name} ${skill.description}`.toLowerCase().includes(word))
const installs = (count: number) =>
  t('{0} installs', { '0': new Intl.NumberFormat(formatLocale(), { notation: 'compact' }).format(count) })

type Draft = {
  id?: string
  revision?: number
  name: string
  description: string
  content: string
  projectId: string
}

/**
 * Skills: the ones you wrote, the ones installed from a repository or a plugin, the ones Ramu learned from finished
 * threads, and the skills.sh directory to add more from, searched as you type.
 */
export function SkillsSection({
  onOpenPlugins,
  install: requested,
}: {
  onOpenPlugins: () => void
  /** A directory skill whose install review opens on arrival, such as one a thread suggested. */
  install?: { source: string; skill: string; projectId?: string } | null
}) {
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
  const [learnedStatus, setLearnedStatus] = useState<LearnedStatus>('active')
  const { status: sync, reload: reloadSync } = useToolSync()
  const load = useCallback(async () => {
    const snapshot = await invoke('learning.get')
    setSkills(snapshot.skills)
    reloadSync()
  }, [invoke, reloadSync])
  useEffect(() => {
    load().catch((reason) => setError(errorText(reason)))
    void invoke('projects.list').then(setProjects, () => {})
    invoke('skills.popular').then(setPopular, (reason) => setDirectoryError(errorText(reason)))
  }, [load, invoke])
  // A skill named in a summary of what Ramu learned opens on its details, whatever its status.
  useEffect(() => {
    const take = () => {
      const item = takeLibraryFocus('skill')
      if (!item) return
      setLearnedStatus('all')
      setOpenId(item.id)
    }
    take()
    window.addEventListener('ramu:library-focus', take)
    return () => window.removeEventListener('ramu:library-focus', take)
  }, [])
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
  const install = (key: string, source: string, skill?: string, updatingId?: string, projectId: string | null = null) =>
    act(key, async () =>
      setPreview(await invoke('skills.stage', { source, skill, projectId, ...(updatingId ? { updatingId } : {}) })),
    )
  useEffect(() => {
    if (requested)
      void install(
        `directory:${requested.source}/${requested.skill}`,
        requested.source,
        requested.skill,
        undefined,
        requested.projectId ?? null,
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opens once for each request
  }, [requested])
  /** A skill another host sent: an installed one is fetched from its source again, a written one opens in the editor. */
  const reviewWaiting = (entry: WaitingTool) => {
    if (entry.tool.kind !== 'skill') return
    const tool = entry.tool
    // A project's skill goes to the project here on the same remote.
    const projectId = entry.projectId ?? null
    const here = (skills ?? []).find((skill) => skill.name === tool.name && (skill.projectId ?? null) === projectId)
    if (tool.source)
      void install(entry.key, tool.source, tool.name, here?.installation ? here.id : undefined, projectId)
    else
      setDraft({
        ...(here && !here.installation ? { id: here.id, revision: here.revision } : {}),
        name: tool.name,
        description: tool.description,
        content: tool.content ?? '',
        projectId: projectId ?? '',
      })
  }
  const all = skills ?? []
  const own = all.filter((skill) => !skill.installation && !learnedByRamu(skill) && matches(skill, query))
  const learnedAll = all.filter(learnedByRamu)
  const learned = learnedAll.filter(
    (skill) => (learnedStatus === 'all' || skill.status === learnedStatus) && matches(skill, query),
  )
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
          {skill.pinned && learnedByRamu(skill) && <Badge variant="outline">{t('Pinned')}</Badge>}
        </>
      }
      onOpen={() => setOpenId(skill.id)}
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
          size="sm"
          variant="secondary"
          aria-label={t('Install {name}', { name: entry.name })}
          disabled={busy !== null}
          onClick={() => void install(entry.id, entry.source, entry.skill)}
        >
          {busy === entry.id && <RefreshCw size={13} className="animate-spin" aria-hidden />}
          {t('Install')}
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
          <WaitingTools
            kind="skill"
            status={sync}
            busy={busy}
            onReview={reviewWaiting}
            onRemove={(entry) => {
              const here = all.find(
                (skill) =>
                  skill.name === entry.tool.name &&
                  (skill.projectId ?? null) === (entry.projectId ?? null) &&
                  !fromPlugin(skill),
              )
              if (here) void act(entry.key, () => invoke('skills.remove', here.id))
            }}
          />
          {own.length > 0 && (
            <>
              <SectionTitle title={t('Your skills')} count={own.length} help={t('Learning never changes them.')} />
              <ExtensionGrid label={t('Your skills')}>{own.map(skillItem)}</ExtensionGrid>
            </>
          )}
          {learnedAll.length > 0 && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <SectionTitle
                  title={t('Learned by Ramu')}
                  count={learned.length}
                  help={t('From finished threads. Ramu keeps them current unless you pin them.')}
                />
                <Dropdown
                  label={t('Status')}
                  value={learnedStatus}
                  options={LEARNED_STATUSES.map((value) => ({ value, label: t(LEARNED_STATUS_LABELS[value]) }))}
                  onChange={(next) => setLearnedStatus(next as LearnedStatus)}
                />
              </div>
              {learned.length ? (
                <ExtensionGrid label={t('Learned by Ramu')}>{learned.map(skillItem)}</ExtensionGrid>
              ) : (
                <Quiet>{t('No skills match your search.')}</Quiet>
              )}
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
          projects={projects}
          busy={busy === 'confirm'}
          onCancel={() => {
            void invoke('skills.cancel', preview.id).catch(() => {})
            setPreview(null)
          }}
          onConfirm={(use) =>
            void act('confirm', async () => {
              await invoke('skills.confirm', preview.id, { projectId: use.place || null, providers: use.providers })
              setPreview(null)
            })
          }
        />
      )}
      {open && learnedByRamu(open) && (
        <LearnedSkillDetail skill={open} projects={projects} busy={busy} act={act} onClose={() => setOpenId(null)} />
      )}
      {open && !learnedByRamu(open) && (
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
          onSave={(value, use) =>
            void act('save', async () => {
              if (value.id)
                await invoke(
                  'skills.edit',
                  value.id,
                  { description: value.description, content: value.content },
                  value.revision ?? 0,
                )
              else {
                const created = await invoke('skills.create', {
                  name: value.name,
                  description: value.description,
                  content: value.content,
                  projectId: use.place || null,
                })
                if (use.providers.length < AGENT_PROVIDERS.length)
                  await invoke('skills.setProviders', created.id, use.providers)
              }
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
  const elsewhere = useRemoveElsewhere(`skill:${skill.name}`, sync)
  const read = useCallback((path: string) => invoke('skills.fileText', { skillId: skill.id }, path), [invoke, skill.id])
  const bundle = skill.installation ?? skill.bundle
  const plugin = fromPlugin(skill)
  const chosen = skill.providers?.length
    ? AGENT_PROVIDERS.filter((provider) => skill.providers!.includes(provider))
    : [...AGENT_PROVIDERS]
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
            await elsewhere.before()
            await invoke('skills.remove', skill.id)
            onClose()
          })
        }
      >
        <p className="m-0 text-control">{t('Agents stop using it in new turns.')}</p>
        <RemoveElsewhere control={elsewhere} />
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
        <UseFor
          value={{ providers: chosen, place: skill.projectId ?? '' }}
          projects={projects}
          disabled={busy !== null}
          placeLocked={
            plugin ? t('Used where the {0} plugin is.', { '0': skill.installation!.source.slice(7) }) : undefined
          }
          onChange={(next) =>
            void act('use', async () => {
              if (next.providers.join() !== chosen.join()) await invoke('skills.setProviders', skill.id, next.providers)
              if (next.place !== (skill.projectId ?? '')) await invoke('skills.move', skill.id, next.place || null)
            })
          }
        />
        <SafetyCheck target={{ kind: 'skill', skillId: skill.id }} />
        {!skill.installation && <SkillHistory skill={skill} busy={busy} act={act} />}
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

/**
 * What a skill would add, before it is saved: what it tells agents, the files it brings, which agents use it and where,
 * and a safety read on request. Its scripts come with it, since its instructions call them.
 */
function SkillReview({
  preview,
  projects,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: SkillInstallPreview
  projects: Project[]
  busy: boolean
  onConfirm: (use: UseChoice) => void
  onCancel: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [use, setUse] = useState<UseChoice>({ ...EVERY_USE, place: preview.projectId ?? '' })
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
      onConfirm={() => onConfirm(use)}
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
        {!preview.updatingId && <UseFor value={use} onChange={setUse} projects={projects} disabled={busy} />}
        <SafetyCheck target={{ kind: 'skill', stageId: preview.id }} disabled={busy} />
        <SkillFiles
          markdown={preview.markdown}
          files={preview.files}
          read={read}
          changed={preview.updatingId ? new Set([...preview.changes.added, ...preview.changes.changed]) : undefined}
        />
        {scriptFiles.length > 0 && (
          <p className="m-0 text-caption text-muted-foreground">
            {scriptFiles.length === 1
              ? t('It comes with 1 script its instructions call. Ramu never runs it itself.')
              : t('It comes with {0} scripts its instructions call. Ramu never runs them itself.', {
                  '0': scriptFiles.length,
                })}
          </p>
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
  onSave: (draft: Draft, use: UseChoice) => void
  onCancel: () => void
}) {
  useLanguage()
  const [value, setValue] = useState(draft)
  const [use, setUse] = useState<UseChoice>({ ...EVERY_USE, place: draft.projectId })
  return (
    <Dialog
      title={draft.id ? t('Edit {name}', { name: draft.name }) : t('Write a skill')}
      confirmLabel={t('Save')}
      busy={busy}
      confirmDisabled={!value.name.trim() || !value.description.trim() || !value.content.trim()}
      onCancel={onCancel}
      onConfirm={() => onSave(value, use)}
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
        {!draft.id && <UseFor value={use} onChange={setUse} projects={projects} disabled={busy} />}
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
