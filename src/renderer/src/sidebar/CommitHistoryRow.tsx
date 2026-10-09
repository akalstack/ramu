import { Button } from '@/components/ui/button'
import { ChevronRight, Copy, FileDiff, FileText, Folder, FolderOpen, GitCommitHorizontal, MoreHorizontal } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { GitCommit, GitCommitFile, RepositoryBinding } from '../../../shared/types'
import { invoke, copyText } from '../ipc'
import { Menu, timeAgo, useContextMenu, type MenuEntry } from '../Menu'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'

export function CommitHistoryRow({ taskId, binding, commit }: { taskId: string; binding: RepositoryBinding; commit: GitCommit }) {
  const ws = useWorkspace()
  const [expanded, setExpanded] = useState(false)
  const [files, setFiles] = useState<GitCommitFile[] | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!expanded || files) return
    let disposed = false
    void invoke('git.commitFiles', taskId, binding.repoId, commit.oid).then(
      (value) => { if (!disposed) { setFiles(value); setError(null) } },
      (reason) => { if (!disposed) setError(errorText(reason)) },
    )
    return () => { disposed = true }
  }, [expanded, files, taskId, binding.repoId, commit.oid])
  const details = () => ws.openView(taskId, { kind: 'git', repoId: binding.repoId, oid: commit.oid, title: `${commit.shortOid} · ${commit.subject}` })
  const diff = (file: GitCommitFile) => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, oid: commit.oid, path: file.path, staged: false })
  const copy = async (text: string) => {
    try { await copyText(text); setError(null) }
    catch (reason) { setError(errorText(reason)) }
  }
  const actions: MenuEntry[] = [
    { key: 'details', label: <><FileText size={13} />View full commit</>, onSelect: details },
    { key: 'all', label: <><FileDiff size={13} />Open all changes</>, onSelect: () => {
      void (files ? Promise.resolve(files) : invoke('git.commitFiles', taskId, binding.repoId, commit.oid)).then((entries) => entries.forEach(diff), (reason) => setError(errorText(reason)))
    } },
    { key: 'separator', separator: true },
    { key: 'hash', label: <><Copy size={13} />Copy commit hash</>, onSelect: () => void copy(commit.oid) },
    { key: 'title', label: 'Copy commit title', onSelect: () => void copy(commit.subject) },
  ]
  const context = useContextMenu('Commit actions', actions)
  const tree = (entries: GitCommitFile[], prefix: string, depth: number) => {
    const folders = new Map<string, GitCommitFile[]>()
    const leaves: GitCommitFile[] = []
    for (const file of entries) {
      const relative = file.path.slice(prefix.length)
      const slash = relative.indexOf('/')
      if (slash < 0) leaves.push(file)
      else {
        const folder = relative.slice(0, slash)
        folders.set(folder, [...(folders.get(folder) ?? []), file])
      }
    }
    return <>
      {[...folders].sort(([a], [b]) => a.localeCompare(b)).map(([folder, children]) => {
        const path = `${prefix}${folder}/`
        const open = !closed.has(path)
        return <div key={path}>
          <Button className="tree-row commit-folder" style={{ paddingLeft: 8 + depth * 12 }} aria-expanded={open} onClick={() => setClosed((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })}>
            <ChevronRight size={12} className={open ? 'tree-caret open' : 'tree-caret'} />{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span className="tree-name">{folder}</span>
          </Button>
          {open && <div className="tree-children" style={{ '--tree-guide-left': `${14 + depth * 12}px` } as CSSProperties}>{tree(children, path, depth + 1)}</div>}
        </div>
      })}
      {leaves.sort((a, b) => a.path.localeCompare(b.path)).map((file) => <Button key={file.path} className={`tree-row commit-file commit-file-${file.status}`} style={{ paddingLeft: 8 + depth * 12 }} title={file.origPath ? `${file.origPath} → ${file.path}` : file.path} onClick={() => diff(file)}>
        <span className="tree-caret" /><FileDiff size={14} className="tree-icon" /><span className="tree-name grow">{file.path.slice(prefix.length)}</span><span className="letter">{file.status}</span>
      </Button>)}
    </>
  }
  return <div className={`commit-history-entry${expanded ? ' expanded' : ''}`}>
    <div className="commit-history-head" onContextMenu={context.onContextMenu}>
      <Button className="git-commit-row" aria-expanded={expanded} onKeyDown={context.onKeyDown} title={`${commit.subject}\n${commit.author} · ${commit.shortOid}${commit.refs ? `\n${commit.refs}` : ''}`} onClick={() => setExpanded((value) => !value)} onDoubleClick={details}>
        <ChevronRight size={12} className={expanded ? 'tree-caret open' : 'tree-caret'} /><GitCommitHorizontal size={13} /><span className="grow">{commit.subject}</span><span className="muted commit-age">{timeAgo(commit.timestamp)}</span>
      </Button>
      <div className="commit-history-actions">
        <Button className="ghost icon small-icon" aria-label="View full commit" title="View full commit" onClick={details}><FileText size={13} /></Button>
        <Button className="ghost icon small-icon" aria-label="Copy commit hash" title="Copy commit hash" onClick={() => void copy(commit.oid)}><Copy size={13} /></Button>
        <Menu label="Commit actions" icon={<MoreHorizontal size={13} />} className="ghost icon small-icon" align="end" items={actions} />
      </div>
    </div>
    {error && <div className="error small commit-tree-message" role="alert">{error}</div>}
    {expanded && <div className="tree-children commit-file-tree" style={{ '--tree-guide-left': '14px' } as CSSProperties}>
      {files ? files.length ? tree(files, '', 1) : <div className="muted small commit-tree-message">No file changes.</div> : !error && <div className="muted small commit-tree-message">Loading changes…</div>}
    </div>}
    {context.menu}
  </div>
}
