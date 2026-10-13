import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage } from './../i18n'
import { useEffect, useRef, useState } from 'react'
import type { RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { invoke, ramu } from '../ipc'
import { monaco } from '../monaco'
import { errorText } from '../TaskPane'
import { useAppSettings } from '../AppSettings'

export function GitDetailsView({ taskId, view, binding }: { taskId: string; view: Extract<ViewDescriptor, { kind: 'git' }>; binding: RepositoryBinding }) {
  useLanguage()
  const { preferences } = useAppSettings()
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let disposed = false, loaded = false
    setError(null)
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
      if (!loaded) setLoading(true)
      try {
        const patch = view.oid ? await invoke('git.commitDetails', taskId, binding.repoId, view.oid) : await invoke('git.compareUpstream', taskId, binding.repoId)
        if (!disposed && current === request) { loaded = true; model.setValue(patch || 'No differences with upstream.'); setError(null) }
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

  return <div className="file-view flex flex-col flex-1 min-h-0 min-w-0">
    <div className="view-header [&_.path]:flex-1 [&_button]:text-control [&_button]:p-[2px_8px] [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground flex gap-2.5 items-center h-8 p-[0_12px] flex-none min-w-0 text-control text-soft"><span className="strong font-semibold">{binding.repoName}</span><span className="git-detail-title min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={view.title}>{view.title}</span>{loading && <span className="muted text-muted-foreground small text-caption">{t("Loading…")}</span>}</div>
    {error && <div className="error text-bad banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control">{error}</div>}
    <div className="relative flex-1 min-h-0">
      <div ref={host} className="editor-host h-full" />
      {loading && <ContentSkeleton variant="editor" rows={12} className="absolute inset-0 bg-canvas" />}
    </div>
  </div>
}
