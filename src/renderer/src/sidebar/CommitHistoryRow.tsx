import { t, useLanguage } from './../i18n'
import { Button } from '@/components/ui/button'
import { ChevronRight, Copy, FileDiff, FileText, Folder, FolderOpen, MoreHorizontal, Undo2 } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { GitCommit, GitCommitFile, RepositoryBinding } from '../../../shared/types'
import { invoke, copyText } from '../ipc'
import { Menu, timeAgo, useContextMenu, type MenuEntry } from '../Menu'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'

/** Refs worth a badge: other branches, remotes and tags. HEAD and the checked-out branch are implied by the list itself. */
export function commitRefs(refs: string, branch: string | null): string[] {
  return refs.split(', ').map((ref) => ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')).filter((ref) => ref && ref !== 'HEAD' && ref !== branch && !ref.endsWith('/HEAD'))
}

export function CommitHistoryRow({ taskId, binding, commit, branch = null, onUndo, undoDisabled = false }: { taskId: string; binding: RepositoryBinding; commit: GitCommit; branch?: string | null; onUndo?: () => void; undoDisabled?: boolean }) {
  useLanguage()
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
  const diff = (file: GitCommitFile, preview?: false) => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, oid: commit.oid, path: file.path, staged: false, preview })
  const copy = async (text: string) => {
    try { await copyText(text); setError(null) }
    catch (reason) { setError(errorText(reason)) }
  }
  const actions: MenuEntry[] = [
    ...(onUndo ? [{ key: 'undo', label: <><Undo2 size={13} />{t("Undo commit")}</>, disabled: undoDisabled, onSelect: onUndo }] : []),
    { key: 'details', label: <><FileText size={13} />{t("View full commit")}</>, onSelect: details },
    { key: 'all', label: <><FileDiff size={13} />{t("Open all changes")}</>, onSelect: () => {
      void (files ? Promise.resolve(files) : invoke('git.commitFiles', taskId, binding.repoId, commit.oid)).then((entries) => entries.forEach((file) => diff(file, false)), (reason) => setError(errorText(reason)))
    } },
    { key: 'separator', separator: true },
    { key: 'hash', label: <><Copy size={13} />{t("Copy commit hash")}</>, onSelect: () => void copy(commit.oid) },
    { key: 'title', label: t("Copy commit title"), onSelect: () => void copy(commit.subject) },
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
      {leaves.sort((a, b) => a.path.localeCompare(b.path)).map((file) => <Button key={file.path} className={`tree-row commit-file commit-file-${file.status}`} style={{ paddingLeft: 8 + depth * 12 }} title={file.origPath ? `${file.origPath} → ${file.path}` : file.path} onClick={() => diff(file)} onDoubleClick={() => diff(file, false)}>
        <span className="tree-caret" /><FileDiff size={14} className="tree-icon" /><span className="tree-name grow">{file.path.slice(prefix.length)}</span><span className="letter">{file.status}</span>
      </Button>)}
    </>
  }
  const refs = commitRefs(commit.refs, branch)
  return <div className={`commit-history-entry${expanded ? ' expanded' : ''}${commit.outgoing ? ' outgoing' : ''}`}>
    <div className="commit-history-head" onContextMenu={context.onContextMenu}>
      <Button className="git-commit-row" aria-expanded={expanded} onKeyDown={context.onKeyDown} title={`${commit.subject}\n${commit.author} · ${commit.shortOid} · ${new Date(commit.timestamp).toLocaleString()}${commit.refs ? `\n${commit.refs}` : ''}${commit.outgoing ? `\n${t("Not pushed yet")}` : ''}`} onClick={() => setExpanded((value) => !value)} onDoubleClick={details}>
        <ChevronRight size={12} className={expanded ? 'tree-caret open' : 'tree-caret'} /><span className="commit-dot" aria-hidden="true" /><span className="commit-subject">{commit.subject}</span>
        {refs.map((ref) => <span key={ref} className="commit-ref" title={ref}>{ref}</span>)}
        <span className="grow" /><span className="commit-age">{timeAgo(commit.timestamp)}</span>
      </Button>
      <div className="commit-history-actions">
        {onUndo && <Button className="ghost icon small-icon" aria-label={t("Undo commit")} title={t("Undo last commit…")} disabled={undoDisabled} onClick={onUndo}><Undo2 size={13} /></Button>}
        <Button className="ghost icon small-icon" aria-label={t("View full commit")} title={t("View full commit")} onClick={details}><FileText size={13} /></Button>
        <Button className="ghost icon small-icon" aria-label={t("Copy commit hash")} title={t("Copy commit hash")} onClick={() => void copy(commit.oid)}><Copy size={13} /></Button>
        <Menu label={t("Commit actions")} icon={<MoreHorizontal size={13} />} className="ghost icon small-icon" align="end" items={actions} />
      </div>
    </div>
    {error && <div className="error small commit-tree-message" role="alert">{error}</div>}
    {expanded && <div className="tree-children commit-file-tree" style={{ '--tree-guide-left': '14px' } as CSSProperties}>
      {files ? files.length ? tree(files, '', 1) : <div className="muted small commit-tree-message">{t("No file changes.")}</div> : !error && <div className="muted small commit-tree-message">{t("Loading changes…")}</div>}
    </div>}
    {context.menu}
  </div>
}
