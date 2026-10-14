import { useCallback, useEffect, useState } from 'react'
import { SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from './Menu'
import { t } from './i18n'
import { invoke, ramu } from './ipc'
import { notifyError } from './Notifications'
import { errorText } from './errors'
import { useModelSets, modelStepName } from './ModelSets'
import { RESPONSE_STYLES, RESPONSE_STYLE_LABELS, type IntelligencePreferences, type LearningSnapshot, type ManagedSkill } from '@ramu/shared/types'

type Props = { value: IntelligencePreferences; onChange: (value: IntelligencePreferences) => void }
export function IntelligenceSettings({ value, onChange }: Props) {
  return <>
    <SettingsRow><strong>{t('Response style')}</strong><Dropdown label={t('Response style')} value={value.responseStyle} options={RESPONSE_STYLES.map((style) => ({ value: style, label: t(RESPONSE_STYLE_LABELS[style]) }))} onChange={(style) => onChange({ ...value, responseStyle: style as IntelligencePreferences['responseStyle'] })} /></SettingsRow>
    {value.responseStyle === 'custom' && <>
      <SettingsRow><strong>{t('Custom style instructions')}</strong><Textarea aria-label={t('Custom style instructions')} value={value.responseInstructions} maxLength={4000} rows={4} onChange={(e) => onChange({ ...value, responseInstructions: e.target.value })} /></SettingsRow>
      <SettingsRow><span><strong>{t('Style skill name')}</strong><span className="muted text-muted-foreground block small text-caption">{t('Optional installed skill, matched by name in the chat scope.')}</span></span><Input aria-label={t('Style skill name')} value={value.responseSkill} maxLength={200} onChange={(e) => onChange({ ...value, responseSkill: e.target.value })} /></SettingsRow>
    </>}
    <SettingsRow><span><strong>{t('Input compression')}</strong><span className="muted text-muted-foreground block small text-caption">{t('Compact large Ramu tool results before the model reads them. Full output stays available on demand.')}</span></span><Dropdown label={t('Input compression')} value={value.compression} options={['off', 'balanced', 'aggressive'].map((mode) => ({ value: mode, label: t(mode === 'off' ? 'Off' : mode === 'balanced' ? 'Balanced' : 'Aggressive') }))} onChange={(mode) => onChange({ ...value, compression: mode as IntelligencePreferences['compression'] })} /></SettingsRow>
    <SettingsRow><span><strong>{t('Ramu tool search')}</strong><span className="muted text-muted-foreground block small text-caption">{t('Discover optional Ramu tools on demand. Changes apply to newly connected provider sessions.')}</span></span><Switch aria-label={t('Ramu tool search')} checked={value.toolSearch} onCheckedChange={(toolSearch) => onChange({ ...value, toolSearch })} /></SettingsRow>
    <SettingsRow><span><strong>{t('RTK command tool')}</strong><span className="muted text-muted-foreground block small text-caption">{t('Use an installed RTK binary through an explicit tool in full-access chats. Native shell commands are unchanged.')}</span></span><Switch aria-label={t('RTK command tool')} checked={value.rtk} onCheckedChange={(rtk) => onChange({ ...value, rtk })} /></SettingsRow>
    <p className="muted text-muted-foreground small text-caption">{t('Styles apply on the next turn. Native provider tools and compaction remain controlled by the provider.')}</p>
  </>
}

export function LearningSettings({ value, onChange }: Props) {
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<ManagedSkill[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const models = useModelSets()
  const steps = models.preferences.sets.flatMap((set) => set.steps)
  const reload = useCallback(() => invoke('learning.get').then(setSnapshot), [])
  useEffect(() => { void reload().catch((e) => notifyError(errorText(e), 'Learning')); return ramu.on('memory:changed', () => { void reload().catch(() => {}) }) }, [reload])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await reload() } catch (e) { notifyError(errorText(e), 'Learning') } finally { setBusy(false) } }
  const modelId = steps.find((step) => step.provider === value.maintenanceModel?.provider && step.model === value.maintenanceModel.model && step.effort === value.maintenanceModel.effort)?.id ?? ''
  return <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 mt-6">
    <h4 className="settings-group-title m-[4px_0_10px] text-caption font-medium text-muted-foreground">{t('Learning & skills')}</h4>
    <SettingsRow><span><strong>{t('Automatic learning')}</strong><span className="muted text-muted-foreground block small text-caption">{t('Review completed work for durable memories and reusable skills. Uses model tokens while idle.')}</span></span><Dropdown label={t('Automatic learning')} value={value.learning} options={[{ value: 'off', label: t('Off') }, { value: 'review', label: t('Review first') }, { value: 'auto', label: t('Automatic') }]} onChange={(learning) => onChange({ ...value, learning: learning as IntelligencePreferences['learning'] })} /></SettingsRow>
    <SettingsRow><strong>{t('Maintenance model')}</strong><Dropdown label={t('Maintenance model')} value={modelId} options={[{ value: '', label: t('Use chat model') }, ...steps.map((step) => ({ value: step.id, label: modelStepName(step, models.catalogs) }))]} onChange={(id) => { const step = steps.find((step) => step.id === id); onChange({ ...value, maintenanceModel: step ? { provider: step.provider, model: step.model, effort: step.effort } : null }) }} /></SettingsRow>
    <SettingsRow><strong>{t('Maximum reviews per day')}</strong><Input type="number" min={1} max={50} aria-label={t('Maximum reviews per day')} value={value.dailyReviews} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 50) onChange({ ...value, dailyReviews: n }) }} /></SettingsRow>
    <SettingsRow><strong>{t('Archive unused skills after')}</strong><Input type="number" min={7} max={3650} aria-label={t('Archive unused skills after')} value={value.archiveSkillDays} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 7 && n <= 3650) onChange({ ...value, archiveSkillDays: n }) }} /></SettingsRow>
    <p className="muted text-muted-foreground small text-caption mt-3 mb-3">{t('Only Ramu-generated skills are maintained. Pinned skills are protected. Installed skills remain managed by their original source.')}</p>
    <Button disabled={busy || snapshot?.running || value.learning === 'off'} variant="secondary" className="bg-fill hover:bg-fill-hover self-start mb-4" onClick={() => void act(() => invoke('learning.run'))}>{snapshot?.running ? t('Reviewing…') : t('Run learning maintenance')}</Button>
    {snapshot?.jobs.slice(0, 30).map((job) => <article key={job.id} className="bg-card rounded-(--radius-m) p-3 mb-2 flex flex-col gap-2">
      <strong className="font-medium">{t('Learning review')} · {t(job.status)}</strong><p className="muted text-muted-foreground small text-caption m-0!">{new Date(job.createdAt).toLocaleString()} · {job.sessionTitle ?? t('Chat')}</p>
      {job.error && <p role="alert" className="text-bad small text-caption m-0!">{job.error}</p>}
      {job.proposal && <LearningProposal proposal={job.proposal} skills={snapshot.skills} />}
      <div className="flex gap-2 flex-wrap">{job.status === 'pending' && <Button disabled={busy} variant="default" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover" onClick={() => void act(() => invoke('learning.apply', job.id))}>{t('Apply')}</Button>}
      {['pending', 'failed'].includes(job.status) && <Button disabled={busy} variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => void act(() => invoke('learning.retry', job.id))}>{t('Retry review')}</Button>}
      {['queued', 'pending', 'failed'].includes(job.status) && <Button disabled={busy} variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => void act(() => invoke('learning.dismiss', job.id))}>{t('Dismiss')}</Button>}</div>
    </article>)}
    <h4 className="settings-group-title m-[4px_0_10px] text-caption font-medium text-muted-foreground mt-5!">{t('Managed skills')}</h4>
    {!snapshot?.skills.length && <p className="muted text-muted-foreground small text-caption py-6 text-center">{t('No managed skills yet.')}</p>}
    {snapshot?.skills.map((skill) => <article key={skill.id} className="bg-card rounded-(--radius-m) p-3 mb-2 flex flex-col gap-2">
      <strong className="font-medium">{skill.name} · {t(skill.status)}{skill.pinned ? ` · ${t('Pinned')}` : ''}</strong><p className="muted text-muted-foreground small text-caption m-0!">{skill.description} · {t('Read {0} times', { 0: skill.useCount })}</p>
      <details className="text-caption"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('Procedure')}</summary><pre className="whitespace-pre-wrap text-caption text-muted-foreground m-0 mt-2">{skill.content}</pre></details>
      <div className="flex gap-2 flex-wrap">{(['pin', 'unpin', 'disable', 'archive', 'restore'] as const).filter((action) => action === 'pin' ? !skill.pinned : action === 'unpin' ? skill.pinned : action === 'restore' ? skill.status !== 'active' : skill.status === 'active').map((action) => <Button key={action} disabled={busy} variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => void act(() => invoke('learning.control', skill.id, action))}>{t(({ pin: 'Pin', unpin: 'Unpin', disable: 'Disable', archive: 'Archive', restore: 'Restore' })[action])}</Button>)}
      <Button disabled={busy} variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => void act(async () => { setSelected(skill.id); setHistory(await invoke('learning.history', skill.id)) })}>{t('History')}</Button></div>
      {selected === skill.id && history.map((revision) => <details key={revision.revision}><summary>{t('Revision {0}', { 0: revision.revision })}</summary><pre className="whitespace-pre-wrap text-caption">{revision.content}</pre><Button disabled={busy || revision.revision === skill.revision} variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => void act(async () => { await invoke('learning.revert', skill.id, revision.revision); setHistory(await invoke('learning.history', skill.id)) })}>{t('Restore revision')}</Button></details>)}
    </article>)}
  </div>
}

function LearningProposal({ proposal, skills }: { proposal: string; skills: ManagedSkill[] }) {
  const change = JSON.parse(proposal) as { checkpoint: string; memories: { title: string; content: string; reason: string }[]; skills: { id?: string; name: string; content: string; reason: string }[]; archive: { id: string; absorbedInto: string; reason: string }[] }
  return <details className="text-caption"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('Review proposed changes')}</summary><div className="flex flex-col gap-3 max-h-96 overflow-auto py-2">
    {change.checkpoint && <section><strong>{t('Session checkpoint')}</strong><p className="whitespace-pre-wrap text-caption">{change.checkpoint}</p></section>}
    {change.memories.map((note, index) => <section key={`memory-${index}`}><strong>{t('Memory')}: {note.title}</strong><p className="whitespace-pre-wrap text-caption">{note.content}</p><p className="muted text-caption">{note.reason}</p></section>)}
    {change.skills.map((skill, index) => <section key={`skill-${index}`}><strong>{t('Procedure')}: {skill.name}</strong><div className="grid grid-cols-2 gap-2 text-caption"><div><strong>{t('Earlier revision')}</strong><pre className="whitespace-pre-wrap">{skills.find((entry) => entry.id === skill.id)?.content ?? t('No earlier text')}</pre></div><div><strong>{t('Proposed revision')}</strong><pre className="whitespace-pre-wrap">{skill.content}</pre></div></div><p className="muted text-caption">{skill.reason}</p></section>)}
    {change.archive.map((item) => <section key={item.id}><strong>{t('Archive')}: {skills.find((entry) => entry.id === item.id)?.name ?? item.id} → {skills.find((entry) => entry.id === item.absorbedInto)?.name ?? item.absorbedInto}</strong><p className="text-caption">{item.reason}</p></section>)}
  </div></details>
}
