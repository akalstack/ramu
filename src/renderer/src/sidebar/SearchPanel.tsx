import { t, useLanguage } from './../i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/desktop-button'
import { SearchInput } from '../SearchInput'
import { Input } from '@/components/ui/input'
import { CaseSensitive, ChevronRight, FileText, Folder, FolderTree, List, RefreshCw, SlidersHorizontal, WholeWord, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchMatch, SearchOptions, SearchResults, ReplaceFilePreview } from '../../../shared/types'
import { Dialog, Dropdown } from '../Menu'
import { invoke } from '../ipc'
import { notifyError } from '../Notifications'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'
import { VirtualList } from '../VirtualList'
import { useAppSettings } from '../AppSettings'
import { NoTask } from './ExplorerPanel'

interface SearchTree { folders: Map<string, SearchTree>; files: Map<string, SearchMatch[]> }
const emptyTree = (): SearchTree => ({ folders: new Map(), files: new Map() })

const drafts = new Map<string, SearchOptions>()
const initial: SearchOptions = { query: '', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' }

export function SearchPanel() {
  useLanguage()
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  if (!taskId) return <NoTask />
  return <WorkspaceSearch key={ws.workspaceOf(taskId)} taskId={taskId} />
}

function WorkspaceSearch({ taskId }: { taskId: string }) {
  useLanguage()
  const ws = useWorkspace()
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
  const groups = useMemo(() => { const groups = new Map<string, SearchMatch[]>(); for (const match of result.matches) { const key = `${match.repoId}:${match.path}`, group = groups.get(key) ?? []; group.push(match); groups.set(key, group) } return groups }, [result.matches])
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
  const { preferences } = useAppSettings()
  type Row = { kind: 'repo'; key: string; repoId: string; depth: number }
    | { kind: 'folder'; key: string; name: string; depth: number; open: boolean }
    | { kind: 'file'; key: string; matches: SearchMatch[]; depth: number; open: boolean }
    | { kind: 'match'; key: string; match: SearchMatch; depth: number }
  const trees = useMemo(() => {
    const result = new Map<string, SearchTree>()
    for (const [key, matches] of groups) {
      const first = matches[0]!
      let node = result.get(first.repoId) ?? emptyTree(); result.set(first.repoId, node)
      for (const folder of first.path.split('/').slice(0, -1)) { let child = node.folders.get(folder); if (!child) { child = emptyTree(); node.folders.set(folder, child) }; node = child }
      node.files.set(key, matches)
    }
    return result
  }, [groups])
  const rows = useMemo(() => {
    const rows: Row[] = []
    const file = (key: string, matches: SearchMatch[], depth: number) => {
      const open = !collapsed.has(key)
      rows.push({ kind: 'file', key, matches, depth, open })
      if (open) matches.forEach((match, index) => rows.push({ kind: 'match', key: `${key}:${index}`, match, depth: depth + 1 }))
    }
    const visit = (node: SearchTree, prefix: string, depth: number) => {
      for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
        const key = `${prefix}${name}/`, open = !collapsed.has(key)
        rows.push({ kind: 'folder', key, name, depth, open }); if (open) visit(child, key, depth + 1)
      }
      for (const [key, matches] of [...node.files].sort(([,a],[,b]) => a[0]!.path.localeCompare(b[0]!.path))) file(key, matches, depth)
    }
    if (viewMode === 'list') for (const [key, matches] of groups) file(key, matches, 0)
    else for (const [repoId, tree] of trees) { if (bindings.length > 1) rows.push({ kind: 'repo', key: `repo:${repoId}`, repoId, depth: 0 }); visit(tree, `folder:${repoId}:`, 0) }
    return rows
  }, [groups, trees, collapsed, viewMode, bindings.length])
  const rowHeight = useCallback((row: Row) => viewMode === 'list' && row.kind === 'file' ? Math.max(44, preferences.fontSize * 2 + 16) : Math.max(28, preferences.fontSize + 12), [viewMode, preferences.fontSize])
  const renderRow = (row: Row) => {
    const style = { paddingLeft: 12 + row.depth * 12, height: '100%' }
    if (row.kind === 'repo') return <div className="search-repository-heading [&_>_span]:overflow-hidden [&_>_span]:text-ellipsis [&_>_span]:whitespace-nowrap flex items-center gap-1.5 min-h-7 w-full p-[4px_12px] bg-transparent [border:0] [border-radius:0] text-left font-semibold justify-start" style={style}><Folder size={14}/><span>{bindings.find((binding) => binding.repoId === row.repoId)?.repoName}</span></div>
    if (row.kind === 'folder') return <Button variant="tree" className="search-folder-heading [&_>_span]:overflow-hidden [&_>_span]:text-ellipsis [&_>_span]:whitespace-nowrap flex items-center gap-1.5 min-h-7 w-full p-[4px_12px] bg-transparent [border:0] [border-radius:0] text-left justify-start" style={style} aria-expanded={row.open} onClick={() => toggle(row.key)}><ChevronRight size={13} className={row.open ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'}/><Folder size={14}/><span>{row.name}</span></Button>
    if (row.kind === 'file') {
      const first = row.matches[0]!, slash = first.path.lastIndexOf('/'), repo = bindings.find((binding) => binding.repoId === first.repoId)
      return <Button variant="tree" className="search-file-heading [.search-results-tree_&]:min-h-7 [.search-results-tree_&]:[position:static] flex items-center gap-1.5 w-full p-[6px_12px] min-h-8 [border:0] [background:var(--sidebar)] [border-radius:0] text-left sticky top-0 z-1 justify-start" style={style} aria-expanded={row.open} title={`${repo?.repoName}/${first.path}`} onClick={() => toggle(row.key)}><ChevronRight size={13} className={row.open ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'}/><FileText size={14}/><span className="grow flex-1 min-w-0 text-left search-file-name [&_>_span]:block [&_>_span]:overflow-hidden [&_>_span]:text-ellipsis min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{first.path.slice(slash + 1)}{viewMode === 'list' && <span className="muted text-muted-foreground small text-caption">{bindings.length > 1 ? `${repo?.repoName} · ` : ''}{slash >= 0 ? first.path.slice(0, slash) : ''}</span>}</span><span className="scm-count ml-auto text-muted-foreground inline-flex items-center justify-center min-w-[18px] h-[18px] p-[0_4px] rounded-(--radius-row) bg-accent text-caption leading-[18px]">{row.matches.length}</span></Button>
    }
    const match = row.match
    return <Button variant="secondary" className="bg-fill hover:bg-fill-hover search-match [&_mark]:bg-brand-wash [&_mark]:text-foreground [&_mark]:[border-radius:2px] flex items-center gap-2 w-full p-[4px_12px_4px_8px] [border:0] [border-radius:0] text-left bg-transparent justify-start" style={style} title={`${match.path}:${match.line}:${match.column}\n${match.text}`} onClick={() => ws.openView(taskId, { kind: 'file', repoId: match.repoId, path: match.path, preview: true, selection: { line: match.line, column: match.column, endColumn: match.endColumn, requestId: crypto.randomUUID() } })}><span className="muted text-muted-foreground search-line-number flex-none w-7 text-right text-caption">{match.line}</span><span className="search-match-text min-w-0 overflow-hidden text-ellipsis [white-space:pre] text-control">{match.text.slice(0, match.start)}<mark>{match.text.slice(match.start, match.end) || ' '}</mark>{match.text.slice(match.end)}</span></Button>
  }
  return <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px] search-panel flex flex-col min-h-0 h-full p-0">
    {replaceFiles && <Dialog title={t("Replace search matches?")} confirmLabel={t("Replace matches")} danger busy={replaceBusy} error={replaceError} onCancel={() => { if (!replaceBusy) setReplaceFiles(null) }} onConfirm={() => void applyReplace()}><p>{replaceFiles.reduce((total, file) => total + file.count, 0)} {t(" replacements in ")}{replaceFiles.length} {t(" files. Changes are written to disk.")}</p><div className="replace-review [&_>_div]:p-[10px_0] [&_>_div]:[border-bottom:1px_solid_var(--line)] [&_del]:text-bad [&_del]:[text-decoration:none] [&_ins]:text-ok [&_ins]:[text-decoration:none] max-h-[320px] overflow-auto">{replaceFiles.map((file) => <div key={`${file.repoId}:${file.path}`}><strong>{file.path}</strong><span className="muted text-muted-foreground small text-caption"> · {file.count} {t(" matches")}</span><pre><del>{file.before || t("(empty match)")}</del>{'\n'}<ins>{file.after || t("(remove match)")}</ins></pre></div>)}</div></Dialog>}
    <header className="panel-title text-chat font-semibold tracking-[-0.01em] text-foreground m-[4px_0_8px] overflow-hidden text-ellipsis whitespace-nowrap search-title [&_.icon]:w-[var(--action-size)] [&_.icon]:h-[var(--action-size)] [&_.icon_>_svg]:w-[var(--icon-size)] [&_.icon_>_svg]:h-[var(--icon-size)] flex items-center gap-1 p-3 m-0"><span className="grow flex-1 min-w-0 text-left" />
      <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Refresh search")} aria-label={t("Refresh search")} disabled={!options.query || busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} /></Button>
      <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Clear search")} aria-label={t("Clear search")} disabled={!options.query} onClick={() => { setOptions({ ...options, query: '' }); input.current?.focus() }}><X size={14} /></Button>
      <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={viewMode === 'tree' ? t("View as list") : t("View as tree")} aria-label={viewMode === 'tree' ? t("View search results as list") : t("View search results as tree")} onClick={() => setViewMode((mode) => mode === 'tree' ? 'list' : 'tree')}>{viewMode === 'tree' ? <List size={14} /> : <FolderTree size={14} />}</Button>
    </header>
    <div className="search-controls flex-none flex flex-col gap-2 p-[0_12px_12px]">
      {bindings.length > 1 && <Dropdown label={t("Search repositories")} value={options.repoId ?? ''} options={[{ value: '', label: t("All repositories") }, ...bindings.map((binding) => ({ value: binding.repoId, label: binding.repoName }))]} onChange={(repoId) => setOptions({ ...options, repoId: repoId || undefined })} />}
      <Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover search-filter-toggle justify-start gap-1.5 text-caption p-0" aria-expanded={replaceOpen} onClick={() => setReplaceOpen((open) => !open)}><ChevronRight size={13} className={replaceOpen ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'} />{t("Replace")}</Button>
      <SearchInput ref={input} aria-label={t("Search project files")} placeholder={t("Search")} value={options.query} onChange={(event) => setOptions({ ...options, query: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') setRevision((value) => value + 1) }} actions={<>
        <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)${options.caseSensitive ? ' on' : ''}`} aria-label={t("Match case")} aria-pressed={options.caseSensitive} title={t("Match case")} onClick={() => setOptions({ ...options, caseSensitive: !options.caseSensitive })}><CaseSensitive size={15} /></Button>
        <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)${options.wholeWord ? ' on' : ''}`} aria-label={t("Match whole word")} aria-pressed={options.wholeWord} title={t("Match whole word")} onClick={() => setOptions({ ...options, wholeWord: !options.wholeWord })}><WholeWord size={15} /></Button>
        <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)${options.regex ? ' on' : ''}`} aria-label={t("Use regular expression")} aria-pressed={options.regex} title={t("Use regular expression")} onClick={() => setOptions({ ...options, regex: !options.regex })}>.*</Button>
      </>} />
      {replaceOpen && <div className="search-replace-controls [&_input]:w-full flex flex-col gap-1.5"><Input aria-label={t("Replace with")} placeholder={t("Replace with")} value={replacement} onChange={(event) => setReplacement(event.target.value)} /><Button variant="default" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" disabled={!options.query || !result.matches.length || busy || replaceBusy || result.limited} onClick={() => void reviewReplace()}>{replaceBusy ? t("Preparing…") : t("Review replacement…")}</Button><span className="muted text-muted-foreground small text-caption">{options.regex ? t("Capture groups: $1, $2. Use $$ for a literal dollar.") : t("Replacement is literal text.")}</span></div>}
      <Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover search-filter-toggle justify-start gap-1.5 text-caption p-0" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={13} />{t("Files to include / exclude")}{!filtersOpen && (options.include || options.exclude) && <Badge variant="outline" className="chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap">{t("Active")}</Badge>}</Button>
      {filtersOpen && <div className="search-filters [&_label]:flex [&_label]:flex-col [&_label]:gap-1 [&_label]:text-muted-foreground [&_label]:text-caption [&_input]:w-full flex flex-col gap-2"><label>{t("Files to include")}<Input aria-label={t("Files to include")} placeholder="e.g. src/**, *.tsx" value={options.include} onChange={(event) => setOptions({ ...options, include: event.target.value })} /></label><label>{t("Files to exclude")}<Input aria-label={t("Files to exclude")} placeholder="e.g. **/dist/**" value={options.exclude} onChange={(event) => setOptions({ ...options, exclude: event.target.value })} /></label></div>}
      <div className="search-summary p-[3px_0] leading-[1.5] muted text-muted-foreground small text-caption" role="status">{busy ? t("Searching…") : failed ? t("Search failed. Refresh to retry.") : options.query ? t("{0}{1} results in {2} {3}", { "0": result.limited ? 'First ' : '', "1": result.matches.length, "2": groups.size, "3": groups.size === 1 ? 'file' : 'files' }) : t("Search files in this workspace.")}</div>
      <div className="muted text-muted-foreground small text-caption search-scope-note text-caption p-[3px_0] leading-[1.5]">{t("Files on disk · Files up to 2 MB")}</div>
    </div>
    <VirtualList items={rows} rowHeight={rowHeight} itemKey={(row) => row.key} renderItem={renderRow} isFocusable={(row) => row.kind !== 'repo'} resetKey={`${options.query}:${viewMode}`} className={`search-results flex-1 min-h-0 overflow-auto search-results-${viewMode}`} />
  </div>
}
