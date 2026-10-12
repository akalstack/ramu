import { t, useLanguage } from './i18n'
import { Button } from '@/components/ui/button'
import { Check, Clock, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { RecapSnapshot } from '../../shared/types'
import { useAppSettings } from './AppSettings'
import { useWorkspace } from './workspace'
import { BackgroundControls, formatScheduleTime, useSchedules } from './Automation'
import { invoke, ramu } from './ipc'
import { notifyError } from './Notifications'
import { timeAgo } from './Menu'

/**
 * What sits under the start box on Home and New chat: chats still working in the background,
 * recaps, upcoming schedules and the background service. Sections show only when they have content.
 */
export function HomeFeed() {
  useLanguage()
  const ws = useWorkspace(), { preferences } = useAppSettings(), { schedules } = useSchedules()
  const [recap, setRecap] = useState<RecapSnapshot | null>(null)
  const [lastVisit] = useState(() => Number(localStorage.getItem('ramu.last-visit') ?? 0))
  const reload = useCallback(() => invoke('recaps.get').then(setRecap), [])
  useEffect(() => { void reload().catch(() => {}); localStorage.setItem('ramu.last-visit', String(Date.now())); return ramu.on('automation:changed', () => { void reload().catch(() => {}) }) }, [reload])
  const act = async (id: string, action: 'done' | 'dismissed' | 'snoozed') => { try { await invoke('recaps.act', id, action); await reload() } catch (e) { notifyError(String(e), 'Recaps') } }
  const visible = recap?.items.filter((i) => (i.status === 'open' || i.status === 'snoozed' && (i.snoozedUntil ?? 0) <= Date.now()) && ws.tasks.some((t) => t.id === i.taskId)) ?? []
  const groups = (['attention', 'recent'] as const).map((group) => ({ group, items: visible.filter((i) => i.group === group && (group !== 'recent' || i.updatedAt >= lastVisit)) })).filter((entry) => entry.items.length)
  const upcoming = schedules.filter((s) => s.state === 'active').sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)).slice(0, 3)
  const active = ws.tasks.filter((task) => task.status === 'running' || task.status === 'needs-input').sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return <div className="home-feed">
    {active.length > 0 && <section className="recap-group"><h2>{t("Running in the background")}</h2><div className="home-agents">{active.map((task) => <Button key={task.id} className="home-agent" onClick={() => ws.openTask(task.id)}>
      {task.status === 'running' ? <span className="task-state spinner" role="img" aria-label={t("Agent working")} /> : <span className="task-state dot warn" role="img" aria-label={t("Waiting for your input")} />}
      <span className="home-agent-title">{task.title}</span>
      <span className="muted small">{task.status === 'needs-input' ? t("Waiting for your input") : ws.projects.find((p) => p.id === task.projectId)?.name ?? t("No project")}</span>
      <span className="muted small home-agent-time">{timeAgo(task.lastActiveAt)}</span>
    </Button>)}</div></section>}
    {preferences.recapsEnabled && recap?.error && <p className="error small" role="alert">{recap.error}</p>}
    {preferences.recapsEnabled && groups.map(({ group, items }) => <section key={group} className="recap-group"><h2>{group === 'attention' ? t("Needs your attention") : t("Since your last visit")}</h2>{items.map((item) => <article className="recap-card" key={item.id}><h3>{item.title}</h3><p className="muted">{item.detail}</p><div className="recap-actions"><Button className="primary small" title={t("Source event {0}", { "0": item.sourceSeq })} onClick={() => { ws.openTask(item.taskId); ws.openView(item.taskId, { kind: 'agent', sessionId: item.sessionId, sourceSeq: item.sourceSeq }); window.dispatchEvent(new CustomEvent('ramu:source-event', { detail: { sessionId: item.sessionId, seq: item.sourceSeq } })) }}>{t("Open chat")}</Button>{group === 'attention' && <><Button className="ghost small" onClick={() => void act(item.id, 'done')}><Check size={12} />{t("Mark done")}</Button><Button className="ghost small" onClick={() => void act(item.id, 'snoozed')}>{t("Snooze 1 day")}</Button></>}<Button className="ghost small" onClick={() => void act(item.id, 'dismissed')}>{t("Dismiss")}</Button></div></article>)}</section>)}
    {upcoming.length > 0 && <section className="recap-group"><h2>{t("Coming up")}</h2>{upcoming.map((s) => <Button key={s.id} className="home-upcoming" onClick={() => ws.setSidebar('schedules')}><Clock size={14} /><span>{s.name}</span><span className="muted small">{formatScheduleTime(s.nextRunAt, s.timezone)}</span></Button>)}</section>}
    <footer className="home-footer">
      <BackgroundControls compact />
      {preferences.recapsEnabled && <><span className="grow" /><span className="muted small">{recap?.generating ? t("Updating recap…") : recap?.generatedAt ? t("Daily recap updated {0}", { "0": DateTime.fromMillis(recap.generatedAt).toRelative() }) : t("Preparing your first recap")}</span><Button className="ghost icon small-icon" aria-label={t("Refresh recap")} disabled={recap?.generating} onClick={() => void invoke('recaps.refresh').then(setRecap, (e) => notifyError(String(e), 'Recaps'))}><RefreshCw size={13} /></Button></>}
    </footer>
  </div>
}
