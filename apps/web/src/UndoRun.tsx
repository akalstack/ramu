import { t, useLanguage } from './i18n'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/desktop-button'
import { useEffect, useRef, useState } from 'react'
import { RotateCcw, RefreshCw, FileText } from 'lucide-react'
import type { UndoPreview } from '@ramu/shared/types'
import { Dialog } from './Menu'
import { invoke } from './ipc'
import { useWorkspace } from './workspace'
import { ReviewDiff } from './ReviewDiff'
import { errorText } from './TaskPane'

export function UndoRun(props: { sessionId: string; userSeq: number; onRestored: () => void }) {
  return <UndoFiles {...props} />
}

export function UndoReview({ reviewId, disabled = false }: { reviewId: string; disabled?: boolean }) {
  return <UndoFiles reviewId={reviewId} disabled={disabled} onRestored={() => {}} />
}

function UndoFiles({ sessionId, userSeq, reviewId, disabled = false, onRestored }: { sessionId?: string; userSeq?: number; reviewId?: string; disabled?: boolean; onRestored: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const [preview, setPreview] = useState<UndoPreview | null>(null), [selected, setSelected] = useState<Set<string>>(new Set())
  const [fileId, setFileId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const dirty = Object.values(ws.dirty).some(Boolean)
  useEffect(() => { generation.current++; setPreview(null); setError(null); setBusy(false); return () => { generation.current++ } }, [sessionId, userSeq, reviewId])
  const load = async () => { const request = ++generation.current; setBusy(true); setError(null); try {
    if (dirty) throw new Error('Save or close unsaved files before previewing a restore.')
    const plan = reviewId ? await invoke('reviews.undoPreview', reviewId) : await invoke('reviews.chatUndoPreview', sessionId!, userSeq!); if (request !== generation.current) return; setPreview(plan); setSelected(new Set(plan.files.filter((f) => f.status === 'ready').map((f) => f.fileId))); setFileId(plan.files[0]?.fileId ?? null)
  } catch (e) { if (request === generation.current) setError(errorText(e)) } finally { if (request === generation.current) setBusy(false) } }
  const apply = async () => { if (!preview || !selected.size) return; setBusy(true); setError(null); try {
    if (Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved files before restoring files.')
    if (reviewId) await invoke('reviews.undoApply', preview.token, [...selected])
    else await invoke('reviews.chatUndoApply', preview.token, [...selected])
    onRestored()
    setPreview(null)
    window.dispatchEvent(new Event('ramu:git-updated'))
  } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  const file = preview?.files.find((f) => f.fileId === fileId)
  const ready = preview?.files.filter((f) => f.status === 'ready') ?? []
  const statusLabel = { ready: t('Ready'), conflict: t('Conflict'), unchanged: t('No changes'), unavailable: t('Unavailable') }
  return <><Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" disabled={busy || disabled} onClick={() => void load()}>{busy && !preview ? t('Preparing restore…') : reviewId ? t('Undo') : t('Preview restore')}<RotateCcw size={13} /></Button>{error && !preview && <span className="error text-bad small text-caption" role="alert">{error}</span>}
    {preview && <Dialog title={reviewId ? t('Undo these changes') : t('Restore files before this message')} confirmLabel={t('Restore selected files · {0}', { '0': selected.size })} confirmDisabled={!selected.size || dirty} danger busy={busy} error={error} onConfirm={() => void apply()} onCancel={() => { if (!busy) setPreview(null) }}>
      <div className="undo-preview">
        <p className="undo-description m-[0_0_12px] text-muted-foreground">{reviewId ? t('Undo selected changes from this turn. Later edits are preserved when possible. Chat history stays available.') : t('Restore selected file changes from this message and later runs, then send your revised message. Chat history stays available.')}</p>
        <div className="undo-toolbar flex items-center justify-between gap-3 mb-2.5"><label className="row flex gap-1.5 mt-2"><Checkbox aria-label={t('Select all eligible files')} disabled={busy || !ready.length} indeterminate={selected.size > 0 && selected.size < ready.length} checked={!!ready.length && selected.size === ready.length} onCheckedChange={(checked) => setSelected(new Set(checked === true ? ready.map((f) => f.fileId) : []))} /><span className="muted text-muted-foreground small text-caption">{t('{0} of {1} eligible files selected', { '0': selected.size, '1': ready.length })}</span></label><Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" disabled={busy} onClick={() => void load()}><RefreshCw size={13} />{t('Refresh preview')}</Button></div>
        <div className="undo-layout grid [grid-template-columns:240px_minmax(0,_1fr)] h-[min(440px,_55vh)] [border:1px_solid_var(--edge)] rounded-(--radius-m) overflow-hidden"><div className="undo-files overflow-y-auto [border-right:1px_solid_var(--line)] p-1.5 bg-card" aria-label={t('Files to restore')}>{preview.files.map((f) => <div key={f.fileId} className={`undo-file [&.active]:bg-brand-wash [&_>_button]:flex-1 [&_>_button]:min-w-0 [&_>_button]:grid [&_>_button]:[justify-content:start] [&_>_button]:gap-[3px] [&_>_button]:p-[5px_0] [&_>_button]:text-left [&_>_button]:whitespace-normal [&_.chip]:[justify-self:start] [&_.chip]:text-[length:10px] [&.conflict_.chip]:text-warn [&.unavailable_.chip]:text-warn [&.ready_.chip]:text-ok flex items-center gap-2 p-[4px_8px] rounded-(--radius-m) ${f.status}${fileId === f.fileId ? ' active' : ''}`}><Checkbox aria-label={t('Restore {0}', { '0': f.path })} disabled={busy || f.status !== 'ready'} checked={selected.has(f.fileId)} onCheckedChange={(checked) => setSelected((s) => { const next = new Set(s); checked === true ? next.add(f.fileId) : next.delete(f.fileId); return next })} /><Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" aria-pressed={fileId === f.fileId} onClick={() => setFileId(f.fileId)}><span className="undo-file-path [overflow-wrap:anywhere] text-control">{f.path}</span><span className="muted text-muted-foreground small text-caption">{f.repoName}</span><Badge variant="outline" className="chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap">{statusLabel[f.status]}</Badge></Button></div>)}{!preview.files.length && <div className="undo-empty [&_p]:max-w-[380px] [&_p]:m-0 flex flex-col items-center justify-center gap-2.5 h-full p-6 text-center text-muted-foreground"><FileText size={20} /><span>{t('No file changes to restore')}</span></div>}</div>
          <div className="undo-detail [&_.review-diff-wrap]:flex-1 [&_.review-diff-wrap]:min-h-0 [&_.review-diff-wrap]:flex [&_.review-diff-wrap]:flex-col [&_.review-diff]:flex-1 [&_.review-diff]:min-h-0 [&_.review-diff]:h-auto flex flex-col min-w-0 min-h-0">{file ? <><div className="undo-detail-heading [&_strong]:[overflow-wrap:anywhere] [&_>_span]:shrink-0 flex items-center justify-between gap-3 p-[10px_12px] [border-bottom:1px_solid_var(--line)] text-caption"><strong>{file.path}</strong><span className="muted text-muted-foreground small text-caption">{t('Current → after restore')}</span></div>{file.status === 'ready' ? <ReviewDiff file={{ id: `${preview.token}:${file.fileId}`, repoId: '', repoName: file.repoName, path: file.path, status: file.remove ? 'deleted' : 'modified', binary: false, oldContent: file.currentContent, newContent: file.remove ? '' : file.resultContent }} comments={[]} onSelect={() => {}} /> : <div className="undo-empty [&_p]:max-w-[380px] [&_p]:m-0 flex flex-col items-center justify-center gap-2.5 h-full p-6 text-center text-muted-foreground"><FileText size={20} /><strong>{statusLabel[file.status]}</strong><p>{file.reason}</p></div>}</> : <div className="undo-empty [&_p]:max-w-[380px] [&_p]:m-0 flex flex-col items-center justify-center gap-2.5 h-full p-6 text-center text-muted-foreground">{t('Select a file to preview its changes')}</div>}</div>
        </div>
        <p className="muted text-muted-foreground small text-caption undo-note m-[12px_0_0]">{t('Later edits are preserved when they merge cleanly. Conflicted files stay untouched. Files are checked again before restoring; local backups are retained.')}</p>
      </div>
    </Dialog>}
  </>
}
