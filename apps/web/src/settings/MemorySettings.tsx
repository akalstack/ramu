import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { ListToolbar, useListView } from './ListView'
import { useSettingsInvoke } from './SettingsScope'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { errorText } from '../lib/errors'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Archive, History, Moon, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { takeLibraryFocus } from '../summaries/libraryFocus'
import { DateTime } from 'luxon'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { useWorkspace } from '../workspace/workspace'
import { providerName } from '@ramu/shared/providers/providers'
import { memorySourceThread } from '@ramu/shared/chat/memorySource'
import {
  MEMORY_KINDS,
  NO_PROJECT,
  type Memory,
  type MemoryInput,
  type MemoryKind,
  type MemoryPreferences,
  type MemorySnapshot,
} from '@ramu/shared/types'

const KIND_LABELS: Record<MemoryKind, string> = {
  user: 'About you',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
}
const GLOBAL = 'global'

export function MemorySettings({
  value,
  onChange,
}: {
  value: MemoryPreferences
  onChange: (value: MemoryPreferences) => void
}) {
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      <SettingsGroupTitle>{t('Memory')}</SettingsGroupTitle>
      <SettingsRow setting="memory.enabled">
        <SettingsLabel
          title={t('Shared memory')}
          help={t(
            'Agents on every provider read and save the same notes, including during threads. Learning also saves lasting lessons after threads. Applies when a thread starts or restarts.',
          )}
        />
        <Switch
          aria-label={t('Shared memory')}
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </SettingsRow>
      {value.enabled && (
        <>
          <SettingsRow setting="memory.dream">
            <SettingsLabel
              title={t('Memory cleanup')}
              help={t(
                'Once a day, merge duplicates and archive unused notes. Notes you wrote are never changed. Uses model tokens. Anything archived can be restored.',
              )}
            />
            <Switch
              aria-label={t('Memory cleanup')}
              checked={value.dream}
              onCheckedChange={(dream) => onChange({ ...value, dream })}
            />
          </SettingsRow>
          <SettingsRow setting="memory.staleAfterDays">
            <SettingsLabel
              title={t('Archive unused memories after')}
              help={t('Applies to project notes nobody has used. Notes you wrote and essential memories are kept.')}
            />
            <Dropdown
              label={t('Archive unused memories after')}
              value={String(value.staleAfterDays)}
              options={[...new Set([30, 60, 90, 180, 365, value.staleAfterDays])]
                .sort((a, b) => a - b)
                .map((days) => ({ value: String(days), label: t('{0} days', { 0: days }) }))}
              onChange={(days) => onChange({ ...value, staleAfterDays: Number(days) })}
            />
          </SettingsRow>
        </>
      )}
    </div>
  )
}

export function MemoryBrowser() {
  const invoke = useSettingsInvoke()
  const ws = useWorkspace()
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)
  const [history, setHistory] = useState<{
    id: string
    entries: Awaited<ReturnType<typeof ramu.invoke<'memory.history'>>>
  } | null>(null)
  const [scope, setScope] = useState('all')
  const [status, setStatus] = useState<Memory['status']>('active')
  const view = useListView(snapshot?.memories ?? [], {
    text: (m) => `${m.title} ${m.content} ${m.tags.join(' ')}`,
    match: (m) =>
      m.status === status && (scope === 'all' || (scope === GLOBAL ? m.projectId === null : m.projectId === scope)),
    filterKey: `${scope}|${status}`,
  })
  const { setQuery } = view
  const [editing, setEditing] = useState<{ id?: string; input: MemoryInput } | null>(null)
  const reload = useCallback(() => invoke('memory.get').then(setSnapshot), [])
  // A summary item that was clicked: show just that note, wherever it is.
  const focused = useRef<{ id: string; title: string } | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  useEffect(() => {
    const take = () => {
      const item = takeLibraryFocus('memory')
      if (!item) return
      focused.current = item
      setQuery(item.title)
      setScope('all')
    }
    take()
    window.addEventListener('ramu:library-focus', take)
    return () => window.removeEventListener('ramu:library-focus', take)
  }, [setQuery])
  useEffect(() => {
    const target = focused.current && snapshot?.memories.find((m) => m.id === focused.current!.id)
    if (!target) return
    focused.current = null
    setStatus(target.status)
    setFocusedId(target.id)
  }, [snapshot])
  useEffect(() => {
    if (!focusedId) return
    const card = document.getElementById(`memory-${focusedId}`)
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    card?.classList.add('flash')
    const timer = window.setTimeout(() => card?.classList.remove('flash'), 1400)
    return () => window.clearTimeout(timer)
  }, [focusedId, status])
  useEffect(() => {
    void reload().catch((e) => notifyError(errorText(e), 'Memory'))
    return ramu.on('memory:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload])
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await reload()
    } catch (e) {
      notifyError(errorText(e), 'Memory')
    }
  }
  const projects = ws.projects.filter((p) => p.id !== NO_PROJECT)
  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? t('Removed project')) : t('All projects')
  const shown = view.matched
  const paged = view.paged
  const author = (m: Memory) =>
    m.source.actor === 'agent' && m.source.provider
      ? providerName(m.source.provider)
      : m.source.actor === 'dream'
        ? t('Memory cleanup')
        : t('You')
  const save = () =>
    editing &&
    act(async () => {
      await invoke('memory.save', editing.input, editing.id)
      setEditing(null)
    })
  return (
    <div className="memory-browser flex flex-col gap-2 mt-2">
      <SettingsGroupTitle className="mt-6 mb-1">
        {t('Saved memories')}
        {snapshot && shown.length > 0 ? ` · ${shown.length}` : ''}
      </SettingsGroupTitle>
      <ListToolbar
        view={view}
        alwaysShow
        label={t('Search memories')}
        filters={[
          {
            key: 'scope',
            label: t('Scope'),
            width: 'wide',
            value: scope,
            options: [
              { value: 'all', label: t('Everything') },
              { value: GLOBAL, label: t('All projects') },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ],
            onChange: setScope,
          },
          {
            key: 'status',
            label: t('Status'),
            value: status,
            options: [
              { value: 'active', label: t('Active') },
              { value: 'archived', label: t('Archived') },
            ],
            onChange: (s) => setStatus(s === 'archived' ? 'archived' : 'active'),
          },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              className="bg-fill hover:bg-fill-hover flex-none h-8! min-h-8!"
              onClick={() =>
                setEditing({
                  input: {
                    projectId: scope !== 'all' && scope !== GLOBAL ? scope : null,
                    kind: 'feedback',
                    title: '',
                    content: '',
                    tags: [],
                    importance: 3,
                  },
                })
              }
            >
              <Plus size={13} />
              {t('Add')}
            </Button>
          </>
        }
      />
      <div className="flex items-center gap-2 small text-caption text-muted-foreground">
        <span>
          {snapshot?.dreaming
            ? t('Cleaning up memory…')
            : snapshot?.dreamedAt
              ? t('Last cleanup {0}', { 0: DateTime.fromMillis(snapshot.dreamedAt).toRelative() ?? '' })
              : t('Not cleaned up yet')}
        </span>
        {snapshot?.error && (
          <span className="text-bad" role="alert">
            {snapshot.error}
          </span>
        )}
        <span className="grow" />
        <Button
          variant="ghost"
          size="sm"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground small text-caption"
          disabled={!snapshot || snapshot.dreaming}
          onClick={() => void act(() => invoke('memory.dream'))}
        >
          <Moon size={12} />
          {t('Clean up memory')}
        </Button>
      </div>
      {editing && !editing.id && (
        <MemoryEditor
          value={editing.input}
          projects={projects}
          onChange={(input) => setEditing({ ...editing, input })}
          onSave={() => void save()}
          onCancel={() => setEditing(null)}
        />
      )}
      {snapshot && !shown.length && (
        <p className="muted text-muted-foreground small text-caption py-6 text-center">
          {status === 'archived' ? t('No archived memories.') : t('No saved memories.')}
        </p>
      )}
      {paged.shown.map((m) =>
        editing?.id === m.id ? (
          <MemoryEditor
            key={m.id}
            value={editing.input}
            projects={projects}
            onChange={(input) => setEditing({ ...editing, input })}
            onSave={() => void save()}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <article
            key={m.id}
            id={`memory-${m.id}`}
            className="memory-card [&.flash]:[animation:settings-flash_1.4s_ease-out] group bg-fill rounded-(--radius-m) px-3 py-2 [border:1px_solid_transparent]"
          >
            <div className="flex min-h-7 items-center gap-2">
              <Badge variant="secondary">{t(KIND_LABELS[m.kind])}</Badge>
              <span className="muted text-muted-foreground small text-caption">{projectName(m.projectId)}</span>
              {m.importance >= 4 && (
                <span className="muted text-muted-foreground small text-caption">
                  {m.importance >= 5 ? t('Essential') : t('Important')}
                </span>
              )}
              <span className="grow" />
              {m.status === 'active' ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center"
                    aria-label={t('Edit memory')}
                    onClick={() =>
                      setEditing({
                        id: m.id,
                        input: {
                          projectId: m.projectId,
                          kind: m.kind,
                          title: m.title,
                          content: m.content,
                          tags: m.tags,
                          importance: m.importance,
                          expiresAt: m.expiresAt,
                        },
                      })
                    }
                  >
                    <Pencil size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center"
                    aria-label={t('Archive memory')}
                    onClick={() => void act(() => invoke('memory.archive', m.id))}
                  >
                    <Archive size={12} />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center"
                    aria-label={t('Restore memory')}
                    onClick={() => void act(() => invoke('memory.restore', m.id))}
                  >
                    <RotateCcw size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center"
                    aria-label={t('Delete memory')}
                    onClick={() => void act(() => invoke('memory.delete', m.id))}
                  >
                    <Trash2 size={12} />
                  </Button>
                </>
              )}
            </div>
            <h4 className="text-body font-medium m-0">{m.title}</h4>
            <p className="muted text-muted-foreground whitespace-pre-wrap leading-[1.5] m-[2px_0_4px] line-clamp-3">
              {m.content}
            </p>
            <div className="flex items-center gap-2">
              <span className="muted text-muted-foreground small text-caption">
                {[
                  t('Saved by {0}', { 0: author(m) }),
                  t('Used {0}×', { 0: m.useCount }),
                  t('Updated {0}', { 0: DateTime.fromMillis(m.updatedAt).toRelative() ?? '' }),
                  ...(m.archivedReason ? [m.archivedReason] : []),
                ].join(' · ')}
              </span>
              <span className="grow" />
              <MemorySource memory={m} />
              <Button
                variant="ghost"
                size="sm"
                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground small text-caption"
                aria-label={t('Memory history')}
                onClick={() =>
                  void act(async () => setHistory({ id: m.id, entries: await invoke('memory.history', m.id) }))
                }
              >
                <History size={12} />
                {t('History')}
              </Button>
            </div>
            {history?.id === m.id && (
              <div className="flex flex-col gap-2">
                {history.entries.map((entry, index) => (
                  <details key={index}>
                    <summary>
                      {new Date(entry.at).toLocaleString()} · {entry.actor} · {entry.reason ?? entry.action}
                    </summary>
                    <div className="grid grid-cols-2 gap-2 text-caption">
                      <div>
                        <strong>{t('Earlier revision')}</strong>
                        <pre className="whitespace-pre-wrap">{entry.before?.content ?? t('No earlier text')}</pre>
                      </div>
                      <div>
                        <strong>{t('Current memory')}</strong>
                        <pre className="whitespace-pre-wrap">{m.content}</pre>
                      </div>
                    </div>
                    {entry.before?.content && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void act(async () => {
                            await invoke('memory.revert', m.id, index, m.updatedAt)
                            setHistory(null)
                          })
                        }
                      >
                        {t('Restore revision')}
                      </Button>
                    )}
                  </details>
                ))}
              </div>
            )}
          </article>
        ),
      )}
      {paged.more}
    </div>
  )
}

function MemoryEditor({
  value,
  projects,
  onChange,
  onSave,
  onCancel,
}: {
  value: MemoryInput
  projects: { id: string; name: string }[]
  onChange: (value: MemoryInput) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="memory-editor flex flex-col gap-2 bg-card rounded-(--radius-m) p-3 [border:1px_solid_var(--edge)]">
      <div className="flex items-center gap-2">
        <Dropdown
          label={t('Kind')}
          value={value.kind}
          options={MEMORY_KINDS.map((kind) => ({ value: kind, label: t(KIND_LABELS[kind]) }))}
          onChange={(kind) => onChange({ ...value, kind: kind as MemoryKind })}
        />
        <Dropdown
          label={t('Scope')}
          value={value.projectId ?? GLOBAL}
          options={[
            { value: GLOBAL, label: t('All projects') },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(scope) => onChange({ ...value, projectId: scope === GLOBAL ? null : scope })}
        />
        <Dropdown
          label={t('Importance')}
          value={String(value.importance ?? 3)}
          options={[
            { value: '1', label: t('Minor') },
            { value: '3', label: t('Normal') },
            { value: '4', label: t('Important') },
            { value: '5', label: t('Essential') },
            ...(value.importance === 2 ? [{ value: '2', label: '2' }] : []),
          ]}
          onChange={(importance) => onChange({ ...value, importance: Number(importance) })}
        />
      </div>
      <Input
        aria-label={t('Title')}
        placeholder={t('Title')}
        value={value.title}
        maxLength={160}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
      />
      <Textarea
        aria-label={t('Memory')}
        placeholder={t('What should every agent remember?')}
        value={value.content}
        maxLength={4000}
        rows={4}
        onChange={(e) => onChange({ ...value, content: e.target.value })}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button
          variant="default"
          className={PRIMARY_ACTION_CLASS}
          disabled={!value.title.trim() || !value.content.trim()}
          onClick={onSave}
        >
          {t('Save memory')}
        </Button>
      </div>
    </div>
  )
}

/** The thread a note was saved in: a link while that thread exists, a plain note once it is gone. */
function MemorySource({ memory }: { memory: Memory }) {
  const ws = useWorkspace()
  const source = memorySourceThread(memory.source, new Set(ws.tasks.map((task) => task.id)))
  if (source.state === 'none') return null
  if (source.state === 'unavailable')
    return <span className="text-muted-foreground small text-caption">{t('Source thread unavailable')}</span>
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground small text-caption"
      onClick={() => {
        ws.openTask(source.taskId)
        if (source.sessionId && source.eventSeq !== undefined) {
          ws.openView(source.taskId, { kind: 'agent', sessionId: source.sessionId, sourceSeq: source.eventSeq })
          window.dispatchEvent(
            new CustomEvent('ramu:source-event', { detail: { sessionId: source.sessionId, seq: source.eventSeq } }),
          )
        }
      }}
    >
      {t('Open source thread')}
    </Button>
  )
}
