import { useEffect, useRef, useState } from 'react'
import type { RepositoryBinding, ViewDescriptor } from '../../../shared/types'
import { invoke, ramu } from '../ipc'
import { monaco } from '../monaco'
import { errorText } from '../TaskPane'
import { useAppSettings } from '../AppSettings'

export function GitDetailsView({ taskId, view, binding }: { taskId: string; view: Extract<ViewDescriptor, { kind: 'git' }>; binding: RepositoryBinding }) {
  const { preferences } = useAppSettings()
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let disposed = false
    let request = 0
    const model = monaco.editor.createModel('', 'diff')
    const editor = monaco.editor.create(host.current!, {
      model, theme: 'ramu', readOnly: true, automaticLayout: true,
      fontSize: preferences.editorFontSize, lineHeight: Math.round(preferences.editorFontSize * 1.6), fontFamily: "'SF Mono', Menlo, 'Geist Mono Variable', monospace",
      minimap: { enabled: false }, scrollBeyondLastLine: false,
    })
    editorRef.current = editor
    const load = async () => {
      const current = ++request
      setLoading(true)
      try {
        const patch = view.oid ? await invoke('git.commitDetails', taskId, binding.repoId, view.oid) : await invoke('git.compareUpstream', taskId, binding.repoId)
        if (!disposed && current === request) { model.setValue(patch || 'No differences with upstream.'); setError(null) }
      } catch (e) { if (!disposed && current === request) setError(errorText(e)) }
      finally { if (!disposed && current === request) setLoading(false) }
    }
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = ramu.on('fs:changed', ({ cwd }) => {
      if (!view.oid && cwd === binding.cwd) { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
    })
    return () => { disposed = true; clearTimeout(timer); off(); editorRef.current = null; editor.dispose(); model.dispose() }
  }, [taskId, binding.repoId, binding.cwd, view.oid])
  useEffect(() => { editorRef.current?.updateOptions({ fontSize: preferences.editorFontSize, lineHeight: Math.round(preferences.editorFontSize * 1.6) }) }, [preferences.editorFontSize])

  return <div className="file-view">
    <div className="view-header"><span className="strong">{binding.repoName}</span><span className="git-detail-title" title={view.title}>{view.title}</span>{loading && <span className="muted small">Loading…</span>}</div>
    {error && <div className="error banner">{error}</div>}
    <div ref={host} className="editor-host" />
  </div>
}
