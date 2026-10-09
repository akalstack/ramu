import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CaseSensitive, ChevronRight, FileText, Folder, FolderTree, List, RefreshCw, SlidersHorizontal, WholeWord, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SearchMatch, SearchOptions, SearchResults, ReplaceFilePreview } from '../../../shared/types'
import { Dialog, Dropdown } from '../Menu'
import { invoke } from '../ipc'
import { notifyError } from '../Notifications'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'
import { NoTask } from './ExplorerPanel'

interface SearchTree { folders: Map<string, SearchTree>; files: Map<string, SearchMatch[]> }
const emptyTree = (): SearchTree => ({ folders: new Map(), files: new Map() })

const drafts = new Map<string, SearchOptions>()
const initial: SearchOptions = { query: '', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' }

export function SearchPanel() {
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  if (!taskId) return <NoTask />
  return <WorkspaceSearch key={ws.workspaceOf(taskId)} />
}

function WorkspaceSearch() {
  const ws = useWorkspace(), taskId = ws.ui.activeTaskId
  const context = taskId ? ws.workspaceOf(taskId) : ''
  const bindings = taskId ? (ws.bindings[taskId] ?? []).filter((binding) => binding.setupState === 'ready') : []
  const project = taskId ? ws.projectOf(taskId) : undefined
  const [options, setOptions] = useState<SearchOptions>(() => drafts.get(context) ?? initial)
  const [result, setResult] = useState<SearchResults>({ matches: [], limited: false })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [replaceFiles, setReplaceFiles] = useState<ReplaceFilePreview[] | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(!!options.include || !!options.exclude)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'tree' | 'list'>(() => {
    try { return localStorage.getItem('ramu.search-view') === 'list' ? 'list' : 'tree' } catch { return 'tree' }
  })
  useEffect(() => { try { localStorage.setItem('ramu.search-view', viewMode) } catch { /* View choice still works for this session. */ } }, [viewMode])
  const [revision, setRevision] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focus = () => input.current?.focus()
    focus()
    window.addEventListener('ramu:focus-search', focus)
    return () => window.removeEventListener('ramu:focus-search', focus)
  }, [])
  useEffect(() => {
    drafts.set(context, options)
    if (drafts.size > 50) drafts.delete(drafts.keys().next().value!)
  }, [context, options])
  useEffect(() => {
    let cancelled = false
    setResult({ matches: [], limited: false }); setFailed(false)
    if (!taskId || !options.query) { setBusy(false); return }
    setBusy(true)
    const timer = setTimeout(() => {
      void invoke('files.search', taskId, options).then((value) => {
        if (!cancelled) { setResult(value); setCollapsed(new Set()) }
      }).catch((reason) => {
        if (!cancelled) { setFailed(true); notifyError(errorText(reason), `Search · ${project?.name ?? 'Project'}`) }
      }).finally(() => { if (!cancelled) setBusy(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [taskId, options, revision])
  if (!taskId) return <NoTask />
  const groups = new Map<string, typeof result.matches>()
  for (const match of result.matches) {
    const key = `${match.repoId}:${match.path}`
    groups.set(key, [...(groups.get(key) ?? []), match])
  }
  const reviewReplace = async () => {
    setReplaceBusy(true)
    try {
      if (Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved files before replacing files on disk.')
      const files = await invoke('files.replacePreview', taskId, options, replacement)
      if (!files.length) throw new Error('No matches remain. Refresh search first.')
      setReplaceError(null); setReplaceFiles(files)
    } catch (reason) { notifyError(errorText(reason), 'Search replacement') }
    finally { setReplaceBusy(false) }
  }
  const applyReplace = async () => {
    if (!replaceFiles) return
    setReplaceBusy(true); setReplaceError(null)
    try {
      if (Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved files before replacing files on disk.')
      await invoke('files.replaceApply', taskId, options, replacement, replaceFiles)
      setReplaceFiles(null); setRevision((value) => value + 1)
      window.dispatchEvent(new Event('ramu:git-updated'))
    } catch (reason) { setReplaceError(errorText(reason)) }
    finally { setReplaceBusy(false) }
  }
  const toggle = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const renderFile = (key: string, matches: SearchMatch[]) => {
    const first = matches[0]!, open = !collapsed.has(key)
    const slash = first.path.lastIndexOf('/'), name = first.path.slice(slash + 1)
    const repo = bindings.find((binding) => binding.repoId === first.repoId)
    return <section key={key} className="search-file">
      <Button className="search-file-heading" aria-expanded={open} title={`${repo?.repoName}/${first.path}`} onClick={() => toggle(key)}><ChevronRight size={13} className={open ? 'caret open' : 'caret'} /><FileText size={14} /><span className="grow search-file-name">{name}{viewMode === 'list' && <span className="muted small">{bindings.length > 1 ? `${repo?.repoName} · ` : ''}{slash >= 0 ? first.path.slice(0, slash) : ''}</span>}</span><span className="scm-count">{matches.length}</span></Button>
      {open && <div className="search-file-matches">{matches.map((match, index) => <Button key={`${match.line}:${match.column}:${index}`} className="search-match" title={`${match.path}:${match.line}:${match.column}\n${match.text}`} onClick={() => ws.openView(taskId, { kind: 'file', repoId: match.repoId, path: match.path, preview: true, selection: { line: match.line, column: match.column, endColumn: match.endColumn, requestId: crypto.randomUUID() } })}><span className="muted search-line-number">{match.line}</span><span className="search-match-text">{match.text.slice(0, match.start)}<mark>{match.text.slice(match.start, match.end) || ' '}</mark>{match.text.slice(match.end)}</span></Button>)}</div>}
    </section>
  }
  const trees = new Map<string, SearchTree>()
  for (const [key, matches] of groups) {
    const first = matches[0]!
    let node: SearchTree = trees.get(first.repoId) ?? emptyTree()
    trees.set(first.repoId, node)
    for (const folder of first.path.split('/').slice(0, -1)) {
      let child: SearchTree | undefined = node.folders.get(folder)
      if (!child) { child = emptyTree(); node.folders.set(folder, child) }
      node = child
    }
    node.files.set(key, matches)
  }
  const renderTree = (node: SearchTree, prefix: string): ReactNode => <>
    {[...node.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      const key = `${prefix}${name}/`, open = !collapsed.has(key)
      return <div key={key} className="search-folder">
        <Button className="search-folder-heading" aria-expanded={open} onClick={() => toggle(key)}><ChevronRight size={13} className={open ? 'caret open' : 'caret'} /><Folder size={14} /><span>{name}</span></Button>
        {open && <div className="search-folder-children">{renderTree(child, key)}</div>}
      </div>
    })}
    {[...node.files].sort(([, a], [, b]) => a[0]!.path.localeCompare(b[0]!.path)).map(([key, matches]) => renderFile(key, matches))}
  </>
  return <div className="panel search-panel">
    {replaceFiles && <Dialog title="Replace search matches?" confirmLabel="Replace matches" danger busy={replaceBusy} error={replaceError} onCancel={() => { if (!replaceBusy) setReplaceFiles(null) }} onConfirm={() => void applyReplace()}><p>{replaceFiles.reduce((total, file) => total + file.count, 0)} replacements in {replaceFiles.length} files. Changes are written to disk.</p><div className="replace-review">{replaceFiles.map((file) => <div key={`${file.repoId}:${file.path}`}><strong>{file.path}</strong><span className="muted small"> · {file.count} matches</span><pre><del>{file.before || '(empty match)'}</del>{'\n'}<ins>{file.after || '(remove match)'}</ins></pre></div>)}</div></Dialog>}
    <header className="panel-title search-title"><span className="grow">Search</span>
      <Button className="ghost icon small-icon" title="Refresh search" aria-label="Refresh search" disabled={!options.query || busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} /></Button>
      <Button className="ghost icon small-icon" title="Clear search" aria-label="Clear search" disabled={!options.query} onClick={() => { setOptions({ ...options, query: '' }); input.current?.focus() }}><X size={14} /></Button>
      <Button className="ghost icon small-icon" title={viewMode === 'tree' ? 'View as list' : 'View as tree'} aria-label={viewMode === 'tree' ? 'View search results as list' : 'View search results as tree'} onClick={() => setViewMode((mode) => mode === 'tree' ? 'list' : 'tree')}>{viewMode === 'tree' ? <List size={14} /> : <FolderTree size={14} />}</Button>
    </header>
    <div className="search-controls">
      {bindings.length > 1 && <Dropdown label="Search repositories" value={options.repoId ?? ''} options={[{ value: '', label: 'All repositories' }, ...bindings.map((binding) => ({ value: binding.repoId, label: binding.repoName }))]} onChange={(repoId) => setOptions({ ...options, repoId: repoId || undefined })} />}
      <Button className="ghost search-filter-toggle" aria-expanded={replaceOpen} onClick={() => setReplaceOpen((open) => !open)}><ChevronRight size={13} className={replaceOpen ? 'caret open' : 'caret'} />Replace</Button>
      <div className="search-input-wrap">
        <Input ref={input} aria-label="Search project files" placeholder="Search" value={options.query} onChange={(event) => setOptions({ ...options, query: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') setRevision((value) => value + 1) }} />
        <div className="search-options" role="group" aria-label="Search options">
          <Button className={`ghost icon small-icon${options.caseSensitive ? ' on' : ''}`} aria-label="Match case" aria-pressed={options.caseSensitive} title="Match case" onClick={() => setOptions({ ...options, caseSensitive: !options.caseSensitive })}><CaseSensitive size={15} /></Button>
          <Button className={`ghost icon small-icon${options.wholeWord ? ' on' : ''}`} aria-label="Match whole word" aria-pressed={options.wholeWord} title="Match whole word" onClick={() => setOptions({ ...options, wholeWord: !options.wholeWord })}><WholeWord size={15} /></Button>
          <Button className={`ghost icon small-icon${options.regex ? ' on' : ''}`} aria-label="Use regular expression" aria-pressed={options.regex} title="Use regular expression" onClick={() => setOptions({ ...options, regex: !options.regex })}>.*</Button>
        </div>
      </div>
      {replaceOpen && <div className="search-replace-controls"><Input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} /><Button className="primary" disabled={!options.query || !result.matches.length || busy || replaceBusy || result.limited} onClick={() => void reviewReplace()}>{replaceBusy ? 'Preparing…' : 'Review replacement…'}</Button><span className="muted small">{options.regex ? 'Capture groups: $1, $2. Use $$ for a literal dollar.' : 'Replacement is literal text.'}</span></div>}
      <Button className="ghost search-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={13} />Files to include / exclude{!filtersOpen && (options.include || options.exclude) && <Badge variant="outline" className="chip">Active</Badge>}</Button>
      {filtersOpen && <div className="search-filters"><label>Files to include<Input aria-label="Files to include" placeholder="e.g. src/**, *.tsx" value={options.include} onChange={(event) => setOptions({ ...options, include: event.target.value })} /></label><label>Files to exclude<Input aria-label="Files to exclude" placeholder="e.g. **/dist/**" value={options.exclude} onChange={(event) => setOptions({ ...options, exclude: event.target.value })} /></label></div>}
      <div className="search-summary muted small" role="status">{busy ? 'Searching…' : failed ? 'Search failed. Refresh to retry.' : options.query ? `${result.limited ? 'First ' : ''}${result.matches.length} results in ${groups.size} ${groups.size === 1 ? 'file' : 'files'}` : 'Search files in this workspace.'}</div>
      <div className="muted small search-scope-note">Files on disk · Files up to 2 MB</div>
    </div>
    <div className={`search-results search-results-${viewMode}`} aria-label={`Search results in ${viewMode} view`}>{viewMode === 'list' ? [...groups].map(([key, matches]) => renderFile(key, matches)) : [...trees].map(([repoId, tree]) => <section key={repoId}>
      {bindings.length > 1 && <div className="search-repository-heading"><Folder size={14} /><span>{bindings.find((binding) => binding.repoId === repoId)?.repoName}</span></div>}
      {renderTree(tree, `folder:${repoId}:`)}
    </section>)}</div>
  </div>
}
