import { ContentSkeleton } from '@/components/content-skeleton'
import { errorText } from './errors'
import { SettingsRow } from '@/components/settings-row'
import { t, useLanguage, formatLocale } from './i18n'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { systemTimezone } from '@ramu/shared/timezone'
import { Badge } from '@/components/ui/badge'
import { Dropdown } from './Menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { CalendarClock, Check, Clock, Pause, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { NO_PROJECT, type Schedule, type ScheduleInput, type ScheduleRule, type ScheduleRun, type RecapSnapshot, type BackgroundStatus } from '@ramu/shared/types'
import { AgentControls } from './AgentControls'
import { useModelSets } from './ModelSets'
import { useAppSettings } from './AppSettings'
import { useWorkspace } from './workspace'
import { invoke, ramu } from './ipc'
import { notifyError } from './Notifications'

export function formatScheduleTime(at: number | null, zone: string): string { return at === null ? t('No upcoming run') : DateTime.fromMillis(at, { zone, locale: formatLocale() }).toFormat('ccc, LLL d · HH:mm ZZZZ') }
export function useSchedules() {
  useLanguage()
  const [schedules, setSchedules] = useState<Schedule[]>([]), [runs, setRuns] = useState<ScheduleRun[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => { try { const [s, r] = await Promise.all([invoke('schedules.list'), invoke('schedules.runs')]); setSchedules(s); setRuns(r) } finally { setLoading(false) } }, [])
  useEffect(() => {
    void reload().catch((e) => notifyError(errorText(e), 'Schedules'))
    const off = ramu.on('automation:changed', () => { void reload().catch(() => {}) })
    return off
  }, [reload])
  return { schedules, runs, reload, loading }
}
export function ScheduleNavigation() {
  useLanguage()
  const { schedules, loading } = useSchedules()
  const select = (id?: string) => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id } }))
  return <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px]"><Button variant="secondary" className="bg-fill hover:bg-fill-hover nav-btn [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.active]:bg-accent [&.active]:text-foreground relative overflow-visible [&_.activity-badge]:[position:static] [&_.activity-badge]:ml-auto [&_.activity-badge]:[box-shadow:none] w-full bg-transparent [border:none] rounded-(--radius-row) text-soft gap-[9px] min-h-8 p-[5px_8px] justify-start" onClick={() => select()}><Plus size={15} />{t("New schedule")}</Button><div className="section-head [.review-inbox_>_&]:gap-2 [&_button.small-icon]:mr-0 flex items-center justify-between text-control text-muted-foreground p-[5px_8px]">{t("Schedules")}</div>{schedules.map((s) => <Button variant="secondary" className="schedule-nav flex h-auto min-h-8 w-full items-start justify-start gap-[9px] rounded-(--radius-row) bg-transparent px-2 py-1.5 text-left font-normal text-soft [border:0] [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground dark:hover:bg-hover [&_>_svg]:mt-[2px] [&_>_svg]:shrink-0 [&_>_svg]:text-muted-foreground [&_>_span]:min-w-0 [&_>_span]:flex-1 [&_>_span]:overflow-hidden [&_>_span]:text-ellipsis [&_>_span]:whitespace-nowrap" key={s.id} onClick={() => select(s.id)}><CalendarClock size={15} /><span><span className="block truncate text-control text-foreground">{s.name}</span><span className="muted text-muted-foreground small text-caption block truncate">{s.state === 'active' ? formatScheduleTime(s.nextRunAt, s.timezone) : t(s.state)}</span></span></Button>)}{loading && <ContentSkeleton />}{!loading && !schedules.length && <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">{t("Choose when to run this task.")}</p>}</div>
}
export function SchedulesPage({ createRequested = false, onCreateHandled }: { createRequested?: boolean; onCreateHandled?: () => void }) {
  useLanguage()
  const ws = useWorkspace(), { schedules, runs, reload, loading } = useSchedules()
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!createRequested) return
    setSelected(null); setEditing('new'); onCreateHandled?.()
  }, [createRequested, onCreateHandled])
  useEffect(() => {
    const select = (e: Event) => { const id = (e as CustomEvent).detail?.id; setSelected(id ?? null); setEditing(id ? schedules.find((s) => s.id === id) ?? null : 'new') }
    window.addEventListener('ramu:schedule', select); return () => window.removeEventListener('ramu:schedule', select)
  }, [schedules])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await reload() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  const openRun = async (run: ScheduleRun) => {
    if (!run.taskId) return
    await ws.refresh(); ws.openTask(run.taskId)
    if (run.sessionId) ws.openView(run.taskId, { kind: 'agent', sessionId: run.sessionId })
  }
  return <div className="automation-page w-full h-full overflow-auto p-[28px_clamp(20px,_4vw,_48px)]"><div className="mx-auto w-full max-w-[820px]"><header className="automation-heading [&_h1]:text-heading [&_h1]:font-semibold [&_h1]:tracking-[-0.01em] [&_h1]:m-[0_0_4px] [&_p]:m-0 [&_p]:text-control flex items-center justify-between gap-5 mb-6"><div><h1>{t("Schedules")}</h1><p className="muted text-muted-foreground">{t("Agents run in the background, even when Ramu is closed.")}</p></div><Button variant="default" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" onClick={() => setEditing('new')}><Plus size={14} />{t("New schedule")}</Button></header>
    {error && <p className="error text-bad" role="alert">{error}</p>}
    {editing && <ScheduleEditor key={editing === 'new' ? 'new' : editing.id} schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
    {!editing && loading && <ContentSkeleton variant="cards" rows={3} />}
    {!editing && !loading && !schedules.length && <Empty className="automation-empty"><EmptyHeader><EmptyMedia variant="icon"><CalendarClock /></EmptyMedia><EmptyTitle>{t("Let an agent handle it later")}</EmptyTitle><EmptyDescription>{t("Schedule a task once or at regular intervals.")}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setEditing('new')}>{t("Create your first schedule")}</Button></EmptyContent></Empty>}
    {!editing && schedules.map((s) => <section className={`schedule-card [&.selected]:[border-color:var(--line-strong)] p-4 [border:1px_solid_var(--line)] rounded-(--radius-m) mb-3 bg-fill${selected === s.id ? ' selected' : ''}`} key={s.id}>
      <div className="schedule-card-title [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:m-0 flex items-center gap-2"><h2>{s.name}</h2><Badge variant="outline" className="chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap">{t(s.state)}</Badge><span className="grow flex-1 min-w-0 text-left" /><Button variant="secondary" className="bg-fill hover:bg-fill-hover" disabled={busy} onClick={() => setEditing(s)}>Edit</Button><Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={t("Run {0} now", { "0": s.name })} title={t("Run now")} disabled={busy} onClick={() => void act(() => invoke('schedules.runNow', s.id))}><Play size={14} /></Button>{s.state !== 'completed' && <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={`${s.state === 'paused' ? t('Resume') : t('Pause')} ${s.name}`} disabled={busy} onClick={() => void act(() => invoke('schedules.pause', s.id, s.state !== 'paused'))}>{s.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}</Button>}<Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={t("Delete {0}", { "0": s.name })} disabled={busy} onClick={() => { if (confirm(t('Delete “{name}”? Its run chats will remain.', { name: s.name }))) void act(() => invoke('schedules.delete', s.id)) }}><Trash2 size={14} /></Button></div>
      <p className="schedule-prompt whitespace-pre-wrap leading-[1.5] m-[14px_0_10px]">{s.prompt}</p><div className="muted text-muted-foreground small text-caption">{s.projectId === NO_PROJECT ? t("No project") : ws.projects.find((p) => p.id === s.projectId)?.name ?? t("Unavailable project")}{s.workspaceId && ` · ${ws.workspaces.find((w) => w.id === s.workspaceId)?.name ?? 'Isolated workspace'}`} · {s.rule.kind === 'once' ? t("Once") : t(s.rule.kind)} · {s.timezone}</div><p className="schedule-next flex items-center gap-2 m-[12px_0] text-caption"><Clock size={13} />{formatScheduleTime(s.nextRunAt, s.timezone)}</p>
      {s.sourceTaskId && ws.tasks.some((t) => t.id === s.sourceTaskId) && <Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={() => ws.openTask(s.sourceTaskId!)}>{t("Open originating chat")}</Button>}
      {runs.some((r) => r.scheduleId === s.id) && <div className="schedule-history [border-top:1px_solid_var(--line)] pt-3 mt-3"><strong className="small text-caption">{t("Recent runs")}</strong>{runs.filter((r) => r.scheduleId === s.id).slice(0, 10).map((r) => <div className="schedule-run [&_.chip]:min-w-[70px] [&_.chip]:text-center flex gap-2 p-[9px_0] items-start" key={r.id}><span className={`chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap run-${r.status} [&.run-failed]:text-bad [&.run-interrupted]:text-bad [&.run-needs-input]:text-warn [&.run-completed]:text-ok`}>{t(r.status)}</span><span className="small text-caption grow flex-1 min-w-0 text-left">{formatScheduleTime(r.dueAt, s.timezone)}{r.error && <span className="muted text-muted-foreground block block">{r.error}</span>}{r.retryAt && <span className="muted text-muted-foreground block block">{t("Retry: ")}{formatScheduleTime(r.retryAt, s.timezone)}</span>}</span>{r.taskId && <Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={() => void openRun(r)}>{t("Open chat")}</Button>}</div>)}</div>}
    </section>)}
  </div></div>
}
function ScheduleEditor({ schedule, onClose, onSaved }: { schedule?: Schedule; onClose: () => void; onSaved: () => void }) {
  useLanguage()
  const ws = useWorkspace(), { initialSettings } = useModelSets()
  const [input, setInput] = useState<ScheduleInput>(() => schedule ?? { name: '', prompt: '', projectId: ws.ui.activeTaskId ? ws.projectOf(ws.ui.activeTaskId)?.id ?? NO_PROJECT : NO_PROJECT, workspaceId: null, timezone: systemTimezone(), rule: { kind: 'daily', time: '09:00' }, missedPolicy: 'latest', settings: initialSettings })
  const [previewLoading, setPreviewLoading] = useState(true)
  const [preview, setPreview] = useState<number[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [onceLocal, setOnceLocal] = useState(() => DateTime.fromISO(schedule?.rule.kind === 'once' ? schedule.rule.at : DateTime.now().plus({ hours: 1 }).toISO()!, { zone: input.timezone }).toFormat("yyyy-MM-dd'T'HH:mm"))
  useEffect(() => { let disposed = false; setPreviewLoading(true); const timer = setTimeout(() => { void invoke('schedules.preview', input.rule, input.timezone).then((dates) => { if (!disposed) { setPreview(dates); setPreviewLoading(false); setError(null) } }, (e) => { if (!disposed) { setPreview([]); setPreviewLoading(false); setError(errorText(e)) } }) }, 200); return () => { disposed = true; clearTimeout(timer) } }, [input.rule, input.timezone])
  const rule = input.rule
  const setRule = (rule: ScheduleRule) => setInput((i) => ({ ...i, rule }))
  const once = (value: string, zone = input.timezone) => DateTime.fromISO(value, { zone }).toISO() ?? value
  const save = async () => { setBusy(true); setError(null); try { await invoke('schedules.save', input, schedule?.id); onSaved() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  return <section className="schedule-editor p-5 [border:1px_solid_var(--line)] rounded-(--radius-m) mb-4 bg-fill"><div className="schedule-card-title [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:m-0 flex items-center gap-2"><h2>{schedule ? t("Edit schedule") : t("New schedule")}</h2><span className="grow flex-1 min-w-0 text-left" /><Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={t("Close schedule editor")} onClick={onClose} disabled={busy}><X size={15} /></Button></div><fieldset disabled={busy} className="schedule-form [&_label]:flex [&_label]:flex-col [&_label]:gap-[7px] [&_label]:text-caption [&_input]:w-full [&_input]:p-[9px_10px] [&_input]:rounded-(--radius-s) [&_input]:[border:1px_solid_transparent] [&_input]:[background:var(--field)] [&_input]:text-inherit [&_input]:[font:inherit] [&_select]:w-full [&_select]:p-[9px_10px] [&_select]:rounded-(--radius-s) [&_select]:[border:1px_solid_transparent] [&_select]:[background:var(--field)] [&_select]:text-inherit [&_select]:[font:inherit] [&_textarea]:w-full [&_textarea]:p-[9px_10px] [&_textarea]:rounded-(--radius-s) [&_textarea]:[border:1px_solid_transparent] [&_textarea]:[background:var(--field)] [&_textarea]:text-inherit [&_textarea]:[font:inherit] [&_textarea]:resize-y [&_textarea]:leading-[1.5] [&_[data-slot='select-trigger']]:p-[9px_10px] [&_[data-slot='select-trigger']]:[background:var(--field)] [&_[data-slot='select-trigger']]:h-auto [border:0] p-0 mt-4 grid gap-4 min-w-0 grid-cols-1 min-[640px]:grid-cols-2 [&_>_*]:min-w-0 [&_>_:is(.schedule-wide,_.schedule-form-row,_.schedule-weekdays,_.schedule-preview,_p,_.error,_.schedule-form-actions)]:col-span-full">
    <label className="schedule-wide col-span-full">{t("Name")}<Input value={input.name} maxLength={200} placeholder={t("Morning project check")} onChange={(e) => setInput({ ...input, name: e.target.value })} /></label>
    <label className="schedule-wide col-span-full">{t("What should the agent do?")}<Textarea rows={3} maxLength={100000} value={input.prompt} placeholder={t("Review unfinished work and identify the next useful action.")} onChange={(e) => setInput({ ...input, prompt: e.target.value })} /></label>
    <div className="schedule-form-row grid [grid-template-columns:1fr_1fr] gap-4"><label>{t("Scope")}<Dropdown label={t("Scope")} value={input.projectId} onChange={(projectId) => setInput({ ...input, projectId, workspaceId: null })} options={[{ value: NO_PROJECT, label: t("No project") }, ...ws.projects.map((p) => ({ value: p.id, label: p.name }))]} /></label>{input.projectId !== NO_PROJECT && <label>Checkout<Dropdown label="Checkout" value={input.workspaceId ?? ''} onChange={(workspaceId) => setInput({ ...input, workspaceId: workspaceId || null })} options={[{ value: '', label: t("Current checkout") }, ...ws.workspaces.filter((w) => w.projectId === input.projectId).map((w) => ({ value: w.id, label: w.name }))]} /></label>}</div>
    <div className="contents"><label>{t("Frequency")}<Dropdown label={t("Frequency")} value={rule.kind} onChange={(kind) => setRule(kind === 'once' ? { kind, at: once(onceLocal) } : kind === 'weekly' ? { kind, time: '09:00', weekdays: [1, 2, 3, 4, 5] } : kind === 'monthly' ? { kind, time: '09:00', day: 1 } : kind === 'interval' ? { kind, minutes: 60, anchor: DateTime.now().plus({ hours: 1 }).toISO()! } : { kind: 'daily', time: '09:00' })} options={['once', 'daily', 'weekly', 'monthly', 'interval'].map((value) => ({ value, label: value === 'interval' ? t("Every interval") : t(value[0]!.toUpperCase() + value.slice(1)) }))} /></label></div>
    {rule.kind === 'once' && <label>{t("Run at")}<Input type="datetime-local" value={onceLocal} onChange={(e) => { setOnceLocal(e.target.value); setRule({ kind: 'once', at: once(e.target.value) }) }} /></label>}
    {'time' in rule && <label>{t("Time")}<Input type="time" value={rule.time} onChange={(e) => setRule({ ...rule, time: e.target.value })} /></label>}
    {rule.kind === 'weekly' && <div className="schedule-weekdays [&_label]:flex-row [&_label]:items-center [&_input]:w-auto flex gap-3" aria-label={t("Days of the week")}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => <label key={day}><Checkbox checked={rule.weekdays.includes(i + 1)} onCheckedChange={(checked) => setRule({ ...rule, weekdays: checked === true ? [...rule.weekdays, i + 1] : rule.weekdays.filter((d) => d !== i + 1) })} />{day}</label>)}</div>}
    {rule.kind === 'monthly' && <label>{t("Day of month")}<Input type="number" min={1} max={31} value={rule.day} onChange={(e) => setRule({ ...rule, day: Number(e.target.value) })} /><span className="muted text-muted-foreground small text-caption">{t("Months without this day are skipped.")}</span></label>}
    {rule.kind === 'interval' && <label>{t("Every how many minutes?")}<Input type="number" min={5} value={rule.minutes} onChange={(e) => setRule({ ...rule, minutes: Number(e.target.value) })} /></label>}
    <label className="schedule-wide col-span-full">{t("If the computer is asleep or the service is stopped")}<Dropdown label={t("Missed runs")} value={input.missedPolicy} onChange={(missedPolicy) => setInput({ ...input, missedPolicy: missedPolicy as 'latest' | 'skip' })} options={[{ value: 'latest', label: t("Run the latest missed occurrence once") }, { value: 'skip', label: t("Skip missed occurrences") }]} /></label>
    <div className="schedule-wide col-span-full"><AgentControls settings={input.settings} onChange={(settings) => setInput({ ...input, settings })} disabled={busy} /></div>
    <div className="schedule-preview grid gap-[7px] [background:var(--field)] rounded-(--radius-s) p-3"><strong className="small text-caption">{t("Upcoming runs")}</strong>{preview.map((at) => <div className="muted text-muted-foreground small text-caption" key={at}>{formatScheduleTime(at, input.timezone)}</div>)}{previewLoading && <ContentSkeleton rows={3} />}{!previewLoading && !preview.length && <div className="muted text-muted-foreground small text-caption">{t("Choose a valid future time.")}</div>}</div><p className="muted text-muted-foreground small text-caption">{t("New schedules use your system timezone. Saved schedules keep their original timezone.")}</p>
    {error && <div className="error text-bad small text-caption" role="alert">{error}</div>}<div className="schedule-form-actions flex justify-end gap-2"><Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={onClose} type="button">{t("Cancel")}</Button><Button variant="default" type="button" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" disabled={busy || previewLoading || !preview.length || !input.name.trim() || !input.prompt.trim()} onClick={() => void save()}>{busy ? t("Saving…") : t("Save schedule")}</Button></div>
  </fieldset></section>
}
export function BackgroundControls({ compact = false, onInstalled }: { compact?: boolean; onInstalled?: () => void }) {
  useLanguage()
  const app = useAppSettings()
  const [status, setStatus] = useState<BackgroundStatus | null>(null), [connected, setConnected] = useState(true), [busy, setBusy] = useState(false)
  const reload = () => invoke('background.status').then((s) => { setStatus(s); setConnected(true) }, () => setConnected(false))
  useEffect(() => { void reload(); return ramu.on('background:connection', ({ connected }) => { setConnected(connected); if (connected) void reload() }) }, [])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await reload() } catch (e) { notifyError(errorText(e), 'Background service') } finally { setBusy(false) } }
  if (compact) return <span className="inline-flex items-center gap-[7px] text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${connected ? 'bg-(--ok)' : 'bg-[#8b8b91]'}`} />{connected ? t("Background service running") : t("Background service stopped")}</span>
  return <>
    <SettingsRow className=""><span><strong>{t("Background service")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Chats and schedules keep running when Ramu closes. The computer must stay awake.")}</span><span className="muted text-muted-foreground block block small text-caption">{connected ? t("Running · PID {0}", { "0": status?.pid ?? '…' }) : t("Stopped")}</span></span><Button variant="secondary" className="bg-fill hover:bg-fill-hover" disabled={busy} onClick={() => void act(() => invoke(connected ? 'background.stop' : 'background.start'))}>{connected ? t("Stop") : t("Start")}</Button></SettingsRow>
    <SettingsRow className="settings-toggle"><span><strong>{t("Start at login")}</strong><span className="muted text-muted-foreground small text-caption block block">{t("macOS starts the background service when you sign in.")}</span></span><Switch aria-label={t("Start at login")} checked={status?.loginEnabled ?? false} disabled={busy || !connected} onCheckedChange={(checked) => void act(async () => { const result = await invoke('background.login', checked); if (result?.firstInstall) { onInstalled?.(); await app.reload() } })} /></SettingsRow>
  </>
}

export function ScheduleChatCard({ schedule }: { schedule: Schedule }) {
  useLanguage()
  const ws = useWorkspace()
  const open = () => { ws.setSidebar('schedules'); setTimeout(() => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id: schedule.id } })), 100) }
  return <div className="schedule-chat-card [&_.block]:mt-[5px] flex items-start gap-3 [border:1px_solid_transparent] rounded-(--radius-m) m-[12px_0] p-[15px] bg-fill"><CalendarClock size={16} /><div className="grow flex-1 min-w-0 text-left"><strong>{schedule.name}</strong><span className="muted text-muted-foreground small text-caption block block">{schedule.rule.kind === 'once' ? t("Runs once") : t(schedule.rule.kind)} · {schedule.timezone}</span><span className="small text-caption block block">{formatScheduleTime(schedule.nextRunAt, schedule.timezone)}</span></div><Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={open}>{t("Open schedule")}</Button><Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={open}>Edit</Button></div>
}
