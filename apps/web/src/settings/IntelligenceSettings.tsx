import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { MovedToCustomize } from '../customize/openCustomize'
import { ListCount, ListEmpty, ListToolbar, useListView } from './ListView'
import { Badge } from '@/components/ui/badge'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { SettingsAdvanced, SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { takeLibraryFocus } from '../summaries/libraryFocus'
import { SettingsCard, SettingsCardList, SettingsEmpty, SettingsSectionHead } from './cards'
import { ModelChoice } from './ModelChoice'
import {
  type IntelligencePreferences,
  type MemoryPreferences,
  type LearningSnapshot,
  type ManagedSkill,
  type Project,
} from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers/providers'
import { SKILL_ACTION_LABELS, skillActions } from '@ramu/shared/skillControls'
import { readableJobError } from '@ramu/shared/jobErrors'

type Props = { value: IntelligencePreferences; onChange: (value: IntelligencePreferences) => void }
const withCurrent = (values: number[], current: number) => [...new Set([...values, current])].sort((a, b) => a - b)

export function EfficiencySettings({ value, onChange }: Props) {
  return (
    <>
      <SettingsGroupTitle>{t('Token efficiency')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.toolSearch">
        <SettingsLabel
          title={t('Load tools on demand')}
          help={t(
            'Keep optional Ramu tools out of the prompt until the agent needs them. Applies to new provider sessions.',
          )}
        />
        <Switch
          aria-label={t('Load tools on demand')}
          checked={value.toolSearch}
          onCheckedChange={(toolSearch) => onChange({ ...value, toolSearch })}
        />
      </SettingsRow>
    </>
  )
}

/** One model for the background work of both memory cleanup and learning reviews. */
export function MaintenanceModelSettings({ value, onChange, cleanup }: Props & { cleanup: boolean }) {
  if (value.learning === 'off' && !cleanup) return null
  return (
    <div className="settings-form flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('Background model')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.maintenanceModel">
        <SettingsLabel
          title={t('Model for background maintenance')}
          help={t('Used for learning reviews and memory cleanup. A cheaper model keeps token use low.')}
        />
        <ModelChoice
          label={t('Model for background maintenance')}
          value={value.maintenanceModel}
          emptyLabel={t('Same as thread')}
          onChange={(maintenanceModel) => onChange({ ...value, maintenanceModel })}
        />
      </SettingsRow>
    </div>
  )
}

/** Limits on background learning. */
function LearningLimitsSettings({ value, onChange }: Props) {
  if (value.learning === 'off') return null
  return (
    <>
      <SettingsRow setting="intelligence.dailyReviews">
        <SettingsLabel title={t('Reviews per day')} help={t('Caps background reviews to limit token use.')} />
        <Dropdown
          label={t('Reviews per day')}
          value={String(value.dailyReviews)}
          options={withCurrent([1, 3, 5, 10, 20], value.dailyReviews).map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          onChange={(n) => onChange({ ...value, dailyReviews: Number(n) })}
        />
      </SettingsRow>
      <SettingsRow setting="intelligence.archiveSkillDays">
        <SettingsLabel
          title={t('Archive unused skills after')}
          help={t('Only skills Ramu created are archived. Pinned skills are kept.')}
        />
        <Dropdown
          label={t('Archive unused skills after')}
          value={String(value.archiveSkillDays)}
          options={withCurrent([30, 60, 90, 180, 365], value.archiveSkillDays).map((days) => ({
            value: String(days),
            label: t('{0} days', { 0: days }),
          }))}
          onChange={(days) => onChange({ ...value, archiveSkillDays: Number(days) })}
        />
      </SettingsRow>
    </>
  )
}

/**
 * The Memory page's tuning, folded under Advanced: how long unused memories and skills are kept, and how many learning
 * reviews run a day.
 */
export function MemoryAdvancedSettings({
  memory,
  intelligence,
  onMemory,
  onIntelligence,
}: {
  memory: MemoryPreferences
  intelligence: IntelligencePreferences
  onMemory: (value: MemoryPreferences) => void
  onIntelligence: (value: IntelligencePreferences) => void
}) {
  if (!memory.enabled && intelligence.learning === 'off') return null
  return (
    <div className="settings-form flex flex-col gap-0">
      <SettingsAdvanced>
        {memory.enabled && (
          <SettingsRow setting="memory.staleAfterDays">
            <SettingsLabel
              title={t('Archive unused memories after')}
              help={t(
                'Applies to project notes that were never used. Notes you wrote and essential memories are kept.',
              )}
            />
            <Dropdown
              label={t('Archive unused memories after')}
              value={String(memory.staleAfterDays)}
              options={[...new Set([30, 60, 90, 180, 365, memory.staleAfterDays])]
                .sort((a, b) => a - b)
                .map((days) => ({ value: String(days), label: t('{0} days', { 0: days }) }))}
              onChange={(days) => onMemory({ ...memory, staleAfterDays: Number(days) })}
            />
          </SettingsRow>
        )}
        <LearningLimitsSettings value={intelligence} onChange={onIntelligence} />
      </SettingsAdvanced>
    </div>
  )
}

/** The learning snapshot, refreshed whenever memory changes, with one guarded way to change it. */
function useLearning() {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const host = scope?.primaryId ?? ''
  const viewOnly = scope?.targets?.some((target) => target.viewOnly) ?? false
  const access = useRef({ host, viewOnly, version: 0 })
  if (access.current.host !== host || access.current.viewOnly !== viewOnly)
    access.current = { host, viewOnly, version: access.current.version + 1 }
  const reads = useRef(0)
  const [snapshot, setSnapshot] = useState<{ host: string; value: LearningSnapshot } | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    if (viewOnly || access.current.host !== host || access.current.viewOnly) return
    const version = access.current.version
    const request = ++reads.current
    try {
      const value = await invoke('learning.get')
      if (
        access.current.host === host &&
        access.current.version === version &&
        request === reads.current &&
        !access.current.viewOnly
      )
        setSnapshot({ host, value })
    } catch (reason) {
      if (access.current.host === host && access.current.version === version && request === reads.current) throw reason
    }
  }, [invoke, host, viewOnly])
  useEffect(() => {
    setBusy(false)
    if (viewOnly) return
    void reload().catch((e) => notifyError(errorText(e), 'Learning'))
    return on('memory:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload, on, viewOnly])
  const act = async (fn: () => Promise<unknown>) => {
    if (access.current.host !== host || access.current.viewOnly) return
    const version = access.current.version
    setBusy(true)
    try {
      await fn()
      if (access.current.version === version) await reload()
    } catch (e) {
      if (access.current.version === version) notifyError(errorText(e), 'Learning')
    } finally {
      if (access.current.version === version) setBusy(false)
    }
  }
  return { invoke, snapshot: snapshot?.host === host ? snapshot.value : null, busy, act, viewOnly }
}

export function LearningSettings({ value, onChange }: Props) {
  const { invoke, snapshot, busy, act, viewOnly } = useLearning()
  const reviews = snapshot?.jobs.filter((job) => {
    if (job.status !== 'applied' || !job.proposal || job.error) return true
    const change = JSON.parse(job.proposal) as { memories: unknown[]; skills: unknown[]; archive: unknown[] }
    return change.memories.length + change.skills.length + change.archive.length > 0
  })
  const [reviewStatus, setReviewStatus] = useState('all')
  const reviewView = useListView(reviews ?? [], {
    text: (job) => `${job.sessionTitle ?? ''} ${job.status} ${job.error ?? ''}`,
    match: (job) => reviewStatus === 'all' || job.status === reviewStatus,
    size: 10,
    filterKey: reviewStatus,
  })
  const pagedReviews = reviewView.paged
  const failedReviews = (reviews ?? []).filter((job) => job.status === 'failed')
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('Learning & skills')}</SettingsGroupTitle>
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <SettingsRow setting="intelligence.crossThreadRecall">
        <SettingsLabel
          title={t('Recall past conversations')}
          help={t(
            'Let agents search earlier threads across providers. Turning this off keeps your history and same-thread recall. Applies when a thread starts or restarts.',
          )}
        />
        <Switch
          aria-label={t('Recall past conversations')}
          checked={value.crossThreadRecall}
          onCheckedChange={(crossThreadRecall) => onChange({ ...value, crossThreadRecall })}
        />
      </SettingsRow>
      <SettingsRow setting="intelligence.learning">
        <SettingsLabel
          title={t('Automatic learning')}
          help={t('After a thread, look for lasting notes and reusable skills. Uses model tokens when idle.')}
        />
        <Dropdown
          label={t('Automatic learning')}
          value={value.learning}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'review', label: t('Ask me first') },
            { value: 'auto', label: t('Save automatically') },
          ]}
          onChange={(learning) => onChange({ ...value, learning: learning as IntelligencePreferences['learning'] })}
        />
      </SettingsRow>
      <Button
        disabled={viewOnly || busy || snapshot?.running || value.learning === 'off'}
        variant="secondary"
        className="bg-fill hover:bg-fill-hover self-start mt-3 mb-4"
        onClick={() => void act(() => invoke('learning.run'))}
      >
        {snapshot?.running ? t('Reviewing…') : t('Run learning maintenance')}
      </Button>
      <div className="flex flex-col gap-3">
        <ListToolbar
          view={reviewView}
          label={t('Search reviews')}
          filters={[
            {
              key: 'status',
              label: t('Status'),
              value: reviewStatus,
              options: [
                { value: 'all', label: t('All') },
                ...[...new Set((reviews ?? []).map((job) => job.status))].map((value) => ({ value, label: t(value) })),
              ],
              onChange: setReviewStatus,
            },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ListCount view={reviewView} />
          {failedReviews.length > 1 && (
            <span className="flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={viewOnly || busy}
                onClick={() =>
                  void act(async () => {
                    for (const job of failedReviews) await invoke('learning.retry', job.id)
                  })
                }
              >
                {t('Retry {count} failed', { count: failedReviews.length })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={viewOnly || busy}
                onClick={() =>
                  void act(async () => {
                    for (const job of failedReviews) await invoke('learning.dismiss', job.id)
                  })
                }
              >
                {t('Dismiss failed')}
              </Button>
            </span>
          )}
        </div>
        {reviewView.empty === 'filtered' && (
          <ListEmpty
            view={reviewView}
            none=""
            filtered="No reviews match your search."
            onReset={() => setReviewStatus('all')}
          />
        )}
        <SettingsCardList>
          {pagedReviews.shown.map((job) => (
            <SettingsCard
              key={job.id}
              title={
                <>
                  {t('Learning review')} · {t(job.status)}
                </>
              }
              meta={`${new Date(job.createdAt).toLocaleString()} · ${job.sessionTitle ?? t('Thread')}`}
              actions={
                <>
                  {job.status === 'pending' && (
                    <Button
                      disabled={viewOnly || busy}
                      variant="default"
                      size="sm"
                      className={PRIMARY_ACTION_CLASS}
                      onClick={() => void act(() => invoke('learning.apply', job.id))}
                    >
                      {t('Apply')}
                    </Button>
                  )}
                  {['pending', 'failed'].includes(job.status) && (
                    <Button
                      disabled={viewOnly || busy}
                      variant="ghost"
                      size="sm"
                      onClick={() => void act(() => invoke('learning.retry', job.id))}
                    >
                      {t('Retry review')}
                    </Button>
                  )}
                  {['queued', 'pending', 'failed'].includes(job.status) && (
                    <Button
                      disabled={viewOnly || busy}
                      variant="ghost"
                      size="sm"
                      onClick={() => void act(() => invoke('learning.dismiss', job.id))}
                    >
                      {t('Dismiss')}
                    </Button>
                  )}
                </>
              }
            >
              {job.error && (
                <p role="alert" className="m-0! line-clamp-2 text-caption text-bad" title={job.error}>
                  {t(readableJobError(job.error))}
                </p>
              )}
              {job.proposal && (
                <LearningProposal
                  proposal={job.proposal}
                  skills={snapshot?.skills ?? []}
                  showCheckpoint={job.status !== 'applied'}
                />
              )}
            </SettingsCard>
          ))}
          {pagedReviews.more}
        </SettingsCardList>
      </div>
    </div>
  )
}

const SKILL_STATUS_FILTERS = ['active', 'disabled', 'archived', 'all'] as const
type SkillStatusFilter = (typeof SKILL_STATUS_FILTERS)[number]
const SKILL_STATUS_LABELS: Record<SkillStatusFilter, string> = {
  active: 'Active',
  disabled: 'Disabled',
  archived: 'Archived',
  all: 'All',
}

/** The skills Ramu wrote itself, searchable and a page at a time; installed skills are managed above them. */
export function ManagedSkills() {
  const { invoke, snapshot, busy, act, viewOnly } = useLearning()
  const [status, setStatus] = useState<SkillStatusFilter>('active')
  const own = (snapshot?.skills ?? []).filter((skill) => !skill.installation)
  const view = useListView(own, {
    text: (skill) => `${skill.name} ${skill.description}`,
    match: (skill) => status === 'all' || skill.status === status,
    size: 10,
    filterKey: status,
  })
  const { setQuery } = view
  const [history, setHistory] = useState<ManagedSkill[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // A summary item that was clicked: show just that skill, then scroll to it and flash it.
  useEffect(() => {
    const take = () => {
      const item = takeLibraryFocus('skill')
      if (!item) return
      setQuery(item.title)
      setStatus('all')
      setFocusId(item.id)
    }
    take()
    window.addEventListener('ramu:library-focus', take)
    return () => window.removeEventListener('ramu:library-focus', take)
  }, [setQuery])
  useEffect(() => {
    if (!focusId || !snapshot) return
    const timer = window.setTimeout(() => {
      const card = document.getElementById(`skill-${focusId}`)
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      card?.classList.add('flash')
      window.setTimeout(() => card?.classList.remove('flash'), 1400)
      setFocusId(null)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [focusId, snapshot])
  const { paged } = view
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    void invoke('projects.list').then(setProjects, () => {})
  }, [invoke])
  return (
    <div className="settings-form flex flex-col gap-2">
      <SettingsSectionHead
        title={t('Ramu’s skills')}
        help={t('Learned from finished threads or written by you, for every provider. Each says where it applies.')}
      />
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      {/* Filters over an empty list only add noise; they appear once Ramu has a skill. */}
      {own.length > 0 && (
        <ListToolbar
          view={view}
          label={t('Search skills')}
          filters={[
            {
              key: 'status',
              label: t('Status'),
              value: status,
              options: SKILL_STATUS_FILTERS.map((value) => ({ value, label: t(SKILL_STATUS_LABELS[value]) })),
              onChange: (next) => setStatus(next as SkillStatusFilter),
            },
          ]}
        />
      )}
      <ListCount view={view} />
      {snapshot &&
        (own.length === 0 ? (
          <SettingsEmpty>
            {t('No skills yet. Ramu adds them here when it learns a repeatable procedure.')}
          </SettingsEmpty>
        ) : (
          <ListEmpty
            view={view}
            none="No skills yet. Ramu adds them here when it learns a repeatable procedure."
            filtered="No skills match your search."
            onReset={() => setStatus('active')}
          />
        ))}
      <SettingsCardList>
        {paged.shown.map((skill) => (
          <SettingsCard
            key={skill.id}
            id={`skill-${skill.id}`}
            className="[&.flash]:[animation:settings-flash_1.4s_ease-out]"
            title={skill.name}
            badges={
              <>
                <Badge variant="outline" title={t('Where agents can load it')}>
                  {skill.projectId
                    ? (projects.find((project) => project.id === skill.projectId)?.name ?? t('One project'))
                    : t('All projects')}
                </Badge>
                {skill.providers?.length ? (
                  <Badge variant="outline">
                    {skill.providers.map((provider) => providerName(provider)).join(', ')}
                  </Badge>
                ) : null}
                {skill.status !== 'active' && <Badge variant="secondary">{t(skill.status)}</Badge>}
                {skill.pinned && <Badge variant="outline">{t('Pinned')}</Badge>}
              </>
            }
            meta={[
              skill.description,
              skill.changedBy === 'user' && !skill.sourceSessionId ? t('Written by you') : t('Learned by Ramu'),
              t('Read {0} times', { 0: skill.useCount }),
            ]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <>
                {skillActions(skill).map((action) => (
                  <Button
                    key={action}
                    disabled={viewOnly || busy}
                    variant="ghost"
                    size="sm"
                    onClick={() => void act(() => invoke('learning.control', skill.id, action))}
                  >
                    {t(SKILL_ACTION_LABELS[action])}
                  </Button>
                ))}
                <Button
                  disabled={viewOnly || busy}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void act(async () => {
                      setSelected(skill.id)
                      setHistory(await invoke('learning.history', skill.id))
                    })
                  }
                >
                  {t('History')}
                </Button>
              </>
            }
          >
            <details className="text-caption">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('Procedure')}</summary>
              <pre className="whitespace-pre-wrap text-caption text-muted-foreground m-0 mt-2">{skill.content}</pre>
            </details>
            {selected === skill.id &&
              history.map((revision) => (
                <details key={revision.revision}>
                  <summary>{t('Revision {0}', { 0: revision.revision })}</summary>
                  <pre className="whitespace-pre-wrap text-caption">{revision.content}</pre>
                  <Button
                    disabled={viewOnly || busy || revision.revision === skill.revision}
                    variant="secondary"
                    className="bg-fill hover:bg-fill-hover"
                    onClick={() =>
                      void act(async () => {
                        await invoke('learning.revert', skill.id, revision.revision)
                        setHistory(await invoke('learning.history', skill.id))
                      })
                    }
                  >
                    {t('Restore revision')}
                  </Button>
                </details>
              ))}
          </SettingsCard>
        ))}
        {paged.more}
      </SettingsCardList>
      <MovedToCustomize
        section="skills"
        text={t('Skills you write or install, and the skills.sh directory, are in Customize → Skills.')}
      />
    </div>
  )
}

function LearningProposal({
  proposal,
  skills,
  showCheckpoint,
}: {
  proposal: string
  skills: ManagedSkill[]
  showCheckpoint: boolean
}) {
  const change = JSON.parse(proposal) as {
    checkpoint: string
    memories: { title: string; content: string; reason: string }[]
    skills: { id?: string; name: string; content: string; reason: string }[]
    archive: { id: string; absorbedInto: string; reason: string }[]
  }
  return (
    <details className="text-caption">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {t('Review proposed changes')}
      </summary>
      <div className="flex flex-col gap-3 max-h-96 overflow-auto py-2">
        {showCheckpoint && change.checkpoint && (
          <section>
            <strong>{t('Session checkpoint')}</strong>
            <p className="whitespace-pre-wrap text-caption">{change.checkpoint}</p>
          </section>
        )}
        {!showCheckpoint && change.checkpoint && (
          <p className="text-muted-foreground">{t('Saved checkpoints are available in their thread.')}</p>
        )}
        {change.memories.map((note, index) => (
          <section key={`memory-${index}`}>
            <strong>
              {t('Memory')}: {note.title}
            </strong>
            <p className="whitespace-pre-wrap text-caption">{note.content}</p>
            <p className="muted text-muted-foreground text-caption">{note.reason}</p>
          </section>
        ))}
        {change.skills.map((skill, index) => (
          <section key={`skill-${index}`}>
            <strong>
              {t('Procedure')}: {skill.name}
            </strong>
            <div className="grid grid-cols-2 gap-2 text-caption">
              <div>
                <strong>{t('Earlier revision')}</strong>
                <pre className="whitespace-pre-wrap">
                  {skills.find((entry) => entry.id === skill.id)?.content ?? t('No earlier text')}
                </pre>
              </div>
              <div>
                <strong>{t('Proposed revision')}</strong>
                <pre className="whitespace-pre-wrap">{skill.content}</pre>
              </div>
            </div>
            <p className="muted text-muted-foreground text-caption">{skill.reason}</p>
          </section>
        ))}
        {change.archive.map((item) => (
          <section key={item.id}>
            <strong>
              {t('Archive')}: {skills.find((entry) => entry.id === item.id)?.name ?? item.id} →{' '}
              {skills.find((entry) => entry.id === item.absorbedInto)?.name ?? item.absorbedInto}
            </strong>
            <p className="text-caption">{item.reason}</p>
          </section>
        ))}
      </div>
    </details>
  )
}
