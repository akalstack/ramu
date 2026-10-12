import { t, useLanguage, formatLocale } from './i18n'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { systemTimezone } from '../../shared/timezone'
import { Badge } from '@/components/ui/badge'
import { Dropdown } from './Menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { CalendarClock, Check, Clock, Pause, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { NO_PROJECT, type Schedule, type ScheduleInput, type ScheduleRule, type ScheduleRun, type RecapSnapshot, type BackgroundStatus } from '../../shared/types'
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
  const reload = useCallback(async () => { const [s, r] = await Promise.all([invoke('schedules.list'), invoke('schedules.runs')]); setSchedules(s); setRuns(r) }, [])
  useEffect(() => {
    void reload().catch((e) => notifyError(String(e), 'Schedules'))
    const off = ramu.on('automation:changed', () => { void reload().catch(() => {}) })
    return off
  }, [reload])
  return { schedules, runs, reload }
}
export function ScheduleNavigation() {
  useLanguage()
  const { schedules } = useSchedules()
  const select = (id?: string) => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id } }))
  return <div className="panel"><Button className="nav-btn" onClick={() => select()}><Plus size={15} />{t("New schedule")}</Button><div className="section-head">{t("Schedules")}</div>{schedules.map((s) => <Button className="schedule-nav" key={s.id} onClick={() => select(s.id)}><CalendarClock size={15} /><span>{s.name}<span className="muted small block">{s.state === 'active' ? formatScheduleTime(s.nextRunAt, s.timezone) : t(s.state)}</span></span></Button>)}{!schedules.length && <p className="muted hint">{t("Run an agent once or on a repeating schedule. You can also ask for a schedule in any chat.")}</p>}</div>
}
export function SchedulesPage() {
  useLanguage()
  const ws = useWorkspace(), { schedules, runs, reload } = useSchedules()
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const select = (e: Event) => { const id = (e as CustomEvent).detail?.id; setSelected(id ?? null); setEditing(id ? schedules.find((s) => s.id === id) ?? null : 'new') }
    window.addEventListener('ramu:schedule', select); return () => window.removeEventListener('ramu:schedule', select)
  }, [schedules])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await reload() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const openRun = async (run: ScheduleRun) => {
    if (!run.taskId) return
    await ws.refresh(); ws.openTask(run.taskId)
    if (run.sessionId) ws.openView(run.taskId, { kind: 'agent', sessionId: run.sessionId })
  }
  return <div className="automation-page"><header className="automation-heading"><div><h1>{t("Schedules")}</h1><p className="muted">{t("Agents run in the background, even when Ramu is closed.")}</p></div><Button className="primary" onClick={() => setEditing('new')}><Plus size={14} />{t("New schedule")}</Button></header>
    {error && <p className="error" role="alert">{error}</p>}
    {editing && <ScheduleEditor key={editing === 'new' ? 'new' : editing.id} schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
    {!editing && !schedules.length && <Empty className="automation-empty"><EmptyHeader><EmptyMedia variant="icon"><CalendarClock /></EmptyMedia><EmptyTitle>{t("Let an agent handle it later")}</EmptyTitle><EmptyDescription>{t("Schedule a one-time task or a recurring check. Use /schedule in chat, or create one here.")}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setEditing('new')}>{t("Create your first schedule")}</Button></EmptyContent></Empty>}
    {!editing && schedules.map((s) => <section className={`schedule-card${selected === s.id ? ' selected' : ''}`} key={s.id}>
      <div className="schedule-card-title"><h2>{s.name}</h2><Badge variant="outline" className="chip">{t(s.state)}</Badge><span className="grow" /><Button disabled={busy} onClick={() => setEditing(s)}>Edit</Button><Button className="ghost icon" aria-label={t("Run {0} now", { "0": s.name })} title={t("Run now")} disabled={busy} onClick={() => void act(() => invoke('schedules.runNow', s.id))}><Play size={14} /></Button>{s.state !== 'completed' && <Button className="ghost icon" aria-label={`${s.state === 'paused' ? t('Resume') : t('Pause')} ${s.name}`} disabled={busy} onClick={() => void act(() => invoke('schedules.pause', s.id, s.state !== 'paused'))}>{s.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}</Button>}<Button className="ghost icon" aria-label={t("Delete {0}", { "0": s.name })} disabled={busy} onClick={() => { if (confirm(t('Delete “{name}”? Its run chats will remain.', { name: s.name }))) void act(() => invoke('schedules.delete', s.id)) }}><Trash2 size={14} /></Button></div>
      <p className="schedule-prompt">{s.prompt}</p><div className="muted small">{s.projectId === NO_PROJECT ? t("No project") : ws.projects.find((p) => p.id === s.projectId)?.name ?? t("Unavailable project")}{s.workspaceId && ` · ${ws.workspaces.find((w) => w.id === s.workspaceId)?.name ?? 'Isolated workspace'}`} · {s.rule.kind === 'once' ? t("Once") : t(s.rule.kind)} · {s.timezone}</div><p className="schedule-next"><Clock size={13} />{formatScheduleTime(s.nextRunAt, s.timezone)}</p>
      {s.sourceTaskId && ws.tasks.some((t) => t.id === s.sourceTaskId) && <Button className="ghost small" onClick={() => ws.openTask(s.sourceTaskId!)}>{t("Open originating chat")}</Button>}
      {runs.some((r) => r.scheduleId === s.id) && <div className="schedule-history"><strong className="small">{t("Recent runs")}</strong>{runs.filter((r) => r.scheduleId === s.id).slice(0, 10).map((r) => <div className="schedule-run" key={r.id}><span className={`chip run-${r.status}`}>{t(r.status)}</span><span className="small grow">{formatScheduleTime(r.dueAt, s.timezone)}{r.error && <span className="muted block">{r.error}</span>}{r.retryAt && <span className="muted block">{t("Retry: ")}{formatScheduleTime(r.retryAt, s.timezone)}</span>}</span>{r.taskId && <Button className="ghost small" onClick={() => void openRun(r)}>{t("Open chat")}</Button>}</div>)}</div>}
    </section>)}
  </div>
}
function ScheduleEditor({ schedule, onClose, onSaved }: { schedule?: Schedule; onClose: () => void; onSaved: () => void }) {
  useLanguage()
  const ws = useWorkspace(), { initialSettings } = useModelSets()
  const [input, setInput] = useState<ScheduleInput>(() => schedule ?? { name: '', prompt: '', projectId: ws.ui.activeTaskId ? ws.projectOf(ws.ui.activeTaskId)?.id ?? NO_PROJECT : NO_PROJECT, workspaceId: null, timezone: systemTimezone(), rule: { kind: 'daily', time: '09:00' }, missedPolicy: 'latest', settings: initialSettings })
  const [preview, setPreview] = useState<number[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [onceLocal, setOnceLocal] = useState(() => DateTime.fromISO(schedule?.rule.kind === 'once' ? schedule.rule.at : DateTime.now().plus({ hours: 1 }).toISO()!, { zone: input.timezone }).toFormat("yyyy-MM-dd'T'HH:mm"))
  useEffect(() => { let disposed = false; const timer = setTimeout(() => { void invoke('schedules.preview', input.rule, input.timezone).then((dates) => { if (!disposed) { setPreview(dates); setError(null) } }, (e) => { if (!disposed) { setPreview([]); setError(String(e)) } }) }, 200); return () => { disposed = true; clearTimeout(timer) } }, [input.rule, input.timezone])
  const rule = input.rule
  const setRule = (rule: ScheduleRule) => setInput((i) => ({ ...i, rule }))
  const once = (value: string, zone = input.timezone) => DateTime.fromISO(value, { zone }).toISO() ?? value
  const save = async () => { setBusy(true); setError(null); try { await invoke('schedules.save', input, schedule?.id); onSaved() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <section className="schedule-editor"><div className="schedule-card-title"><h2>{schedule ? t("Edit schedule") : t("New schedule")}</h2><span className="grow" /><Button className="ghost icon" aria-label={t("Close schedule editor")} onClick={onClose} disabled={busy}><X size={15} /></Button></div><fieldset disabled={busy} className="schedule-form">
    <label>{t("Name")}<Input value={input.name} maxLength={200} placeholder={t("Morning project check")} onChange={(e) => setInput({ ...input, name: e.target.value })} /></label>
    <label>{t("What should the agent do?")}<Textarea rows={3} value={input.prompt} placeholder={t("Review unfinished work and identify the next useful action.")} onChange={(e) => setInput({ ...input, prompt: e.target.value })} /></label>
    <div className="schedule-form-row"><label>{t("Scope")}<Dropdown label={t("Scope")} value={input.projectId} onChange={(projectId) => setInput({ ...input, projectId, workspaceId: null })} options={[{ value: NO_PROJECT, label: t("No project") }, ...ws.projects.map((p) => ({ value: p.id, label: p.name }))]} /></label>{input.projectId !== NO_PROJECT && <label>Checkout<Dropdown label="Checkout" value={input.workspaceId ?? ''} onChange={(workspaceId) => setInput({ ...input, workspaceId: workspaceId || null })} options={[{ value: '', label: t("Current checkout") }, ...ws.workspaces.filter((w) => w.projectId === input.projectId).map((w) => ({ value: w.id, label: w.name }))]} /></label>}</div>
    <div className="schedule-form-row"><label>{t("Frequency")}<Dropdown label={t("Frequency")} value={rule.kind} onChange={(kind) => setRule(kind === 'once' ? { kind, at: once(onceLocal) } : kind === 'weekly' ? { kind, time: '09:00', weekdays: [1, 2, 3, 4, 5] } : kind === 'monthly' ? { kind, time: '09:00', day: 1 } : kind === 'interval' ? { kind, minutes: 60, anchor: DateTime.now().plus({ hours: 1 }).toISO()! } : { kind: 'daily', time: '09:00' })} options={['once', 'daily', 'weekly', 'monthly', 'interval'].map((value) => ({ value, label: value === 'interval' ? t("Every interval") : t(value[0]!.toUpperCase() + value.slice(1)) }))} /></label></div>
    {rule.kind === 'once' && <label>{t("Run at")}<Input type="datetime-local" value={onceLocal} onChange={(e) => { setOnceLocal(e.target.value); setRule({ kind: 'once', at: once(e.target.value) }) }} /></label>}
    {'time' in rule && <label>{t("Time")}<Input type="time" value={rule.time} onChange={(e) => setRule({ ...rule, time: e.target.value })} /></label>}
    {rule.kind === 'weekly' && <div className="schedule-weekdays" aria-label={t("Days of the week")}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => <label key={day}><Checkbox checked={rule.weekdays.includes(i + 1)} onCheckedChange={(checked) => setRule({ ...rule, weekdays: checked === true ? [...rule.weekdays, i + 1] : rule.weekdays.filter((d) => d !== i + 1) })} />{day}</label>)}</div>}
    {rule.kind === 'monthly' && <label>{t("Day of month")}<Input type="number" min={1} max={31} value={rule.day} onChange={(e) => setRule({ ...rule, day: Number(e.target.value) })} /><span className="muted small">{t("Months without this day are skipped.")}</span></label>}
    {rule.kind === 'interval' && <label>{t("Every how many minutes?")}<Input type="number" min={5} value={rule.minutes} onChange={(e) => setRule({ ...rule, minutes: Number(e.target.value) })} /></label>}
    <label>{t("If the computer is asleep or the service is stopped")}<Dropdown label={t("Missed runs")} value={input.missedPolicy} onChange={(missedPolicy) => setInput({ ...input, missedPolicy: missedPolicy as 'latest' | 'skip' })} options={[{ value: 'latest', label: t("Run the latest missed occurrence once") }, { value: 'skip', label: t("Skip missed occurrences") }]} /></label>
    <AgentControls settings={input.settings} onChange={(settings) => setInput({ ...input, settings })} disabled={busy} />
    <div className="schedule-preview"><strong className="small">{t("Upcoming runs")}</strong>{preview.map((at) => <div className="muted small" key={at}>{formatScheduleTime(at, input.timezone)}</div>)}{!preview.length && <div className="muted small">{t("Choose a valid future time.")}</div>}</div><p className="muted small">{t("New schedules use your system timezone. Calendar schedules keep their saved local time. During daylight-saving changes, nonexistent times shift forward and repeated times run once at the earlier occurrence.")}</p>
    {error && <div className="error small" role="alert">{error}</div>}<div className="schedule-form-actions"><Button onClick={onClose} type="button">{t("Cancel")}</Button><Button type="button" className="primary" disabled={busy || !preview.length || !input.name.trim() || !input.prompt.trim()} onClick={() => void save()}>{busy ? t("Saving…") : t("Save schedule")}</Button></div>
  </fieldset></section>
}
export function BackgroundControls({ compact = false }: { compact?: boolean }) {
  useLanguage()
  const [status, setStatus] = useState<BackgroundStatus | null>(null), [connected, setConnected] = useState(true), [busy, setBusy] = useState(false)
  const reload = () => invoke('background.status').then((s) => { setStatus(s); setConnected(true) }, () => setConnected(false))
  useEffect(() => { void reload(); return ramu.on('background:connection', ({ connected }) => { setConnected(connected); if (connected) void reload() }) }, [])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await reload() } catch (e) { notifyError(String(e), 'Background service') } finally { setBusy(false) } }
  if (compact) return <span className={`background-badge ${connected ? 'connected' : ''}`}><span />{connected ? t("Background service running") : t("Background service stopped")}</span>
  return <>
    <div className="settings-row"><span><strong>{t("Background service")}</strong><span className="muted block small">{t("Chats and schedules continue when you close Ramu. The computer must be awake. Agents waiting for answers remain paused until you return.")}</span><span className="muted block small">{connected ? t("Running · PID {0}", { "0": status?.pid ?? '…' }) : t("Stopped")}</span></span><Button disabled={busy} onClick={() => void act(() => invoke(connected ? 'background.stop' : 'background.start'))}>{connected ? t("Stop") : t("Start")}</Button></div>
    <div className="settings-row settings-toggle"><span><strong>{t("Start at login")}</strong><span className="muted small block">{t("macOS starts the background service when you sign in.")}</span></span><Switch aria-label={t("Start at login")} checked={status?.loginEnabled ?? false} disabled={busy || !connected} onCheckedChange={(checked) => void act(() => invoke('background.login', checked))} /></div>
  </>
}

export function ScheduleChatCard({ schedule }: { schedule: Schedule }) {
  useLanguage()
  const ws = useWorkspace()
  const open = () => { ws.setSidebar('schedules'); setTimeout(() => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id: schedule.id } })), 100) }
  return <div className="schedule-chat-card"><CalendarClock size={16} /><div className="grow"><strong>{schedule.name}</strong><span className="muted small block">{schedule.rule.kind === 'once' ? t("Runs once") : t(schedule.rule.kind)} · {schedule.timezone}</span><span className="small block">{formatScheduleTime(schedule.nextRunAt, schedule.timezone)}</span></div><Button className="ghost small" onClick={open}>{t("Open schedule")}</Button><Button className="ghost small" onClick={open}>Edit</Button></div>
}
