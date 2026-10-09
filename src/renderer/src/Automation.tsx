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
import { NewTask } from './NewTask'
import { invoke, ramu } from './ipc'
import { notifyError } from './Notifications'

export function formatScheduleTime(at: number | null, zone: string): string { return at === null ? 'No upcoming run' : DateTime.fromMillis(at, { zone }).toFormat('ccc, LLL d · HH:mm ZZZZ') }
export function useSchedules() {
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
  const { schedules } = useSchedules()
  const select = (id?: string) => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id } }))
  return <div className="panel"><Button className="nav-btn" onClick={() => select()}><Plus size={15} />New schedule</Button><div className="section-head">Schedules</div>{schedules.map((s) => <Button className="schedule-nav" key={s.id} onClick={() => select(s.id)}><CalendarClock size={15} /><span>{s.name}<span className="muted small block">{s.state === 'active' ? formatScheduleTime(s.nextRunAt, s.timezone) : s.state}</span></span></Button>)}{!schedules.length && <p className="muted hint">Run an agent once or on a repeating schedule. You can also ask for a schedule in any chat.</p>}</div>
}
export function SchedulesPage() {
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
  return <div className="automation-page"><header className="automation-heading"><div><h1>Schedules</h1><p className="muted">Agents run in the background, even when Ramu is closed.</p></div><Button className="primary" onClick={() => setEditing('new')}><Plus size={14} />New schedule</Button></header>
    {error && <p className="error" role="alert">{error}</p>}
    {editing && <ScheduleEditor key={editing === 'new' ? 'new' : editing.id} schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
    {!editing && !schedules.length && <div className="automation-empty"><CalendarClock size={30} /><h2>Let an agent handle it later</h2><p className="muted">Schedule a one-time task or a recurring check. Use /schedule in chat, or create one here.</p><Button onClick={() => setEditing('new')}>Create your first schedule</Button></div>}
    {!editing && schedules.map((s) => <section className={`schedule-card${selected === s.id ? ' selected' : ''}`} key={s.id}>
      <div className="schedule-card-title"><h2>{s.name}</h2><Badge variant="outline" className="chip">{s.state}</Badge><span className="grow" /><Button disabled={busy} onClick={() => setEditing(s)}>Edit</Button><Button className="ghost icon" aria-label={`Run ${s.name} now`} title="Run now" disabled={busy} onClick={() => void act(() => invoke('schedules.runNow', s.id))}><Play size={14} /></Button>{s.state !== 'completed' && <Button className="ghost icon" aria-label={`${s.state === 'paused' ? 'Resume' : 'Pause'} ${s.name}`} disabled={busy} onClick={() => void act(() => invoke('schedules.pause', s.id, s.state !== 'paused'))}>{s.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}</Button>}<Button className="ghost icon" aria-label={`Delete ${s.name}`} disabled={busy} onClick={() => { if (confirm(`Delete “${s.name}”? Its run chats will remain.`)) void act(() => invoke('schedules.delete', s.id)) }}><Trash2 size={14} /></Button></div>
      <p className="schedule-prompt">{s.prompt}</p><div className="muted small">{s.projectId === NO_PROJECT ? 'No project' : ws.projects.find((p) => p.id === s.projectId)?.name ?? 'Unavailable project'}{s.workspaceId && ` · ${ws.workspaces.find((w) => w.id === s.workspaceId)?.name ?? 'Isolated workspace'}`} · {s.rule.kind === 'once' ? 'Once' : s.rule.kind} · {s.timezone}</div><p className="schedule-next"><Clock size={13} />{formatScheduleTime(s.nextRunAt, s.timezone)}</p>
      {s.sourceTaskId && ws.tasks.some((t) => t.id === s.sourceTaskId) && <Button className="ghost small" onClick={() => ws.openTask(s.sourceTaskId!)}>Open originating chat</Button>}
      {runs.some((r) => r.scheduleId === s.id) && <div className="schedule-history"><strong className="small">Recent runs</strong>{runs.filter((r) => r.scheduleId === s.id).slice(0, 10).map((r) => <div className="schedule-run" key={r.id}><span className={`chip run-${r.status}`}>{r.status}</span><span className="small grow">{formatScheduleTime(r.dueAt, s.timezone)}{r.error && <span className="muted block">{r.error}</span>}{r.retryAt && <span className="muted block">Retry: {formatScheduleTime(r.retryAt, s.timezone)}</span>}</span>{r.taskId && <Button className="ghost small" onClick={() => void openRun(r)}>Open chat</Button>}</div>)}</div>}
    </section>)}
  </div>
}
function ScheduleEditor({ schedule, onClose, onSaved }: { schedule?: Schedule; onClose: () => void; onSaved: () => void }) {
  const ws = useWorkspace(), { initialSettings } = useModelSets()
  const [input, setInput] = useState<ScheduleInput>(() => schedule ?? { name: '', prompt: '', projectId: ws.ui.activeTaskId ? ws.projectOf(ws.ui.activeTaskId)?.id ?? NO_PROJECT : NO_PROJECT, workspaceId: null, timezone: systemTimezone(), rule: { kind: 'daily', time: '09:00' }, missedPolicy: 'latest', settings: initialSettings })
  const [preview, setPreview] = useState<number[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [onceLocal, setOnceLocal] = useState(() => DateTime.fromISO(schedule?.rule.kind === 'once' ? schedule.rule.at : DateTime.now().plus({ hours: 1 }).toISO()!, { zone: input.timezone }).toFormat("yyyy-MM-dd'T'HH:mm"))
  useEffect(() => { let disposed = false; const timer = setTimeout(() => { void invoke('schedules.preview', input.rule, input.timezone).then((dates) => { if (!disposed) { setPreview(dates); setError(null) } }, (e) => { if (!disposed) { setPreview([]); setError(String(e)) } }) }, 200); return () => { disposed = true; clearTimeout(timer) } }, [input.rule, input.timezone])
  const rule = input.rule
  const setRule = (rule: ScheduleRule) => setInput((i) => ({ ...i, rule }))
  const once = (value: string, zone = input.timezone) => DateTime.fromISO(value, { zone }).toISO() ?? value
  const save = async () => { setBusy(true); setError(null); try { await invoke('schedules.save', input, schedule?.id); onSaved() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <section className="schedule-editor"><div className="schedule-card-title"><h2>{schedule ? 'Edit schedule' : 'New schedule'}</h2><span className="grow" /><Button className="ghost icon" aria-label="Close schedule editor" onClick={onClose} disabled={busy}><X size={15} /></Button></div><fieldset disabled={busy} className="schedule-form">
    <label>Name<Input value={input.name} maxLength={200} placeholder="Morning project check" onChange={(e) => setInput({ ...input, name: e.target.value })} /></label>
    <label>What should the agent do?<Textarea rows={3} value={input.prompt} placeholder="Review unfinished work and identify the next useful action." onChange={(e) => setInput({ ...input, prompt: e.target.value })} /></label>
    <div className="schedule-form-row"><label>Scope<Dropdown label="Scope" value={input.projectId} onChange={(projectId) => setInput({ ...input, projectId, workspaceId: null })} options={[{ value: NO_PROJECT, label: 'No project' }, ...ws.projects.map((p) => ({ value: p.id, label: p.name }))]} /></label>{input.projectId !== NO_PROJECT && <label>Checkout<Dropdown label="Checkout" value={input.workspaceId ?? ''} onChange={(workspaceId) => setInput({ ...input, workspaceId: workspaceId || null })} options={[{ value: '', label: 'Current checkout' }, ...ws.workspaces.filter((w) => w.projectId === input.projectId).map((w) => ({ value: w.id, label: w.name }))]} /></label>}</div>
    <div className="schedule-form-row"><label>Frequency<Dropdown label="Frequency" value={rule.kind} onChange={(kind) => setRule(kind === 'once' ? { kind, at: once(onceLocal) } : kind === 'weekly' ? { kind, time: '09:00', weekdays: [1, 2, 3, 4, 5] } : kind === 'monthly' ? { kind, time: '09:00', day: 1 } : kind === 'interval' ? { kind, minutes: 60, anchor: DateTime.now().plus({ hours: 1 }).toISO()! } : { kind: 'daily', time: '09:00' })} options={['once', 'daily', 'weekly', 'monthly', 'interval'].map((value) => ({ value, label: value === 'interval' ? 'Every interval' : value[0]!.toUpperCase() + value.slice(1) }))} /></label></div>
    {rule.kind === 'once' && <label>Run at<Input type="datetime-local" value={onceLocal} onChange={(e) => { setOnceLocal(e.target.value); setRule({ kind: 'once', at: once(e.target.value) }) }} /></label>}
    {'time' in rule && <label>Time<Input type="time" value={rule.time} onChange={(e) => setRule({ ...rule, time: e.target.value })} /></label>}
    {rule.kind === 'weekly' && <div className="schedule-weekdays" aria-label="Days of the week">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => <label key={day}><Checkbox checked={rule.weekdays.includes(i + 1)} onCheckedChange={(checked) => setRule({ ...rule, weekdays: checked === true ? [...rule.weekdays, i + 1] : rule.weekdays.filter((d) => d !== i + 1) })} />{day}</label>)}</div>}
    {rule.kind === 'monthly' && <label>Day of month<Input type="number" min={1} max={31} value={rule.day} onChange={(e) => setRule({ ...rule, day: Number(e.target.value) })} /><span className="muted small">Months without this day are skipped.</span></label>}
    {rule.kind === 'interval' && <label>Every how many minutes?<Input type="number" min={5} value={rule.minutes} onChange={(e) => setRule({ ...rule, minutes: Number(e.target.value) })} /></label>}
    <label>If the computer is asleep or the service is stopped<Dropdown label="Missed runs" value={input.missedPolicy} onChange={(missedPolicy) => setInput({ ...input, missedPolicy: missedPolicy as 'latest' | 'skip' })} options={[{ value: 'latest', label: 'Run the latest missed occurrence once' }, { value: 'skip', label: 'Skip missed occurrences' }]} /></label>
    <AgentControls settings={input.settings} onChange={(settings) => setInput({ ...input, settings })} disabled={busy} />
    <div className="schedule-preview"><strong className="small">Upcoming runs</strong>{preview.map((at) => <div className="muted small" key={at}>{formatScheduleTime(at, input.timezone)}</div>)}{!preview.length && <div className="muted small">Choose a valid future time.</div>}</div><p className="muted small">New schedules use your system timezone. Calendar schedules keep their saved local time. During daylight-saving changes, nonexistent times shift forward and repeated times run once at the earlier occurrence.</p>
    {error && <div className="error small" role="alert">{error}</div>}<div className="schedule-form-actions"><Button onClick={onClose} type="button">Cancel</Button><Button type="button" className="primary" disabled={busy || !preview.length || !input.name.trim() || !input.prompt.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save schedule'}</Button></div>
  </fieldset></section>
}
export function HomePage() {
  const ws = useWorkspace(), { preferences } = useAppSettings(), { schedules } = useSchedules()
  const [recap, setRecap] = useState<RecapSnapshot | null>(null), [scope, setScope] = useState(NO_PROJECT)
  const [lastVisit] = useState(() => Number(localStorage.getItem('ramu.last-visit') ?? 0))
  const reload = useCallback(() => invoke('recaps.get').then(setRecap), [])
  useEffect(() => { void reload().catch(() => {}); localStorage.setItem('ramu.last-visit', String(Date.now())); return ramu.on('automation:changed', () => { void reload().catch(() => {}) }) }, [reload])
  const act = async (id: string, action: 'done' | 'dismissed' | 'snoozed') => { try { await invoke('recaps.act', id, action); await reload() } catch (e) { notifyError(String(e), 'Recaps') } }
  const visible = recap?.items.filter((i) => (i.status === 'open' || i.status === 'snoozed' && (i.snoozedUntil ?? 0) <= Date.now()) && ws.tasks.some((t) => t.id === i.taskId)) ?? []
  const groups = (['attention', 'recent'] as const).map((group) => ({ group, items: visible.filter((i) => i.group === group && (group !== 'recent' || i.updatedAt >= lastVisit)) })).filter((entry) => entry.items.length)
  const upcoming = schedules.filter((s) => s.state === 'active').sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)).slice(0, 3)
  // The start box leads. Everything else shows only when it has something to say.
  return <div className="home-page">
    <div className="home-start"><NewTask projectId={scope} onProjectChange={setScope} /></div>
    <div className="home-feed">
      {preferences.recapsEnabled && recap?.error && <p className="error small" role="alert">{recap.error}</p>}
      {preferences.recapsEnabled && groups.map(({ group, items }) => <section key={group} className="recap-group"><h2>{group === 'attention' ? 'Needs your attention' : 'Since your last visit'}</h2>{items.map((item) => <article className="recap-card" key={item.id}><h3>{item.title}</h3><p className="muted">{item.detail}</p><div className="recap-actions"><Button className="primary small" title={`Source event ${item.sourceSeq}`} onClick={() => { ws.openTask(item.taskId); ws.openView(item.taskId, { kind: 'agent', sessionId: item.sessionId, sourceSeq: item.sourceSeq }); window.dispatchEvent(new CustomEvent('ramu:source-event', { detail: { sessionId: item.sessionId, seq: item.sourceSeq } })) }}>Open chat</Button>{group === 'attention' && <><Button className="ghost small" onClick={() => void act(item.id, 'done')}><Check size={12} />Mark done</Button><Button className="ghost small" onClick={() => void act(item.id, 'snoozed')}>Snooze 1 day</Button></>}<Button className="ghost small" onClick={() => void act(item.id, 'dismissed')}>Dismiss</Button></div></article>)}</section>)}
      {upcoming.length > 0 && <section className="recap-group"><h2>Coming up</h2>{upcoming.map((s) => <Button key={s.id} className="home-upcoming" onClick={() => ws.setSidebar('schedules')}><Clock size={14} /><span>{s.name}</span><span className="muted small">{formatScheduleTime(s.nextRunAt, s.timezone)}</span></Button>)}</section>}
      <footer className="home-footer">
        <BackgroundControls compact />
        {preferences.recapsEnabled && <><span className="grow" /><span className="muted small">{recap?.generating ? 'Updating recap…' : recap?.generatedAt ? `Daily recap updated ${DateTime.fromMillis(recap.generatedAt).toRelative()}` : 'Preparing your first recap'}</span><Button className="ghost icon small-icon" aria-label="Refresh recap" disabled={recap?.generating} onClick={() => void invoke('recaps.refresh').then(setRecap, (e) => notifyError(String(e), 'Recaps'))}><RefreshCw size={13} /></Button></>}
      </footer>
    </div>
  </div>
}
export function BackgroundControls({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<BackgroundStatus | null>(null), [connected, setConnected] = useState(true), [busy, setBusy] = useState(false)
  const reload = () => invoke('background.status').then((s) => { setStatus(s); setConnected(true) }, () => setConnected(false))
  useEffect(() => { void reload(); return ramu.on('background:connection', ({ connected }) => { setConnected(connected); if (connected) void reload() }) }, [])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await reload() } catch (e) { notifyError(String(e), 'Background service') } finally { setBusy(false) } }
  if (compact) return <span className={`background-badge ${connected ? 'connected' : ''}`}><span />{connected ? 'Background service running' : 'Background service stopped'}</span>
  return <div className="background-settings"><p className="muted">Chats and schedules continue when you close Ramu. The computer must be awake. Agents waiting for answers remain paused until you return.</p><p>{connected ? `Running · PID ${status?.pid ?? '…'}` : 'Stopped'}</p><div className="settings-row settings-toggle"><span><strong>Start at login</strong><span className="muted small block">macOS starts the background service when you sign in.</span></span><Switch aria-label="Start at login" checked={status?.loginEnabled ?? false} disabled={busy || !connected} onCheckedChange={(checked) => void act(() => invoke('background.login', checked))} /></div><Button disabled={busy} onClick={() => void act(() => invoke(connected ? 'background.stop' : 'background.start'))}>{connected ? 'Stop background service' : 'Start background service'}</Button></div>
}

export function ScheduleChatCard({ schedule }: { schedule: Schedule }) {
  const ws = useWorkspace()
  const open = () => { ws.setSidebar('schedules'); setTimeout(() => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id: schedule.id } })), 100) }
  return <div className="schedule-chat-card"><CalendarClock size={16} /><div className="grow"><strong>{schedule.name}</strong><span className="muted small block">{schedule.rule.kind === 'once' ? 'Runs once' : schedule.rule.kind} · {schedule.timezone}</span><span className="small block">{formatScheduleTime(schedule.nextRunAt, schedule.timezone)}</span></div><Button className="ghost small" onClick={open}>Open schedule</Button><Button className="ghost small" onClick={open}>Edit</Button></div>
}
