import { searchableChats } from './chatSearch'
import { t, useLanguage } from './i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MessageSquare, Sparkles, User } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatSearchHit, Task } from '../../shared/types'
import { invoke } from './ipc'
import { timeAgo } from './Menu'
import { SearchInput } from './SearchInput'
import { useWorkspace } from './workspace'

/** Case-insensitive matches of `query` in `text`, wrapped in <mark>. */
function marked(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase()
  if (!needle) return text
  const parts: ReactNode[] = [], lower = text.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  parts.push(text.slice(from))
  return parts
}

type Result = { key: string; task: Task; hit?: ChatSearchHit }

/**
 * Search chats, like Codex: chat titles match as you type, and from two characters on, the text of every
 * conversation (your messages and the agent's replies). Opening a message match also finds it in the chat.
 */
export function SearchChats({ onClose }: { onClose: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChatSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const needle = query.trim().toLowerCase()

  useEffect(() => {
    if (needle.length < 2) { setHits([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => void invoke('agent.searchMessages', needle).then(
      (found) => { if (!cancelled) { setHits(found); setLoading(false) } },
      () => { if (!cancelled) { setHits([]); setLoading(false) } },
    ), 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [needle])

  const tasks = useMemo(() => new Map(ws.tasks.map((task) => [task.id, task])), [ws.tasks])
  const chats: Result[] = useMemo(() => {
    const live = ws.tasks.filter((task) => task.status !== 'archived')
    const found = needle ? searchableChats(ws.tasks).filter((task) => task.title.toLowerCase().includes(needle)) : [...live].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 8)
    return found.slice(0, 20).map((task) => ({ key: `chat:${task.id}`, task }))
  }, [ws.tasks, needle])
  // At most three matches per chat, so one long conversation doesn't bury the rest.
  const messages: Result[] = useMemo(() => {
    const perTask = new Map<string, number>()
    return hits.flatMap((hit) => {
      const task = tasks.get(hit.taskId), count = perTask.get(hit.taskId) ?? 0
      if (!task || count >= 3) return []
      perTask.set(hit.taskId, count + 1)
      return [{ key: `message:${hit.sessionId}:${hit.seq}`, task, hit }]
    })
  }, [hits, tasks])
  const results = [...chats, ...messages]
  useEffect(() => setSelected(0), [needle, hits])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [selected])

  const open = (result: Result) => {
    onClose()
    ws.openTask(result.task.id)
    if (!result.hit) return
    ws.openView(result.task.id, { kind: 'agent', sessionId: result.hit.sessionId })
    const query = needle
    setTimeout(() => window.dispatchEvent(new CustomEvent('ramu:find-in-chat', { detail: { query } })), 350)
  }
  const projectName = (task: Task) => ws.projects.find((project) => project.id === task.projectId)?.name

  const row = (result: Result, index: number) => {
    const { task, hit } = result
    const where = [projectName(task), timeAgo(task.lastActiveAt)].filter(Boolean).join(' · ')
    return <div key={result.key} id={`chat-search-${index}`} role="option" aria-selected={index === selected} className={`chat-search-row [&.message]:items-start [&.message_.palette-icon]:mt-0.5 [&[aria-selected='true']]:bg-accent [&_mark]:bg-transparent [&_mark]:text-brand [&_mark]:font-semibold flex items-center gap-2.5 min-h-[34px] p-[6px_10px] rounded-(--radius-s) cursor-default text-control${hit ? ' message' : ''}`} onMouseMove={() => setSelected(index)} onClick={() => open(result)}>
      <span className="palette-icon text-muted-foreground flex flex-none">{!hit ? <MessageSquare size={15} /> : hit.role === 'user' ? <User size={15} /> : <Sparkles size={15} />}</span>
      {hit
        ? <span className="chat-search-text flex flex-col gap-0.5 min-w-0 flex-1"><span className="chat-search-snippet text-foreground overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] leading-[1.45]">{marked(hit.snippet, needle)}</span><span className="chat-search-meta text-muted-foreground text-caption overflow-hidden text-ellipsis whitespace-nowrap">{task.title}{where && ` · ${where}`}</span></span>
        : <><span className="palette-label [&_mark]:bg-transparent [&_mark]:text-brand [&_mark]:font-semibold flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{marked(task.title, needle)}</span><span className="palette-detail text-caption text-muted-foreground whitespace-nowrap">{where}</span></>}
    </div>
  }

  return <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent className="palette [[data-slot='dialog-content']&]:block [[data-slot='dialog-content']&]:p-0 [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:gap-0 [[data-slot='dialog-content']&]:w-[min(640px,_calc(100vw_-_48px))] [[data-slot='dialog-content']&]:top-[12vh]! [[data-slot='dialog-content']&]:[translate:-50%_0]! [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&_[data-slot='command']]:p-1.5 [&_[data-slot='command-input-wrapper']]:p-[2px_2px_6px] [&_[data-slot='command-input']]:text-chat [&_[data-slot='command-input']]:[border:0] [&_[data-slot='command-input']]:[box-shadow:none] [&_[data-slot='command-input']]:[outline:0] [&_[data-slot='command-input']]:bg-transparent [&_[data-slot='command-input']]:p-0 [&_[data-slot='command-input']]:min-h-0 [&_[data-slot='command-input']]:h-full [&_[data-slot='command-item']]:gap-2.5 [&_[data-slot='command-item']]:min-h-8 [&_[data-slot='command-item']]:pt-1 [&_[data-slot='command-item']]:pb-1 [&_[data-slot='command-item']]:rounded-(--radius-s) [&_[data-slot='command-item'][data-selected='true']]:bg-accent [&_[data-slot='command-item'][data-selected='true']]:text-foreground [&_.palette-icon]:flex [&_.palette-icon]:flex-none [&_.palette-icon]:text-muted-foreground [&_[data-slot='command-item'][data-selected='true']_.palette-icon]:text-brand [&_.palette-label]:flex-1 [&_.palette-label]:min-w-0 [&_.palette-label]:overflow-hidden [&_.palette-label]:text-ellipsis [&_.palette-label]:whitespace-nowrap [&_.palette-label_mark]:bg-transparent [&_.palette-label_mark]:text-brand [&_.palette-label_mark]:font-semibold [&_[data-slot='command-shortcut']]:ml-auto [&_[data-slot='command-shortcut']]:pl-3 [&_[data-slot='command-shortcut']]:whitespace-nowrap [&_[data-slot='command-shortcut']]:text-caption [&_[data-slot='command-shortcut']]:tracking-[0] [&_[data-slot='command-input']:focus]:[border:0] [&_[data-slot='command-input']:focus]:[box-shadow:none] [&_[data-slot='command-input']:focus]:[outline:0] [&_[data-slot='command-input']:focus]:bg-transparent [&_[data-slot='command-input']:focus]:p-0 [&_[data-slot='command-input']:focus]:min-h-0 [&_[data-slot='command-input']:focus]:h-full [&_[data-slot='command-input']:focus-visible]:[border:0] [&_[data-slot='command-input']:focus-visible]:[box-shadow:none] [&_[data-slot='command-input']:focus-visible]:[outline:0] [&_[data-slot='command-input']:focus-visible]:bg-transparent [&_[data-slot='command-input']:focus-visible]:p-0 [&_[data-slot='command-input']:focus-visible]:min-h-0 [&_[data-slot='command-input']:focus-visible]:h-full [&_[data-slot='command-input-wrapper']_[data-slot='input-group-addon']]:pl-[9px]! [&_[data-slot='command-input-wrapper']_[data-slot='input-group-addon']]:pr-0 [&_[data-slot='command-input-wrapper']_[data-slot='command-input']]:pl-2.5 w-[min(640px,_calc(100vw_-_48px))] bg-card [border:1px_solid_var(--edge)] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] overflow-hidden [animation:pop_0.14s_var(--ease)] rounded-(--radius-l) chat-search-dialog flex flex-col max-h-[min(560px,_calc(100vh_-_120px))]" showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle className="sr-only">{t("Search chats")}</DialogTitle>
      <div className="chat-search-field p-[10px_10px_6px] flex-none">
        <SearchInput autoFocus maxLength={200} aria-label={t("Search chats")} aria-controls="chat-search-results" aria-activedescendant={results.length ? `chat-search-${selected}` : undefined} placeholder={t("Search chat titles and messages…")} value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, results.length - 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
          else if (event.key === 'Enter' && results[selected]) { event.preventDefault(); open(results[selected]!) }
        }} />
      </div>
      <div className="chat-search-results flex-1 min-h-0 overflow-y-auto p-[0_6px_6px]" id="chat-search-results" role="listbox" aria-label={t("Search results")} ref={list}>
        {chats.length > 0 && <div className="chat-search-heading p-[10px_10px_4px] text-muted-foreground text-caption font-medium">{needle ? t("Chats") : t("Recent chats")}</div>}
        {chats.map((result, index) => row(result, index))}
        {messages.length > 0 && <div className="chat-search-heading p-[10px_10px_4px] text-muted-foreground text-caption font-medium">{t("Messages")}</div>}
        {messages.map((result, index) => row(result, chats.length + index))}
        {!results.length && <p className="chat-search-empty m-0 p-[18px_10px] text-center text-control muted text-muted-foreground">{loading ? t("Searching…") : needle ? t("No chats or messages match.") : t("No chats yet")}</p>}
      </div>
    </DialogContent>
  </Dialog>
}
