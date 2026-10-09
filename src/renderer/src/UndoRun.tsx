import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ChangeReview, UndoPreview } from '../../shared/types'
import { Dialog } from './Menu'
import { invoke } from './ipc'
import { useWorkspace } from './workspace'
import { ReviewDiff } from './ReviewDiff'

export function UndoRun({ review, onChanged }: { review: ChangeReview; onChanged: (r: ChangeReview) => void }) {
  const ws = useWorkspace()
  const [preview, setPreview] = useState<UndoPreview | null>(null), [selected, setSelected] = useState<Set<string>>(new Set())
  const [fileId, setFileId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const dirty = Object.values(ws.dirty).some(Boolean)
  useEffect(() => { setPreview(null); setError(null) }, [review.id])
  const load = async () => { setBusy(true); setError(null); try {
    if (dirty) throw new Error('Save or close unsaved files before previewing undo.')
    const plan = await invoke('reviews.undoPreview', review.id); setPreview(plan); setSelected(new Set(plan.files.filter((f) => f.status === 'ready').map((f) => f.fileId))); setFileId(plan.files[0]?.fileId ?? null)
  } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const apply = async () => { if (!preview || !selected.size) return; setBusy(true); setError(null); try {
    if (Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved files before undoing.')
    const r = await invoke('reviews.undoApply', preview.token, [...selected]); onChanged(r); setPreview(null)
    window.dispatchEvent(new Event('ramu:git-updated'))
  } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const file = preview?.files.find((f) => f.fileId === fileId)
  return <><Button className="ghost small" disabled={busy || review.state !== 'ready' || !review.files.some((f) => !review.undoFileIds?.includes(f.id))} onClick={() => void load()}><RotateCcw size={13} />{busy && !preview ? 'Preparing undo…' : 'Preview undo'}</Button>{error && !preview && <span className="error small" role="alert">{error}</span>}
    {preview && <Dialog title="Undo this agent run" confirmLabel={`Undo selected files · ${selected.size}`} confirmDisabled={!selected.size || dirty} danger busy={busy} error={error} onConfirm={() => void apply()} onCancel={() => { if (!busy) setPreview(null) }}>
      <div className="undo-preview"><p>Review the proposed changes below. Clean merges preserve later edits. Conflicted and unavailable files stay untouched.</p><p className="muted small">This preview expires in 10 minutes. Files are checked again before applying. Local backups are retained.</p>
        <Button className="ghost small" disabled={busy} onClick={() => void load()}>Refresh undo preview</Button><div className="undo-files">{preview.files.map((f) => <div key={f.fileId} className={`undo-file ${f.status}`}><Checkbox aria-label={`Undo ${f.path}`} disabled={busy || f.status !== 'ready'} checked={selected.has(f.fileId)} onCheckedChange={(checked) => setSelected((s) => { const next = new Set(s); checked === true ? next.add(f.fileId) : next.delete(f.fileId); return next })} /><Button className="ghost" aria-pressed={fileId === f.fileId} onClick={() => setFileId(f.fileId)}><strong>{f.repoName}/{f.path}</strong><span className="muted small block">{f.reason}</span></Button><Badge variant="outline" className="chip">{f.status}</Badge></div>)}</div>
        {file && <><h4>{file.repoName}/{file.path} · Current → after undo</h4>{file.status === 'ready' && <ReviewDiff file={{ id: `${preview.token}:${file.fileId}`, repoId: '', repoName: file.repoName, path: file.path, status: file.remove ? 'deleted' : 'modified', binary: false, oldContent: file.currentContent, newContent: file.remove ? '' : file.resultContent }} comments={[]} onSelect={() => {}} />}{file.status !== 'ready' && <p className="muted">{file.reason}</p>}</>}
      </div>
    </Dialog>}
  </>
}
