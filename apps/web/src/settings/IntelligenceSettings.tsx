import { InstalledSkills } from './InstalledSkills'
import { useSettingsInvoke } from './SettingsScope'
import { useCallback, useEffect, useState } from 'react'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { useModelSets, modelStepName } from '../models/ModelSets'
import { takeLibraryFocus } from '../summaries/libraryFocus'
import { type IntelligencePreferences, type LearningSnapshot, type ManagedSkill } from '@ramu/shared/types'

type Props = { value: IntelligencePreferences; onChange: (value: IntelligencePreferences) => void }
const withCurrent = (values: number[], current: number) => [...new Set([...values, current])].sort((a, b) => a - b)

export function EfficiencySettings({ value, onChange }: Props) {
  return (
    <>
      <SettingsGroupTitle>{t('Token efficiency')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.compression">
        <SettingsLabel
          title={t('Tool output compression')}
          help={t(
            'Shorten large tool results before the model reads them. The full output stays available on request.',
          )}
        />
        <Dropdown
          label={t('Tool output compression')}
          value={value.compression}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'balanced', label: t('Balanced (recommended)') },
            { value: 'aggressive', label: t('Aggressive') },
          ]}
          onChange={(mode) => onChange({ ...value, compression: mode as IntelligencePreferences['compression'] })}
        />
      </SettingsRow>
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
  const models = useModelSets()
  const steps = models.preferences.sets.flatMap((set) => set.steps)
  const modelId =
    steps.find(
      (step) =>
        step.provider === value.maintenanceModel?.provider &&
        step.model === value.maintenanceModel.model &&
        step.effort === value.maintenanceModel.effort,
    )?.id ?? ''
  if (value.learning === 'off' && !cleanup) return null
  return (
    <div className="settings-form flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('Background model')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.maintenanceModel">
        <SettingsLabel
          title={t('Model for background maintenance')}
          help={t('Used for learning reviews and memory cleanup. A cheaper model keeps token use low.')}
        />
        <Dropdown
          label={t('Model for background maintenance')}
          value={modelId}
          options={[
            { value: '', label: t('Same as thread') },
            ...steps.map((step) => ({ value: step.id, label: modelStepName(step, models.catalogs) })),
          ]}
          onChange={(id) => {
            const step = steps.find((step) => step.id === id)
            onChange({
              ...value,
              maintenanceModel: step ? { provider: step.provider, model: step.model, effort: step.effort } : null,
            })
          }}
        />
      </SettingsRow>
    </div>
  )
}

/** Limits on background learning; shown inside the Memory page's Advanced group. */
export function LearningLimitsSettings({ value, onChange }: Props) {
  if (value.learning === 'off') return null
  return (
    <>
      <SettingsRow setting="intelligence.dailyReviews">
        <SettingsLabel title={t('Reviews per day')} help={t('Upper limit on background reviews, to cap token use.')} />
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

export function LearningSettings({ value, onChange }: Props) {
  const invoke = useSettingsInvoke()
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<ManagedSkill[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const reload = useCallback(() => invoke('learning.get').then(setSnapshot), [])
  // A summary item that was clicked: scroll to the skill and flash it.
  useEffect(() => {
    const take = () => {
      const item = takeLibraryFocus('skill')
      if (!item) return
      window.setTimeout(() => {
        const card = document.getElementById(`skill-${item.id}`)
        card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        card?.classList.add('flash')
        window.setTimeout(() => card?.classList.remove('flash'), 1400)
      }, 150)
    }
    take()
    window.addEventListener('ramu:library-focus', take)
    return () => window.removeEventListener('ramu:library-focus', take)
  }, [snapshot?.skills.length])
  useEffect(() => {
    void reload().catch((e) => notifyError(errorText(e), 'Learning'))
    return ramu.on('memory:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload])
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e) {
      notifyError(errorText(e), 'Learning')
    } finally {
      setBusy(false)
    }
  }
  const reviews = snapshot?.jobs.filter((job) => {
    if (job.status !== 'applied' || !job.proposal || job.error) return true
    const change = JSON.parse(job.proposal) as { memories: unknown[]; skills: unknown[]; archive: unknown[] }
    return change.memories.length + change.skills.length + change.archive.length > 0
  })
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('Learning & skills')}</SettingsGroupTitle>
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
            { value: 'auto', label: t('Save automatically (recommended)') },
          ]}
          onChange={(learning) => onChange({ ...value, learning: learning as IntelligencePreferences['learning'] })}
        />
      </SettingsRow>
      <Button
        disabled={busy || snapshot?.running || value.learning === 'off'}
        variant="secondary"
        className="bg-fill hover:bg-fill-hover self-start mb-4 mt-1"
        onClick={() => void act(() => invoke('learning.run'))}
      >
        {snapshot?.running ? t('Reviewing…') : t('Run learning maintenance')}
      </Button>
      {reviews?.slice(0, 30).map((job) => (
        <article key={job.id} className="bg-card rounded-(--radius-m) p-3 mb-2 flex flex-col gap-2">
          <strong className="font-medium">
            {t('Learning review')} · {t(job.status)}
          </strong>
          <p className="muted text-muted-foreground small text-caption m-0!">
            {new Date(job.createdAt).toLocaleString()} · {job.sessionTitle ?? t('Thread')}
          </p>
          {job.error && (
            <p role="alert" className="text-bad small text-caption m-0!">
              {job.error}
            </p>
          )}
          {job.proposal && (
            <LearningProposal
              proposal={job.proposal}
              skills={snapshot?.skills ?? []}
              showCheckpoint={job.status !== 'applied'}
            />
          )}
          <div className="flex gap-2 flex-wrap">
            {job.status === 'pending' && (
              <Button
                disabled={busy}
                variant="default"
                className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover"
                onClick={() => void act(() => invoke('learning.apply', job.id))}
              >
                {t('Apply')}
              </Button>
            )}
            {['pending', 'failed'].includes(job.status) && (
              <Button
                disabled={busy}
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                onClick={() => void act(() => invoke('learning.retry', job.id))}
              >
                {t('Retry review')}
              </Button>
            )}
            {['queued', 'pending', 'failed'].includes(job.status) && (
              <Button
                disabled={busy}
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                onClick={() => void act(() => invoke('learning.dismiss', job.id))}
              >
                {t('Dismiss')}
              </Button>
            )}
          </div>
        </article>
      ))}
      <InstalledSkills />
      <SettingsGroupTitle className="mt-5!">{t('Managed skills')}</SettingsGroupTitle>
      {!snapshot?.skills.length && (
        <p className="muted text-muted-foreground small text-caption py-6 text-center">
          {t('No skills yet. Ramu adds them here when it learns a repeatable procedure.')}
        </p>
      )}
      {snapshot?.skills
        .filter((skill) => !skill.installation)
        .map((skill) => (
          <article
            key={skill.id}
            id={`skill-${skill.id}`}
            className="[&.flash]:[animation:settings-flash_1.4s_ease-out] bg-card rounded-(--radius-m) p-3 mb-2 flex flex-col gap-2"
          >
            <strong className="font-medium">
              {skill.name} · {t(skill.status)}
              {skill.pinned ? ` · ${t('Pinned')}` : ''}
            </strong>
            <p className="muted text-muted-foreground small text-caption m-0!">
              {skill.description} · {t('Read {0} times', { 0: skill.useCount })}
            </p>
            <details className="text-caption">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('Procedure')}</summary>
              <pre className="whitespace-pre-wrap text-caption text-muted-foreground m-0 mt-2">{skill.content}</pre>
            </details>
            <div className="flex gap-2 flex-wrap">
              {(['pin', 'unpin', 'disable', 'archive', 'restore'] as const)
                .filter((action) =>
                  action === 'pin'
                    ? !skill.pinned
                    : action === 'unpin'
                      ? skill.pinned
                      : action === 'restore'
                        ? skill.status !== 'active'
                        : skill.status === 'active',
                )
                .map((action) => (
                  <Button
                    key={action}
                    disabled={busy}
                    variant="secondary"
                    className="bg-fill hover:bg-fill-hover"
                    onClick={() => void act(() => invoke('learning.control', skill.id, action))}
                  >
                    {t(
                      { pin: 'Pin', unpin: 'Unpin', disable: 'Disable', archive: 'Archive', restore: 'Restore' }[
                        action
                      ],
                    )}
                  </Button>
                ))}
              <Button
                disabled={busy}
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                onClick={() =>
                  void act(async () => {
                    setSelected(skill.id)
                    setHistory(await invoke('learning.history', skill.id))
                  })
                }
              >
                {t('History')}
              </Button>
            </div>
            {selected === skill.id &&
              history.map((revision) => (
                <details key={revision.revision}>
                  <summary>{t('Revision {0}', { 0: revision.revision })}</summary>
                  <pre className="whitespace-pre-wrap text-caption">{revision.content}</pre>
                  <Button
                    disabled={busy || revision.revision === skill.revision}
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
          </article>
        ))}
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
