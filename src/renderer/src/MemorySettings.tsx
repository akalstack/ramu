import { SettingsRow } from '@/components/settings-row'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Archive, Moon, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { t } from './i18n'
import { Dropdown } from './Menu'
import { SearchInput } from './SearchInput'
import { invoke, ramu } from './ipc'
import { notifyError } from './Notifications'
import { useWorkspace } from './workspace'
import { providerName } from '../../shared/providers'
import { MEMORY_KINDS, NO_PROJECT, type Memory, type MemoryInput, type MemoryKind, type MemoryPreferences, type MemorySnapshot } from '../../shared/types'

const KIND_LABELS: Record<MemoryKind, string> = { user: 'About you', feedback: 'Feedback', project: 'Project', reference: 'Reference' }
const GLOBAL = 'global'

export function MemorySettings({ value, onChange }: { value: MemoryPreferences; onChange: (value: MemoryPreferences) => void }) {
  return <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
    <SettingsRow className="settings-toggle"><span><strong>{t('Shared memory')}</strong><span className="muted text-muted-foreground block small text-caption">{t("Share saved notes across providers. Applies to chats started after saving.")}</span></span><Switch aria-label={t('Shared memory')} checked={value.enabled} onCheckedChange={(enabled) => onChange({ ...value, enabled })} /></SettingsRow>
    {value.enabled && <>
      <SettingsRow className="settings-toggle"><span><strong>{t("Memory cleanup")}</strong><span className="muted text-muted-foreground block small text-caption">{t("Merge duplicate notes and archive outdated memory daily. Uses model tokens. Changes can be restored.")}</span></span><Switch aria-label={t("Memory cleanup")} checked={value.dream} onCheckedChange={(dream) => onChange({ ...value, dream })} /></SettingsRow>
      <SettingsRow className=""><span><strong>{t('Archive unused memories after')}</strong><span className="muted text-muted-foreground block small text-caption">{t("Archive unused project notes after this period. Your notes and essential memories are kept.")}</span></span><Dropdown label={t('Archive unused memories after')} value={String(value.staleAfterDays)} options={[...new Set([30, 60, 90, 180, 365, value.staleAfterDays])].sort((a, b) => a - b).map((days) => ({ value: String(days), label: t('{0} days', { 0: days }) }))} onChange={(days) => onChange({ ...value, staleAfterDays: Number(days) })} /></SettingsRow>
      <MemoryBrowser />
    </>}
  </div>
}

function MemoryBrowser() {
  const ws = useWorkspace()
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [status, setStatus] = useState<Memory['status']>('active')
  const [editing, setEditing] = useState<{ id?: string; input: MemoryInput } | null>(null)
  const reload = useCallback(() => invoke('memory.get').then(setSnapshot), [])
  useEffect(() => { void reload().catch((e) => notifyError(String(e), 'Memory')); return ramu.on('memory:changed', () => { void reload().catch(() => {}) }) }, [reload])
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload() } catch (e) { notifyError(String(e), 'Memory') } }
  const projects = ws.projects.filter((p) => p.id !== NO_PROJECT)
  const projectName = (id: string | null) => id ? projects.find((p) => p.id === id)?.name ?? t('Removed project') : t('All projects')
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (snapshot?.memories ?? []).filter((m) => m.status === status && (scope === 'all' || (scope === GLOBAL ? m.projectId === null : m.projectId === scope)) && words.every((w) => `${m.title} ${m.content} ${m.tags.join(' ')}`.toLowerCase().includes(w)))
  const author = (m: Memory) => m.source.actor === 'agent' && m.source.provider ? providerName(m.source.provider) : m.source.actor === 'dream' ? t("Memory cleanup") : t('You')
  const save = () => editing && act(async () => { await invoke('memory.save', editing.input, editing.id); setEditing(null) })
  return <div className="memory-browser flex flex-col gap-2 mt-5">
    <div className="flex items-center gap-2">
      <SearchInput className="flex-1 min-w-0" aria-label={t('Search memories')} placeholder={t('Search memories')} value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} />
      <Dropdown className="w-[150px]! flex-none" label={t('Scope')} value={scope} options={[{ value: 'all', label: t('Everything') }, { value: GLOBAL, label: t('All projects') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={setScope} />
      <Dropdown className="w-[120px]! flex-none" label={t('Status')} value={status} options={[{ value: 'active', label: t('Active') }, { value: 'archived', label: t('Archived') }]} onChange={(s) => setStatus(s === 'archived' ? 'archived' : 'active')} />
      <Button variant="secondary" className="bg-fill hover:bg-fill-hover flex-none h-8! min-h-8!" onClick={() => setEditing({ input: { projectId: scope !== 'all' && scope !== GLOBAL ? scope : null, kind: 'feedback', title: '', content: '', tags: [], importance: 3 } })}><Plus size={13} />{t('Add')}</Button>
    </div>
    <div className="flex items-center gap-2 small text-caption text-muted-foreground">
      <span>{snapshot?.dreaming ? t("Cleaning up memory…") : snapshot?.dreamedAt ? t("Last cleanup {0}", { 0: DateTime.fromMillis(snapshot.dreamedAt).toRelative() ?? '' }) : t("Not cleaned up yet")}</span>
      {snapshot?.error && <span className="text-bad" role="alert">{snapshot.error}</span>}
      <span className="grow" />
      <Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground small text-caption" disabled={!snapshot || snapshot.dreaming} onClick={() => void act(() => invoke('memory.dream'))}><Moon size={12} />{t("Clean up memory")}</Button>
    </div>
    {editing && !editing.id && <MemoryEditor value={editing.input} projects={projects} onChange={(input) => setEditing({ ...editing, input })} onSave={() => void save()} onCancel={() => setEditing(null)} />}
    {snapshot && !shown.length && <p className="muted text-muted-foreground small text-caption py-6 text-center">{status === 'archived' ? t("No archived memories.") : t("No saved memories.")}</p>}
    {shown.map((m) => editing?.id === m.id
      ? <MemoryEditor key={m.id} value={editing.input} projects={projects} onChange={(input) => setEditing({ ...editing, input })} onSave={() => void save()} onCancel={() => setEditing(null)} />
      : <article key={m.id} className="memory-card group bg-card rounded-(--radius-m) p-3 [border:1px_solid_transparent]">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary">{t(KIND_LABELS[m.kind])}</Badge>
          <span className="muted text-muted-foreground small text-caption">{projectName(m.projectId)}</span>
          {m.importance >= 4 && <span className="muted text-muted-foreground small text-caption">{m.importance >= 5 ? t('Essential') : t('Important')}</span>}
          <span className="grow" />
          {m.status === 'active'
            ? <><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center" aria-label={t('Edit memory')} onClick={() => setEditing({ id: m.id, input: { projectId: m.projectId, kind: m.kind, title: m.title, content: m.content, tags: m.tags, importance: m.importance, expiresAt: m.expiresAt } })}><Pencil size={12} /></Button>
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center" aria-label={t('Archive memory')} onClick={() => void act(() => invoke('memory.archive', m.id))}><Archive size={12} /></Button></>
            : <><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center" aria-label={t('Restore memory')} onClick={() => void act(() => invoke('memory.restore', m.id))}><RotateCcw size={12} /></Button>
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center" aria-label={t('Delete memory')} onClick={() => void act(() => invoke('memory.delete', m.id))}><Trash2 size={12} /></Button></>}
        </div>
        <h4 className="text-body font-medium m-0">{m.title}</h4>
        <p className="muted text-muted-foreground whitespace-pre-wrap leading-[1.5] m-[4px_0_6px] line-clamp-4">{m.content}</p>
        <span className="muted text-muted-foreground small text-caption">{[t('Saved by {0}', { 0: author(m) }), t('Used {0}×', { 0: m.useCount }), t('Updated {0}', { 0: DateTime.fromMillis(m.updatedAt).toRelative() ?? '' }), ...(m.archivedReason ? [m.archivedReason] : [])].join(' · ')}</span>
      </article>)}
  </div>
}

function MemoryEditor({ value, projects, onChange, onSave, onCancel }: { value: MemoryInput; projects: { id: string; name: string }[]; onChange: (value: MemoryInput) => void; onSave: () => void; onCancel: () => void }) {
  return <div className="memory-editor flex flex-col gap-2 bg-card rounded-(--radius-m) p-3 [border:1px_solid_var(--edge)]">
    <div className="flex items-center gap-2">
      <Dropdown label={t('Kind')} value={value.kind} options={MEMORY_KINDS.map((kind) => ({ value: kind, label: t(KIND_LABELS[kind]) }))} onChange={(kind) => onChange({ ...value, kind: kind as MemoryKind })} />
      <Dropdown label={t('Scope')} value={value.projectId ?? GLOBAL} options={[{ value: GLOBAL, label: t('All projects') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(scope) => onChange({ ...value, projectId: scope === GLOBAL ? null : scope })} />
      <Dropdown label={t('Importance')} value={String(value.importance ?? 3)} options={[{ value: '1', label: t('Minor') }, { value: '3', label: t('Normal') }, { value: '4', label: t('Important') }, { value: '5', label: t('Essential') }, ...(value.importance === 2 ? [{ value: '2', label: '2' }] : [])]} onChange={(importance) => onChange({ ...value, importance: Number(importance) })} />
    </div>
    <Input aria-label={t('Title')} placeholder={t('Title')} value={value.title} maxLength={160} onChange={(e) => onChange({ ...value, title: e.target.value })} />
    <Textarea aria-label={t('Memory')} placeholder={t('What should every agent remember?')} value={value.content} maxLength={4000} rows={4} onChange={(e) => onChange({ ...value, content: e.target.value })} />
    <div className="flex justify-end gap-2">
      <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={onCancel}>{t('Cancel')}</Button>
      <Button variant="default" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover" disabled={!value.title.trim() || !value.content.trim()} onClick={onSave}>{t('Save memory')}</Button>
    </div>
  </div>
}
