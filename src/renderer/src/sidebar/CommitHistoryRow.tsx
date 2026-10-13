import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage } from './../i18n'
import { Button } from '@/components/desktop-button'
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
          <Button variant="tree" className="tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.selected]:bg-accent [&.selected]:text-foreground [&.selected]:[box-shadow:none] [&.selected_.tree-icon]:text-soft [&.selected:hover]:bg-accent [&.selected:hover]:text-foreground [&.selected:hover]:[box-shadow:none] [&:focus-visible]:[outline-color:var(--line-strong)] [&[draggable='true']]:[-webkit-user-drag:element] [&.picked]:bg-accent [&.picked]:text-foreground [&.drop-target]:bg-brand-wash [&.drop-target]:[box-shadow:none] flex items-center w-full bg-transparent [border:none] rounded-(--radius-s) p-[3px_4px] gap-1.5 text-left whitespace-nowrap text-soft justify-start commit-folder" style={{ paddingLeft: 8 + depth * 12 }} aria-expanded={open} onClick={() => setClosed((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })}>
            <ChevronRight size={12} className={open ? 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)] open' : 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)]'} />{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span className="tree-name relative top-[-1px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{folder}</span>
          </Button>
          {open && <div className="tree-children [&::before]:[content:''] [&::before]:absolute [&::before]:top-0 [&::before]:bottom-0 [&::before]:left-[var(--tree-guide-left)] [&::before]:w-px [&::before]:[background:var(--line)] [&::before]:pointer-events-none [&::before]:z-1 relative" style={{ '--tree-guide-left': `${14 + depth * 12}px` } as CSSProperties}>{tree(children, path, depth + 1)}</div>}
        </div>
      })}
      {leaves.sort((a, b) => a.path.localeCompare(b.path)).map((file) => <Button variant="tree" key={file.path} className={`tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.selected]:bg-accent [&.selected]:text-foreground [&.selected]:[box-shadow:none] [&.selected_.tree-icon]:text-soft [&.selected:hover]:bg-accent [&.selected:hover]:text-foreground [&.selected:hover]:[box-shadow:none] [&:focus-visible]:[outline-color:var(--line-strong)] [&[draggable='true']]:[-webkit-user-drag:element] [&.picked]:bg-accent [&.picked]:text-foreground [&.drop-target]:bg-brand-wash [&.drop-target]:[box-shadow:none] flex items-center w-full bg-transparent [border:none] rounded-(--radius-s) p-[3px_4px] gap-1.5 text-left whitespace-nowrap text-soft justify-start commit-file commit-file-${file.status} [&.commit-file-A]:text-ok [&.commit-file-D]:text-bad`} style={{ paddingLeft: 8 + depth * 12 }} title={file.origPath ? `${file.origPath} → ${file.path}` : file.path} onClick={() => diff(file)} onDoubleClick={() => diff(file, false)}>
        <span className="tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)]" /><FileDiff size={14} className="tree-icon [.commit-file-A_&]:text-ok [.commit-file-D_&]:text-bad flex-none text-muted-foreground" /><span className="tree-name relative top-[-1px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap grow flex-1 min-w-0 text-left">{file.path.slice(prefix.length)}</span><span className="letter [&.modified]:text-warn [&.added]:text-ok [&.untracked]:text-ok [&.deleted]:text-bad [.commit-file-M_&]:text-warn [.commit-file-R_&]:text-warn tabular-nums font-mono text-caption w-3.5 text-center text-muted-foreground">{file.status}</span>
      </Button>)}
    </>
  }
  const refs = commitRefs(commit.refs, branch)
  return <div className={`commit-history-entry [&::before]:[content:''] [&::before]:absolute [&::before]:left-[var(--commit-dot-x)] [&::before]:w-px [&::before]:[background:var(--line-strong)] [&::before]:pointer-events-none [&::before]:top-0 [&::before]:h-[9px] [&::after]:[content:''] [&::after]:absolute [&::after]:left-[var(--commit-dot-x)] [&::after]:w-px [&::after]:[background:var(--line-strong)] [&::after]:pointer-events-none [&::after]:top-[19px] [&::after]:bottom-0 [&:first-child::before]:[content:none] [&:last-child:not(.expanded)::after]:[content:none] [&.expanded_>_.commit-history-head]:bg-hover [&.outgoing_.commit-dot]:bg-(--accent) [&.outgoing_.commit-dot]:[box-shadow:0_0_0_2px_var(--accent-wash),0_0_6px_var(--accent)] [&.outgoing_.commit-subject]:text-foreground [&.expanded_.commit-history-actions]:flex [&.expanded_.commit-age]:hidden relative [--commit-dot-x:27px] ${expanded ? ' expanded' : ''}${commit.outgoing ? ' outgoing' : ''}`}>
    <div className="commit-history-head [&:hover]:bg-hover [&:has(.commit-history-actions_.on)]:bg-hover [&_button.git-commit-row]:flex [&_button.git-commit-row]:items-center [&_button.git-commit-row]:justify-start [&_button.git-commit-row]:flex-1 [&_button.git-commit-row]:min-w-0 [&_button.git-commit-row]:h-6 [&_button.git-commit-row]:min-h-6 [&_button.git-commit-row]:p-[0_6px_0_4px] [&_button.git-commit-row]:gap-1.5 [&_button.git-commit-row]:[border:0] [&_button.git-commit-row]:rounded-(--radius-s) [&_button.git-commit-row]:bg-transparent [&_button.git-commit-row]:text-soft [&_button.git-commit-row]:text-caption [&_button.git-commit-row]:text-left [&_button.git-commit-row:hover:not(:disabled)]:bg-transparent [&_button.git-commit-row:hover:not(:disabled)]:[border:0] [&:hover_.commit-history-actions]:flex [&:focus-within_.commit-history-actions]:flex [&:has(.commit-history-actions_.on)_.commit-history-actions]:flex [&:hover_.commit-age]:hidden [&:focus-within_.commit-age]:hidden [&:has(.commit-history-actions_.on)_.commit-age]:hidden flex items-center gap-0.5 min-h-7 rounded-(--radius-s)" onContextMenu={context.onContextMenu}>
      <Button variant="tree" className="git-commit-row w-full p-1" aria-expanded={expanded} onKeyDown={context.onKeyDown} title={`${commit.subject}\n${commit.author} · ${commit.shortOid} · ${new Date(commit.timestamp).toLocaleString()}${commit.refs ? `\n${commit.refs}` : ''}${commit.outgoing ? `\n${t("Not pushed yet")}` : ''}`} onClick={() => setExpanded((value) => !value)} onDoubleClick={details}>
        <ChevronRight size={12} className={expanded ? 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)] open' : 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)]'} /><span className="commit-dot flex-none w-2 h-2 m-[0_1px] rounded-full [background:var(--muted)]" aria-hidden="true" /><span className="commit-subject flex-initial min-w-12 overflow-hidden text-ellipsis whitespace-nowrap">{commit.subject}</span>
        {refs.map((ref) => <span key={ref} className="commit-ref [flex:0_0_auto] max-w-[104px] p-[0_5px] [border:1px_solid_transparent] rounded-(--radius-xs) text-muted-foreground text-[length:10.5px] leading-[15px] overflow-hidden text-ellipsis whitespace-nowrap bg-fill" title={ref}>{ref}</span>)}
        <span className="grow flex-1 min-w-0 text-left" /><span className="commit-age flex-none text-muted-foreground text-caption tabular-nums">{timeAgo(commit.timestamp)}</span>
      </Button>
      <div className="commit-history-actions hidden items-center flex-none gap-0.5 pr-1">
        {onUndo && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Undo commit")} title={t("Undo last commit…")} disabled={undoDisabled} onClick={onUndo}><Undo2 size={13} /></Button>}
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("View full commit")} title={t("View full commit")} onClick={details}><FileText size={13} /></Button>
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Copy commit hash")} title={t("Copy commit hash")} onClick={() => void copy(commit.oid)}><Copy size={13} /></Button>
        <Menu label={t("Commit actions")} icon={<MoreHorizontal size={13} />} className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" align="end" items={actions} />
      </div>
    </div>
    {error && <div className="error text-bad small text-caption commit-tree-message p-[4px_8px_4px_26px]" role="alert">{error}</div>}
    {expanded && <div className="tree-children [&::before]:[content:''] [&::before]:absolute [&::before]:top-0 [&::before]:bottom-0 [&::before]:left-[var(--tree-guide-left)] [&::before]:w-px [&::before]:[background:var(--line)] [&::before]:pointer-events-none [&::before]:z-1 relative commit-file-tree [&_.tree-row]:min-h-6 [&_.tree-row]:text-caption [&_.tree-row]:pr-2 [&_.letter]:flex-none [&_.letter]:text-caption m-[2px_0_4px]" style={{ '--tree-guide-left': '14px' } as CSSProperties}>
      {files ? files.length ? tree(files, '', 1) : <div className="muted text-muted-foreground small text-caption commit-tree-message p-[4px_8px_4px_26px]">{t("No file changes.")}</div> : !error && <ContentSkeleton rows={3} label={t("Loading changes…")} className="pl-[26px]" />}
    </div>}
    {context.menu}
  </div>
}
