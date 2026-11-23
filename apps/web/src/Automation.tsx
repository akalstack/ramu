import { PageSchedules } from './pages/PageSchedules'
import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { useSettingsEvents, useSettingsInvoke } from './settings/SettingsScope'
import { ContentSkeleton } from '@/components/content-skeleton'
import { errorText } from './lib/errors'
import { SettingsRow } from '@/components/settings-row'
import { t, useLanguage, formatLocale } from './i18n'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { systemTimezone } from '@ramu/shared/workspace/timezone'
import { Badge } from '@/components/ui/badge'
import { Dropdown } from './Menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { CalendarClock, ChevronRight, Clock, Pause, Pencil, Play, Plus, Trash2, Webhook, X } from 'lucide-react'
import { WebhookFields, WebhookPanel } from './WebhookSchedule'
import { WEBHOOK_PRESETS } from '@ramu/shared/webhooks'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import {
  NO_PROJECT,
  type Schedule,
  type ScheduleInput,
  type ScheduleRule,
  type ScheduleRun,
  type BackgroundStatus,
} from '@ramu/shared/types'
import { AgentControls } from './chat/AgentControls'
import { useModelSets } from './models/ModelSets'
import { useAppSettings } from './settings/AppSettings'
import { useHostRuntime, useWorkspace, useWorkspacesOf } from './workspace/workspace'
import { HostProvider, useHost } from './workspace/HostProvider'
import { useComputers } from './workspace/computers'
import { invokerFor } from './ipc'
import { storeForHost } from './hostStorage'
import { usePaged } from './settings/cards'
import { useViewOnly } from './composer/useViewOnly'
import { VIEW_ONLY_WRITE_NOTICE } from './composer/viewerAccess'
import { notifyError } from './chat/Notifications'
import { TerminalCommandButton, terminalCommandHelp, useTerminalCommand } from './settings/TerminalCommand'
import {
  RULE_KINDS,
  byNextRun,
  canSaveSchedule,
  defaultScheduleInput,
  isProblemRun,
  onceIso,
  onceLocalValue,
  ruleForKind,
  setWeekday,
} from './scheduleForm'

export function formatScheduleTime(at: number | null, zone: string): string {
  return at === null
    ? t('No upcoming run')
    : DateTime.fromMillis(at, { zone, locale: formatLocale() }).toFormat('ccc, LLL d · HH:mm ZZZZ')
}
export function useSchedules() {
  useLanguage()
  const [schedules, setSchedules] = useState<Schedule[]>([]),
    [runs, setRuns] = useState<ScheduleRun[]>([])
  const [loading, setLoading] = useState(true)
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const reload = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([invoke('schedules.list'), invoke('schedules.runs')])
      setSchedules(s)
      setRuns(r)
    } finally {
      setLoading(false)
    }
  }, [invoke])
  useEffect(() => {
    void reload().catch((e) => notifyError(errorText(e), 'Schedules'))
    const off = on('automation:changed', () => {
      void reload().catch(() => {})
    })
    return off
  }, [reload, on])
  return { schedules, runs, reload, loading }
}
export function SchedulesPage({
  createRequested = false,
  onCreateHandled,
}: {
  createRequested?: boolean
  onCreateHandled?: () => void
}) {
  useLanguage()
  const ws = useWorkspace(),
    { schedules, runs, reload, loading } = useSchedules()
  const viewOnly = useViewOnly()
  // The sidebar's host filter applies here as it does to threads: All hosts lists every connected host's schedules,
  // one host lists only its own. Each schedule still lives on, and is fired by, its host.
  const own = useHost().id
  const computers = useComputers()
  const scope = computers?.scope ?? null
  const showOwn = !scope || scope === own
  // An offline host still lists its schedules as last seen, as the phone does; acting on them waits for it.
  const others = (computers?.computers ?? []).filter(
    (computer) => computer.id !== own && computer.status !== 'rejected' && (!scope || computer.id === scope),
  )
  const ownName = computers?.computers.find((computer) => computer.id === own)?.name
  // Bumped after the page's editor saves, so another host's list reads its schedules again at once.
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null),
    [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!createRequested) return
    setSelected(null)
    setEditing('new')
    onCreateHandled?.()
  }, [createRequested, onCreateHandled])
  useEffect(() => {
    const select = (e: Event) => {
      const id = (e as CustomEvent).detail?.id
      setSelected(id ?? null)
      setEditing(id ? (schedules.find((s) => s.id === id) ?? null) : 'new')
    }
    window.addEventListener('ramu:schedule', select)
    return () => window.removeEventListener('ramu:schedule', select)
  }, [schedules])
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const openRun = async (run: ScheduleRun) => {
    if (!run.taskId) return
    await ws.refresh()
    ws.openTask(run.taskId)
    if (run.sessionId) ws.openView(run.taskId, { kind: 'agent', sessionId: run.sessionId })
  }
  return (
    <div className="automation-page h-full w-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pt-6 pb-10">
        <header className="automation-heading [&_h1]:text-heading [&_h1]:font-semibold [&_h1]:tracking-[-0.01em] [&_h1]:m-[0_0_4px] [&_p]:m-0 [&_p]:text-control flex items-center justify-between gap-5 mb-6">
          <div>
            <h1>{t('Schedules')}</h1>
            <p className="muted text-muted-foreground">
              {t('Agents run in the background, even when Ramu is closed.')}
            </p>
          </div>
          <Button
            variant="default"
            className={PRIMARY_ACTION_CLASS}
            disabled={viewOnly}
            title={viewOnly ? t(VIEW_ONLY_WRITE_NOTICE) : undefined}
            onClick={() => setEditing('new')}
          >
            <Plus size={14} />
            {t('New schedule')}
          </Button>
        </header>
        {error && (
          <p className="error text-bad" role="alert">
            {error}
          </p>
        )}
        {editing && (
          // A new schedule starts on the host in view; its Runs on still moves it.
          <HostProvider hostId={showOwn ? undefined : scope!}>
            <ScheduleEditor
              key={editing === 'new' ? 'new' : editing.id}
              schedule={editing === 'new' ? undefined : editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                setVersion((value) => value + 1)
                void reload()
              }}
            />
          </HostProvider>
        )}
        {!editing && showOwn && others.length > 0 && schedules.length > 0 && ownName && (
          <h2 className="m-0 text-control font-medium text-muted-foreground">{t('On {0}', { 0: ownName })}</h2>
        )}
        {!editing && showOwn && loading && <ContentSkeleton variant="cards" rows={3} />}
        {!editing && !loading && !schedules.length && showOwn && !others.length && (
          <Empty className="automation-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarClock />
              </EmptyMedia>
              <EmptyTitle>{t('Let an agent handle it later')}</EmptyTitle>
              <EmptyDescription>{t('Schedule a task once or at regular intervals.')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                disabled={viewOnly}
                title={viewOnly ? t(VIEW_ONLY_WRITE_NOTICE) : undefined}
                onClick={() => setEditing('new')}
              >
                {t('Create your first schedule')}
              </Button>
            </EmptyContent>
          </Empty>
        )}
        {!editing && showOwn && schedules.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {byNextRun(schedules).map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                runs={runs.filter((r) => r.scheduleId === s.id)}
                selected={selected === s.id}
                busy={busy || viewOnly}
                onEdit={() => setEditing(s)}
                onAct={act}
                onOpenRun={(run) => void openRun(run)}
              />
            ))}
          </div>
        )}
        {!editing && showOwn && <PageSchedules />}
        {!editing &&
          others.map((computer) => (
            <HostProvider key={computer.id} hostId={computer.id}>
              <HostScheduleList
                name={computer.name}
                offline={computer.status !== 'connected'}
                heading={showOwn || others.length > 1}
                version={version}
                onCreate={() => setEditing('new')}
              />
            </HostProvider>
          ))}
      </div>
    </div>
  )
}

/** What this device last read of a host's schedules, so they still list while it is offline. */
const LAST_SCHEDULES = 'last-schedules'
function lastSchedules(host: string): { schedules: Schedule[]; runs: ScheduleRun[] } | null {
  try {
    const saved = JSON.parse(storeForHost(host)?.getItem(LAST_SCHEDULES) ?? 'null')
    return saved && Array.isArray(saved.schedules) && Array.isArray(saved.runs) ? saved : null
  } catch {
    return null
  }
}

/**
 * Another host's schedules, read from that host; `heading` names it when the page lists several hosts. While the host
 * is offline it shows what was last read, and nothing on it can be run or changed until it is back.
 */
function HostScheduleList({
  name,
  offline,
  heading,
  version,
  onCreate,
}: {
  name: string
  offline: boolean
  heading: boolean
  version: number
  onCreate: () => void
}) {
  const { invoke, id: host } = useHost()
  const [saved] = useState(() => lastSchedules(host))
  const [schedules, setSchedules] = useState<Schedule[]>(saved?.schedules ?? [])
  const [runs, setRuns] = useState<ScheduleRun[]>(saved?.runs ?? [])
  const [loaded, setLoaded] = useState(false)
  const reload = useCallback(
    () =>
      Promise.all([invoke('schedules.list'), invoke('schedules.runs')]).then(([list, history]) => {
        setSchedules(list)
        setRuns(history)
        setLoaded(true)
        try {
          storeForHost(host)?.setItem(LAST_SCHEDULES, JSON.stringify({ schedules: list, runs: history.slice(0, 200) }))
        } catch {
          // Storage full: the list still shows for this session.
        }
      }),
    [invoke, host],
  )
  useEffect(() => {
    if (offline) return
    void reload().catch(() => {})
    const timer = setInterval(() => void reload().catch(() => {}), 30_000)
    return () => clearInterval(timer)
  }, [reload, version, offline])
  const viewOnly = useViewOnly()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  // Shown alone (the sidebar filters to this host), an empty host says so and offers to create, as the page's own does.
  if (!schedules.length)
    return heading || !loaded || offline ? null : (
      <Empty className="automation-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock />
          </EmptyMedia>
          <EmptyTitle>{t('Let an agent handle it later')}</EmptyTitle>
          <EmptyDescription>{t('Schedule a task once or at regular intervals.')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" disabled={viewOnly} onClick={onCreate}>
            {t('Create your first schedule')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e) {
      notifyError(errorText(e), 'Schedules')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col gap-1.5" aria-label={t('Schedules on {0}', { 0: name })}>
      {heading && (
        <h2 className="m-0 mt-4 text-control font-medium text-muted-foreground">{t('On {0}', { 0: name })}</h2>
      )}
      {offline && (
        <p role="status" className="m-0 text-caption text-muted-foreground">
          {t('Offline · last known schedules. They run on {0} once it is back.', { 0: name })}
        </p>
      )}
      {editing && (
        <ScheduleEditor
          key={editing.id}
          schedule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
      {byNextRun(schedules).map((s) => (
        <ScheduleCard
          key={s.id}
          schedule={s}
          runs={runs.filter((r) => r.scheduleId === s.id)}
          selected={false}
          busy={busy || viewOnly || offline}
          onEdit={() => setEditing(s)}
          onAct={act}
          onOpenRun={() => {}}
        />
      ))}
    </section>
  )
}
const ICON_BTN =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)'

/** One schedule as a compact card: name, state and next run on top (actions replace the time on hover), then prompt and meta. */
function ScheduleCard({
  schedule: s,
  runs,
  selected,
  busy,
  onEdit,
  onAct,
  onOpenRun,
}: {
  schedule: Schedule
  runs: ScheduleRun[]
  selected: boolean
  busy: boolean
  onEdit: () => void
  onAct: (work: () => Promise<unknown>) => Promise<void>
  onOpenRun: (run: ScheduleRun) => void
}) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke } = useHost()
  const [open, setOpen] = useState(false)
  const paged = usePaged(runs, 5)
  const project =
    s.projectId === NO_PROJECT
      ? t('No project')
      : (ws.projects.find((p) => p.id === s.projectId)?.name ?? t('Unavailable project'))
  const isolated = s.workspaceId && (ws.workspaces.find((w) => w.id === s.workspaceId)?.name ?? t('Isolated workspace'))
  const webhook = s.rule.kind === 'webhook'
  const viewOnly = useViewOnly()
  const [requestsOpen, setRequestsOpen] = useState(false)
  const meta = [
    project,
    isolated,
    s.rule.kind === 'once' ? t('Once') : webhook ? t('When a request arrives') : t(s.rule.kind),
    webhook ? null : s.timezone,
  ].filter(Boolean)
  return (
    <article
      className={`schedule-card flex flex-col gap-0.5 rounded-(--radius-m) bg-card px-3 py-2 [&:hover_.row-actions]:flex [&:focus-within_.row-actions]:flex [&:hover_.row-time]:hidden [&:focus-within_.row-time]:hidden ${selected ? 'ring-1 ring-(--line-strong)' : ''}`}
    >
      <div className="flex min-h-7 items-center gap-2">
        {webhook ? (
          <Webhook size={14} className="flex-none text-muted-foreground" />
        ) : (
          <CalendarClock size={14} className="flex-none text-muted-foreground" />
        )}
        <strong className="min-w-0 truncate text-control font-medium">{s.name}</strong>
        <Badge variant="outline" className="flex-none rounded-full px-1.5 text-caption text-muted-foreground">
          {t(s.state)}
        </Badge>
        <span className="min-w-0 flex-1" />
        <span className="row-time flex flex-none items-center gap-1.5 text-caption text-muted-foreground">
          <Clock size={12} />
          {webhook ? t('On request') : formatScheduleTime(s.nextRunAt, s.timezone)}
        </span>
        <span className="row-actions hidden flex-none items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BTN}
            aria-label={t('Run {0} now', { '0': s.name })}
            title={t('Run now')}
            disabled={busy}
            onClick={() => void onAct(() => invoke('schedules.runNow', s.id))}
          >
            <Play size={13} />
          </Button>
          {s.state !== 'completed' && (
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BTN}
              aria-label={`${s.state === 'paused' ? t('Resume') : t('Pause')} ${s.name}`}
              title={s.state === 'paused' ? t('Resume') : t('Pause')}
              disabled={busy}
              onClick={() => void onAct(() => invoke('schedules.pause', s.id, s.state !== 'paused'))}
            >
              {s.state === 'paused' ? <Play size={13} /> : <Pause size={13} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BTN}
            aria-label={`${t('Edit')} ${s.name}`}
            title={t('Edit')}
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BTN}
            aria-label={t('Delete {0}', { '0': s.name })}
            title={t('Delete')}
            disabled={busy}
            onClick={() => {
              if (confirm(t('Delete “{name}”? Its run threads will remain.', { name: s.name })))
                void onAct(() => invoke('schedules.delete', s.id))
            }}
          >
            <Trash2 size={13} />
          </Button>
        </span>
      </div>
      <p className="schedule-prompt m-0 truncate text-control text-soft" title={s.prompt}>
        {s.prompt}
      </p>
      {s.state === 'paused' && s.pausedReason && (
        <p className="schedule-paused m-0 text-caption text-bad" role="status">
          {s.pausedReason}
        </p>
      )}
      <div className="flex min-h-6 items-center gap-2 text-caption text-muted-foreground">
        <span className="min-w-0 truncate">{meta.join(' · ')}</span>
        <span className="min-w-0 flex-1" />
        {s.sourceTaskId && ws.tasks.some((task) => task.id === s.sourceTaskId) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 flex-none px-1.5 text-caption text-muted-foreground"
            onClick={() => ws.openTask(s.sourceTaskId!)}
          >
            {t('Open originating thread')}
          </Button>
        )}
        {webhook && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 flex-none gap-0.5 bg-transparent px-1.5 text-caption text-muted-foreground"
            aria-expanded={requestsOpen}
            onClick={() => setRequestsOpen(!requestsOpen)}
          >
            {t('Address and requests')}
            <ChevronRight size={12} className={`transition-transform ${requestsOpen ? 'rotate-90' : ''}`} />
          </Button>
        )}
        {runs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 flex-none gap-0.5 bg-transparent px-1.5 text-caption text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {t('Recent runs')} · {runs.length}
            <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </Button>
        )}
      </div>
      {webhook && requestsOpen && (
        <WebhookPanel schedule={s} runs={runs} invoke={invoke} readOnly={viewOnly} onOpenRun={onOpenRun} />
      )}
      {open && (
        <div className="schedule-history mt-1 flex flex-col border-t border-(--line) pt-1">
          {paged.shown.map((r) => (
            <div key={r.id} className="schedule-run flex min-h-8 items-center gap-2 text-caption">
              <span
                className={`flex-none rounded-full bg-hover px-2 text-caption whitespace-nowrap ${
                  isProblemRun(r.status) ? 'text-bad' : 'text-soft'
                }`}
              >
                {t(r.status)}
              </span>
              <span className="min-w-0 flex-1 truncate text-soft">
                {formatScheduleTime(r.dueAt, s.timezone)}
                {r.error && <span className="text-muted-foreground"> · {r.error}</span>}
                {r.retryAt && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('Retry: ')}
                    {formatScheduleTime(r.retryAt, s.timezone)}
                  </span>
                )}
              </span>
              {r.taskId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 flex-none px-1.5 text-caption text-muted-foreground"
                  onClick={() => onOpenRun(r)}
                >
                  {t('Open thread')}
                </Button>
              )}
            </div>
          ))}
          {paged.more}
        </div>
      )}
    </article>
  )
}

function ScheduleEditor({
  schedule,
  onClose,
  onSaved,
}: {
  schedule?: Schedule
  onClose: () => void
  onSaved: () => void
}) {
  useLanguage()
  const here = useHost()
  const computers = useComputers()
  const hosts = (computers?.computers ?? []).filter(
    (computer) => computer.id === here.id || computer.status === 'connected',
  )
  const [runsOn, setRunsOn] = useState(here.id)
  const [moved, setMoved] = useState<string | null>(null)
  const current = useWorkspace()
  const ws = useWorkspacesOf([runsOn])[0] ?? current,
    { initialSettings } = useModelSets()
  const invoke = invokerFor(runsOn)
  const [input, setInput] = useState<ScheduleInput>(
    () =>
      schedule ??
      defaultScheduleInput(
        initialSettings,
        systemTimezone(),
        ws.ui.activeTaskId ? (ws.projectOf(ws.ui.activeTaskId)?.id ?? null) : null,
      ),
  )
  const [previewLoading, setPreviewLoading] = useState(true)
  const [preview, setPreview] = useState<number[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  const [onceLocal, setOnceLocal] = useState(() => onceLocalValue(schedule?.rule, input.timezone))
  useEffect(() => {
    let disposed = false
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      void invoke('schedules.preview', input.rule, input.timezone).then(
        (dates) => {
          if (!disposed) {
            setPreview(dates)
            setPreviewLoading(false)
            setError(null)
          }
        },
        (e) => {
          if (!disposed) {
            setPreview([])
            setPreviewLoading(false)
            setError(errorText(e))
          }
        },
      )
    }, 200)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [input.rule, input.timezone] by design; the values it reads beyond these are current as of that run
  }, [input.rule, input.timezone])
  const rule = input.rule
  const setRule = (rule: ScheduleRule) => setInput((i) => ({ ...i, rule }))
  // A trigger's name and first prompt fill only what the person has not written yet.
  const fillFromPreset = (name: string, prompt: string) =>
    setInput((i) => ({ ...i, name: i.name.trim() ? i.name : name, prompt: i.prompt.trim() ? i.prompt : prompt }))
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      // A schedule moving to another host is created there first; the old one goes only after the person confirms.
      const saved = await invoke('schedules.save', input, runsOn === here.id ? schedule?.id : undefined)
      if (schedule && runsOn !== here.id && saved) setMoved(runsOn)
      else onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="schedule-editor p-5 [border:1px_solid_var(--line)] rounded-(--radius-m) mb-4 bg-fill">
      <div className="schedule-card-title [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:m-0 flex items-center gap-2">
        <h2>{schedule ? t('Edit schedule') : t('New schedule')}</h2>
        <span className="grow flex-1 min-w-0 text-left" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center"
          aria-label={t('Close schedule editor')}
          onClick={onClose}
          disabled={busy}
        >
          <X size={15} />
        </Button>
      </div>
      <fieldset
        disabled={busy}
        className="schedule-form [&_label]:flex [&_label]:flex-col [&_label]:gap-[7px] [&_label]:text-caption [&_input]:w-full [&_input]:p-[9px_10px] [&_input]:rounded-(--radius-s) [&_input]:[border:1px_solid_transparent] [&_input]:[background:var(--field)] [&_input]:text-inherit [&_input]:[font:inherit] [&_select]:w-full [&_select]:p-[9px_10px] [&_select]:rounded-(--radius-s) [&_select]:[border:1px_solid_transparent] [&_select]:[background:var(--field)] [&_select]:text-inherit [&_select]:[font:inherit] [&_textarea]:w-full [&_textarea]:p-[9px_10px] [&_textarea]:rounded-(--radius-s) [&_textarea]:[border:1px_solid_transparent] [&_textarea]:[background:var(--field)] [&_textarea]:text-inherit [&_textarea]:[font:inherit] [&_textarea]:resize-y [&_textarea]:leading-[1.5] [&_[data-slot='select-trigger']]:p-[9px_10px] [&_[data-slot='select-trigger']]:[background:var(--field)] [&_[data-slot='select-trigger']]:h-auto [border:0] p-0 mt-4 grid gap-4 min-w-0 grid-cols-1 min-[640px]:grid-cols-2 [&_>_*]:min-w-0 [&_>_:is(.schedule-wide,_.schedule-form-row,_.schedule-weekdays,_.schedule-preview,_p,_.error,_.schedule-form-actions)]:col-span-full"
      >
        {hosts.length > 1 && (
          <label className="schedule-wide col-span-full">
            {t('Runs on')}
            <Dropdown
              label={t('Runs on')}
              value={runsOn}
              onChange={(id) => {
                setRunsOn(id)
                // Projects are per host; the new host checks the model when the schedule is saved.
                setInput((current) => ({ ...current, projectId: NO_PROJECT, workspaceId: null }))
              }}
              options={hosts.map((computer) => ({ value: computer.id, label: computer.name }))}
            />
          </label>
        )}
        {moved && schedule && (
          <div className="schedule-wide col-span-full flex flex-wrap items-center gap-2 text-caption" role="status">
            {t('Saved on {0}. Remove it from {1}?', {
              0: hosts.find((computer) => computer.id === moved)?.name ?? '',
              1: hosts.find((computer) => computer.id === here.id)?.name ?? '',
            })}
            <Button
              size="xs"
              type="button"
              onClick={() =>
                void here.invoke('schedules.delete', schedule.id).then(onSaved, (e) => setError(errorText(e)))
              }
            >
              {t('Remove')}
            </Button>
            <Button size="xs" variant="ghost" type="button" onClick={onSaved}>
              {t('Keep both')}
            </Button>
          </div>
        )}
        <label className="schedule-wide col-span-full">
          {t('Name')}
          <Input
            value={input.name}
            maxLength={200}
            placeholder={t('Morning project check')}
            onChange={(e) => setInput({ ...input, name: e.target.value })}
          />
        </label>
        <label className="schedule-wide col-span-full">
          {t('What should the agent do?')}
          <Textarea
            rows={3}
            maxLength={100000}
            value={input.prompt}
            placeholder={t('Review unfinished work and identify the next useful action.')}
            onChange={(e) => setInput({ ...input, prompt: e.target.value })}
          />
        </label>
        <div className="schedule-form-row grid [grid-template-columns:1fr_1fr] gap-4">
          <label>
            {t('Scope')}
            <Dropdown
              label={t('Scope')}
              value={input.projectId}
              onChange={(projectId) => setInput({ ...input, projectId, workspaceId: null })}
              options={[
                { value: NO_PROJECT, label: t('No project') },
                ...ws.projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </label>
          {input.projectId !== NO_PROJECT && (
            <label>
              {t('Checkout')}
              <Dropdown
                label={t('Checkout')}
                value={input.workspaceId ?? ''}
                onChange={(workspaceId) => setInput({ ...input, workspaceId: workspaceId || null })}
                options={[
                  { value: '', label: t('Current checkout') },
                  ...ws.workspaces
                    .filter((w) => w.projectId === input.projectId)
                    .map((w) => ({ value: w.id, label: w.name })),
                ]}
              />
            </label>
          )}
        </div>
        <div className="contents">
          <label>
            {t('Frequency')}
            <Dropdown
              label={t('Frequency')}
              value={rule.kind}
              onChange={(kind) => {
                setRule(ruleForKind(kind as ScheduleRule['kind'], onceLocal, input.timezone))
                if (kind === 'webhook') fillFromPreset(t(WEBHOOK_PRESETS[0]!.label), WEBHOOK_PRESETS[0]!.prompt)
              }}
              options={RULE_KINDS.map((value) => ({
                value,
                label:
                  value === 'interval'
                    ? t('Every interval')
                    : value === 'webhook'
                      ? t('When a request arrives')
                      : t(value[0]!.toUpperCase() + value.slice(1)),
              }))}
            />
          </label>
        </div>
        {rule.kind === 'once' && (
          <label>
            {t('Run at')}
            <Input
              type="datetime-local"
              value={onceLocal}
              onChange={(e) => {
                setOnceLocal(e.target.value)
                setRule({ kind: 'once', at: onceIso(e.target.value, input.timezone) })
              }}
            />
          </label>
        )}
        {'time' in rule && (
          <label>
            {t('Time')}
            <Input type="time" value={rule.time} onChange={(e) => setRule({ ...rule, time: e.target.value })} />
          </label>
        )}
        {rule.kind === 'weekly' && (
          <div
            className="schedule-weekdays [&_label]:flex-row [&_label]:items-center [&_input]:w-auto flex gap-3"
            aria-label={t('Days of the week')}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
              <label key={day}>
                <Checkbox
                  checked={rule.weekdays.includes(i + 1)}
                  onCheckedChange={(checked) =>
                    setRule({ ...rule, weekdays: setWeekday(rule.weekdays, i + 1, checked === true) })
                  }
                />
                {day}
              </label>
            ))}
          </div>
        )}
        {rule.kind === 'monthly' && (
          <label>
            {t('Day of month')}
            <Input
              type="number"
              min={1}
              max={31}
              value={rule.day}
              onChange={(e) => setRule({ ...rule, day: Number(e.target.value) })}
            />
            <span className="muted text-muted-foreground small text-caption">
              {t('Months without this day are skipped.')}
            </span>
          </label>
        )}
        {rule.kind === 'webhook' && <WebhookFields rule={rule} onRule={setRule} onPreset={fillFromPreset} />}
        {rule.kind === 'interval' && (
          <label>
            {t('Every how many minutes?')}
            <Input
              type="number"
              min={5}
              value={rule.minutes}
              onChange={(e) => setRule({ ...rule, minutes: Number(e.target.value) })}
            />
          </label>
        )}
        {rule.kind !== 'webhook' && (
          <label className="schedule-wide col-span-full">
            {t('If the host is asleep or the service is stopped')}
            <Dropdown
              label={t('Missed runs')}
              value={input.missedPolicy}
              onChange={(missedPolicy) => setInput({ ...input, missedPolicy: missedPolicy as 'latest' | 'skip' })}
              options={[
                { value: 'latest', label: t('Run the latest missed occurrence once') },
                { value: 'skip', label: t('Skip missed occurrences') },
              ]}
            />
          </label>
        )}
        <div className="schedule-wide col-span-full">
          <AgentControls
            settings={input.settings}
            onChange={(settings) => setInput({ ...input, settings })}
            disabled={busy}
          />
        </div>
        {rule.kind !== 'webhook' && (
          <div className="schedule-preview grid gap-[7px] [background:var(--field)] rounded-(--radius-s) p-3">
            <strong className="small text-caption">{t('Upcoming runs')}</strong>
            {preview.map((at) => (
              <div className="muted text-muted-foreground small text-caption" key={at}>
                {formatScheduleTime(at, input.timezone)}
              </div>
            ))}
            {previewLoading && <ContentSkeleton rows={3} />}
            {!previewLoading && !preview.length && (
              <div className="muted text-muted-foreground small text-caption">{t('Choose a valid future time.')}</div>
            )}
          </div>
        )}
        <p className="muted text-muted-foreground small text-caption">
          {t('New schedules use your system timezone. Saved schedules keep their original timezone.')}
        </p>
        {error && (
          <div className="error text-bad small text-caption" role="alert">
            {error}
          </div>
        )}
        <div className="schedule-form-actions flex justify-end gap-2">
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={onClose} type="button">
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            type="button"
            className={PRIMARY_ACTION_CLASS}
            disabled={
              !canSaveSchedule({
                busy,
                previewLoading,
                preview,
                name: input.name,
                prompt: input.prompt,
                webhook: rule.kind === 'webhook',
              })
            }
            onClick={() => void save()}
          >
            {busy ? t('Saving…') : t('Save schedule')}
          </Button>
        </div>
      </fieldset>
    </section>
  )
}
export function BackgroundControls({ compact = false, onInstalled }: { compact?: boolean; onInstalled?: () => void }) {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  useLanguage()
  const app = useAppSettings()
  const [status, setStatus] = useState<BackgroundStatus | null>(null),
    [connected, setConnected] = useState(true),
    [busy, setBusy] = useState(false)
  const reload = () =>
    invoke('background.status').then(
      (s) => {
        setStatus(s)
        setConnected(true)
      },
      () => setConnected(false),
    )
  useEffect(() => {
    void reload()
    return on('background:connection', ({ connected }) => {
      setConnected(connected)
      if (connected) void reload()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
  }, [])
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e) {
      notifyError(errorText(e), 'Background service')
    } finally {
      setBusy(false)
    }
  }
  // Only the desktop can install a login item, and only for its own host on macOS or Linux with systemd.
  const loginSupported = !!status?.loginSupported
  // Running is the normal state and the status bar already shows when it is not; only a stopped service needs a prompt here.
  if (compact)
    return connected ? null : (
      <span className="inline-flex items-center gap-2 text-control text-muted-foreground" role="status">
        <span className="size-1.5 rounded-full bg-(--warn)" />
        {t('Background service stopped')}
        <Button
          variant="secondary"
          size="sm"
          className="bg-fill hover:bg-fill-hover"
          disabled={busy}
          onClick={() => void act(() => invoke('background.start'))}
        >
          {t('Start')}
        </Button>
      </span>
    )
  return (
    <>
      <SettingsRow className="">
        <span>
          <strong>{t('Background service')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Threads and schedules keep running when Ramu closes. The host must stay awake.')}
          </span>
          <span className="muted text-muted-foreground block block small text-caption">
            {connected ? t('Running · PID {0}', { '0': status?.pid ?? '…' }) : t('Stopped')}
          </span>
        </span>
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover"
          disabled={busy}
          onClick={() => void act(() => invoke(connected ? 'background.stop' : 'background.start'))}
        >
          {connected ? t('Stop') : t('Start')}
        </Button>
      </SettingsRow>
      {loginSupported && (
        <SettingsRow className="settings-toggle">
          <span>
            <strong>{t('Start at login')}</strong>
            <span className="muted text-muted-foreground small text-caption block block">
              {t('Start the background service when you sign in.')}
            </span>
          </span>
          <Switch
            aria-label={t('Start at login')}
            checked={status?.loginEnabled ?? false}
            disabled={busy || !connected}
            onCheckedChange={(checked) =>
              void act(async () => {
                const result = await invoke('background.login', checked)
                if (result?.firstInstall) {
                  onInstalled?.()
                  await app.reload()
                }
              })
            }
          />
        </SettingsRow>
      )}
      <TerminalCommandRow />
    </>
  )
}
/** The `ramu` command for this computer's terminals, which runs the CLI inside this app. */
function TerminalCommandRow() {
  const command = useTerminalCommand((message) => message && notifyError(message, 'Terminal command'))
  if (!command.status) return null
  return (
    <SettingsRow className="">
      <span>
        <strong>{t('Terminal command')}</strong>
        <span className="muted text-muted-foreground block small text-caption">
          {terminalCommandHelp(command.status)}
        </span>
      </span>
      <TerminalCommandButton command={command} />
    </SettingsRow>
  )
}

export function ScheduleChatCard({ schedule }: { schedule: Schedule }) {
  useLanguage()
  const ws = useWorkspace()
  const open = () => {
    ws.setSidebar('schedules')
    setTimeout(() => window.dispatchEvent(new CustomEvent('ramu:schedule', { detail: { id: schedule.id } })), 100)
  }
  return (
    <div className="schedule-chat-card [&_.block]:mt-[5px] flex items-start gap-3 [border:1px_solid_transparent] rounded-(--radius-m) m-[12px_0] p-[15px] bg-fill">
      <CalendarClock size={16} />
      <div className="grow flex-1 min-w-0 text-left">
        <strong>{schedule.name}</strong>
        <span className="muted text-muted-foreground small text-caption block block">
          {schedule.rule.kind === 'webhook'
            ? t('When a request arrives')
            : `${schedule.rule.kind === 'once' ? t('Runs once') : t(schedule.rule.kind)} · ${schedule.timezone}`}
        </span>
        <span className="small text-caption block block">
          {formatScheduleTime(schedule.nextRunAt, schedule.timezone)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
        onClick={open}
      >
        {t('Open schedule')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
        onClick={open}
      >
        {t('Edit')}
      </Button>
    </div>
  )
}
