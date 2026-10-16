import { SEARCH_RESULT_LIMIT } from '@ramu/shared/search/searchLimits'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, CommandInput, CommandShortcut } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { notifyError } from '../chat/Notifications'
import { formatKeys, type Command as PaletteCommand } from '../commands'
import { t, useLanguage } from '../i18n'
import { invoke, ramu } from '../ipc'
import { highlight } from '../lib/fuzzy'
import { VirtualList } from '../lib/VirtualList'
import { useModelSets } from '../models/ModelSets'
import { errorText } from '../workspace/TaskPane'
import type { WorkspaceApi } from '../workspace/workspace'
import { agentSource, chatsSource, commandsSource, filesSource, projectsSource } from './builtinSources'
import { contentSource } from './contentSource'
import { createPaletteEngine, type PaletteSnapshot } from './engine'
import { buildRows, firstRevealed, moveSelection, resolveSelection, type PaletteRow } from './rows'
import { parsePaletteQuery, type PaletteMode, type PaletteSource } from './sources'

const RECENT_KEY = 'ramu.recent-commands'
const EMPTY: PaletteSnapshot = { mode: 'all', text: '', groups: [], pending: false }
const NO_GROUPS: ReadonlySet<string> = new Set()

const rowHeight = (row: PaletteRow) => (row.kind === 'result' ? 32 : row.kind === 'limited' ? 24 : 28)

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : []
  } catch {
    return []
  }
}

/**
 * One box for everything. No prefix: files in the task's repositories, projects, chats and text inside
 * the files. ">" runs commands, "#" searches file contents only. Anything else can go to the agent.
 * Results come from {@link PaletteSource}s; see docs/UI.md to add one.
 */
export function Palette({
  ws,
  commands,
  mode,
  onClose,
}: {
  ws: WorkspaceApi
  commands: PaletteCommand[]
  mode: PaletteMode
  onClose: () => void
}) {
  const language = useLanguage()
  const { initialSettings } = useModelSets()
  const [query, setQuery] = useState(mode === 'commands' ? '>' : '')
  const [files, setFiles] = useState<{ repoId: string; path: string }[]>([])
  const [recent, setRecent] = useState(readRecent)
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [expanded, setExpanded] = useState(NO_GROUPS)
  const [chosen, setChosen] = useState<string | null>(null)
  const engine = useRef<ReturnType<typeof createPaletteEngine> | null>(null)
  const taskId = ws.ui.activeTaskId

  useEffect(() => {
    let disposed = false
    setFiles([])
    if (taskId)
      void invoke('files.all', taskId).then(
        (value) => {
          if (!disposed) setFiles(value)
        },
        (reason) => {
          if (!disposed) notifyError(errorText(reason), 'Quick Open')
        },
      )
    return () => {
      disposed = true
    }
  }, [taskId])

  const wsRef = useRef(ws)
  wsRef.current = ws
  const sources = useMemo(() => {
    const remember = (id: string) => {
      const next = [id, ...recent.filter((key) => key !== id)].slice(0, 20)
      setRecent(next)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        /* Session history remains available. */
      }
    }
    const list: PaletteSource[] = [
      commandsSource(commands, recent, remember),
      filesSource(ws, taskId, files),
      projectsSource(ws),
      chatsSource(ws),
    ]
    if (taskId) {
      list.push(
        contentSource({
          taskId,
          limit: SEARCH_RESULT_LIMIT,
          search: (id, options) => ramu.invoke('files.search', id, options),
          // Read through the ref so a workspace update does not make this source a new one mid-search.
          open: (match) =>
            wsRef.current.openView(taskId, {
              kind: 'file',
              repoId: match.repoId,
              path: match.path,
              preview: false,
              selection: {
                line: match.line,
                column: match.column,
                endColumn: match.endColumn,
                requestId: crypto.randomUUID(),
              },
            }),
          repoName: (repoId) =>
            (wsRef.current.bindings[taskId] ?? []).length > 1
              ? wsRef.current.binding(taskId, repoId)?.repoName
              : undefined,
        }),
        agentSource(ws, taskId, initialSettings),
      )
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `language` re-translates labels.
  }, [commands, ws, taskId, files, recent, initialSettings, language])

  useEffect(() => {
    const created = createPaletteEngine(setSnapshot)
    engine.current = created
    return () => {
      created.dispose()
      engine.current = null
    }
  }, [])
  useEffect(() => engine.current?.run(sources, query), [sources, query])

  const rows = useMemo(() => buildRows(snapshot.groups, expanded), [snapshot.groups, expanded])
  const selected = resolveSelection(rows, chosen)
  const selectedIndex = rows.findIndex((row) => row.key === selected)

  const choose = (row: PaletteRow | undefined) => {
    if (!row) return
    if (row.kind === 'more') {
      const group = snapshot.groups.find((entry) => entry.id === row.group)
      setExpanded(new Set([...expanded, row.group]))
      setChosen(group ? firstRevealed(group) : null)
    } else if (row.kind === 'result') {
      onClose()
      void Promise.resolve()
        .then(row.result.run)
        .catch((reason) => notifyError(errorText(reason), 'Command palette'))
    }
  }

  const parsed = parsePaletteQuery(query)
  const emptyText = !rows.length
    ? snapshot.pending
      ? t('Searching…')
      : parsed.mode === 'content' && !taskId
        ? t('Open a project to search inside its files')
        : parsed.mode === 'content' && parsed.text.length < 2
          ? t('Type at least {0} characters to search inside files', { '0': 2 })
          : parsed.text || parsed.mode === 'commands'
            ? t('No matches')
            : ''
    : ''

  const renderRow = (row: PaletteRow, index: number) => {
    switch (row.kind) {
      case 'header':
        return (
          <div
            role="presentation"
            className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground truncate', row.stale && 'opacity-60')}
          >
            {row.label}
          </div>
        )
      case 'loading':
        return (
          <div role="status" className="px-2 py-1 text-caption text-muted-foreground">
            {t('Searching…')}
          </div>
        )
      case 'error':
        return (
          <div role="alert" className="px-2 py-1 text-caption text-bad truncate" title={row.message}>
            {t('Search failed: {0}', { '0': row.message })}
          </div>
        )
      case 'limited':
        return (
          <div className="px-2 py-1 text-caption text-muted-foreground truncate">
            {t('Showing first {0}. Refine the search to narrow the results.', { '0': row.shown.toLocaleString() })}
          </div>
        )
      case 'more':
      case 'result': {
        const active = row.key === selected
        const result = row.kind === 'result' ? row.result : null
        return (
          <div
            role="option"
            id={`palette-option-${index}`}
            aria-selected={active}
            data-slot="command-item"
            data-selected={active}
            title={result?.snippet ? result.label : undefined}
            className={cn(
              'group/command-item relative flex h-full cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm select-none',
              active && 'bg-muted text-foreground',
              row.kind === 'result' && row.stale && 'opacity-60',
            )}
            onClick={() => choose(row)}
            onPointerMove={() => {
              if (!active) setChosen(row.key)
            }}
          >
            {result ? (
              <>
                <span className="palette-icon text-muted-foreground flex flex-none">{result.icon}</span>
                <span className="palette-label [&_mark]:bg-transparent [&_mark]:text-brand [&_mark]:font-semibold flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {result.snippet ? (
                    <>
                      {result.snippet.before}
                      <mark>{result.snippet.hit}</mark>
                      {result.snippet.after}
                    </>
                  ) : result.hits ? (
                    highlight(result.label, result.hits).map((part, i) =>
                      part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
                    )
                  ) : (
                    result.label
                  )}
                </span>
                {result.keys ? (
                  <CommandShortcut>{formatKeys(result.keys)}</CommandShortcut>
                ) : result.detail ? (
                  <CommandShortcut
                    className={cn(
                      'palette-detail text-caption text-muted-foreground whitespace-nowrap',
                      result.snippet && 'max-w-[45%] truncate',
                    )}
                  >
                    {result.detail}
                  </CommandShortcut>
                ) : null}
              </>
            ) : (
              <span className="text-caption text-muted-foreground">
                {t('Show {0} more', { '0': (row.kind === 'more' ? row.hidden : 0).toLocaleString() })}
              </span>
            )}
          </div>
        )
      }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.nativeEvent.isComposing) return
    const step =
      e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'j'))
        ? 1
        : e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'k'))
          ? -1
          : 0
    if (step) {
      e.preventDefault()
      e.stopPropagation()
      setChosen(moveSelection(rows, selected, step))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      choose(rows.find((row) => row.key === selected))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="palette [[data-slot='dialog-content']&]:block [[data-slot='dialog-content']&]:p-0 [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:gap-0 [[data-slot='dialog-content']&]:w-[min(640px,_calc(100vw_-_48px))] [[data-slot='dialog-content']&]:top-[12vh]! [[data-slot='dialog-content']&]:[translate:-50%_0]! [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&_[data-slot='command']]:p-1.5 [&_[data-slot='command-input-wrapper']]:p-[2px_2px_6px] [&_[data-slot='command-input']]:text-chat [&_[data-slot='command-input']]:[border:0] [&_[data-slot='command-input']]:[box-shadow:none] [&_[data-slot='command-input']]:[outline:0] [&_[data-slot='command-input']]:bg-transparent [&_[data-slot='command-input']]:p-0 [&_[data-slot='command-input']]:min-h-0 [&_[data-slot='command-input']]:h-full [&_[data-slot='command-item']]:gap-2.5 [&_[data-slot='command-item']]:min-h-8 [&_[data-slot='command-item']]:pt-1 [&_[data-slot='command-item']]:pb-1 [&_[data-slot='command-item']]:rounded-(--radius-s) [&_[data-slot='command-item'][data-selected='true']]:bg-accent [&_[data-slot='command-item'][data-selected='true']]:text-foreground [&_.palette-icon]:flex [&_.palette-icon]:flex-none [&_.palette-icon]:text-muted-foreground [&_[data-slot='command-item'][data-selected='true']_.palette-icon]:text-brand [&_.palette-label]:flex-1 [&_.palette-label]:min-w-0 [&_.palette-label]:overflow-hidden [&_.palette-label]:text-ellipsis [&_.palette-label]:whitespace-nowrap [&_.palette-label_mark]:bg-transparent [&_.palette-label_mark]:text-brand [&_.palette-label_mark]:font-semibold [&_[data-slot='command-shortcut']]:ml-auto [&_[data-slot='command-shortcut']]:pl-3 [&_[data-slot='command-shortcut']]:whitespace-nowrap [&_[data-slot='command-shortcut']]:text-caption [&_[data-slot='command-shortcut']]:tracking-[0] [&_[data-slot='command-input']:focus]:[border:0] [&_[data-slot='command-input']:focus]:[box-shadow:none] [&_[data-slot='command-input']:focus]:[outline:0] [&_[data-slot='command-input']:focus]:bg-transparent [&_[data-slot='command-input']:focus]:p-0 [&_[data-slot='command-input']:focus]:min-h-0 [&_[data-slot='command-input']:focus]:h-full [&_[data-slot='command-input']:focus-visible]:[border:0] [&_[data-slot='command-input']:focus-visible]:[box-shadow:none] [&_[data-slot='command-input']:focus-visible]:[outline:0] [&_[data-slot='command-input']:focus-visible]:bg-transparent [&_[data-slot='command-input']:focus-visible]:p-0 [&_[data-slot='command-input']:focus-visible]:min-h-0 [&_[data-slot='command-input']:focus-visible]:h-full [&_[data-slot='command-input-wrapper']_[data-slot='input-group-addon']]:pl-[9px]! [&_[data-slot='command-input-wrapper']_[data-slot='input-group-addon']]:pr-0 [&_[data-slot='command-input-wrapper']_[data-slot='command-input']]:pl-2.5 w-[min(640px,_calc(100vw_-_48px))] bg-card [border:1px_solid_var(--edge)] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] overflow-hidden [animation:pop_0.14s_var(--ease)] rounded-(--radius-l)"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t('Command palette')}</DialogTitle>
        {/* Rows are drawn by the virtual list, so the input keeps focus and arrow keys move the selection here. */}
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            aria-label={t('Search files and commands')}
            aria-controls="palette-options"
            aria-activedescendant={selectedIndex >= 0 ? `palette-option-${selectedIndex}` : undefined}
            value={query}
            placeholder={
              taskId ? t('Search files, threads, or projects. Type > for commands') : t('Type > for commands')
            }
            onValueChange={(value) => {
              setQuery(value)
              setChosen(null)
              setExpanded(NO_GROUPS)
            }}
            onKeyDown={onKeyDown}
          />
          <div id="palette-options" role="listbox" aria-label={t('Results')}>
            <VirtualList
              items={rows}
              rowHeight={rowHeight}
              itemKey={(row) => row.key}
              renderItem={renderRow}
              resetKey={query}
              revealKey={selected ?? undefined}
              className="max-h-[min(440px,calc(100vh-180px))] overflow-x-hidden overflow-y-auto p-1 no-scrollbar"
            />
          </div>
          {emptyText && (
            <div role="status" className="py-6 text-center text-sm">
              {emptyText}
            </div>
          )}
          {!query && taskId && (
            <div className="px-2 pt-1 pb-0.5 text-caption text-muted-foreground">
              {t('Type > for commands, # to search inside files')}
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
