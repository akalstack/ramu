import { t, useLanguage } from './i18n'
import { Input } from '@/components/ui/input'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Dialog, Dropdown } from './Menu'
import { invoke } from './ipc'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

export function CreateEntryDialog() {
  useLanguage()
  const ws = useWorkspace()
  const [request, setRequest] = useState<{ taskId: string; kind: 'file' | 'dir' } | null>(null)
  const [repoId, setRepoId] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const create = (event: Event) => {
      const taskId = ws.ui.activeTaskId
      if (!taskId) return
      const view = ws.taskUi[taskId]?.views.find((entry) => entry.id === ws.taskUi[taskId]?.activeViewId)
      setRepoId(view?.repoId ?? ws.bindings[taskId]?.[0]?.repoId ?? '')
      setPath(''); setError(null)
      setRequest({ taskId, kind: (event as CustomEvent<{ kind: 'file' | 'dir' }>).detail.kind })
    }
    window.addEventListener('ramu:create-entry', create)
    return () => window.removeEventListener('ramu:create-entry', create)
  }, [ws])
  useLayoutEffect(() => { if (request) input.current?.focus() }, [request])
  if (!request) return null
  const repositories = (ws.bindings[request.taskId] ?? []).filter((binding) => binding.setupState === 'ready')
  const create = async () => {
    setBusy(true); setError(null)
    try {
      if (!path.trim() || !repoId) throw new Error('Choose a repository and enter a relative path.')
      await invoke('files.create', request.taskId, repoId, path.trim(), request.kind)
      if (request.kind === 'file') ws.openView(request.taskId, { kind: 'file', repoId, path: path.trim(), preview: false })
      window.dispatchEvent(new Event('ramu:refresh-explorer'))
      window.dispatchEvent(new Event('ramu:git-updated'))
      setRequest(null)
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  return <Dialog title={request.kind === 'file' ? t("New file") : t("New folder")} confirmLabel={t("Create")} busy={busy} error={error} onCancel={() => { if (!busy) setRequest(null) }} onConfirm={() => void create()}>
    {repositories.length > 1 && <Dropdown label={t("Repository")} value={repoId} options={repositories.map((binding) => ({ value: binding.repoId, label: binding.repoName }))} onChange={setRepoId} disabled={busy} />}
    <label className="explorer-name-field">{t("Relative path")}<Input ref={input} placeholder={request.kind === 'file' ? 'src/example.ts' : 'src/components'} value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void create() }} /></label>
    <p className="muted small">{repositories.find((binding) => binding.repoId === repoId)?.repoName} {t(" · Parent folders must already exist.")}</p>
  </Dialog>
}
