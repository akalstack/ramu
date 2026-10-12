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
    const found = needle ? live.filter((task) => task.title.toLowerCase().includes(needle)) : [...live].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 8)
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
    return <div key={result.key} id={`chat-search-${index}`} role="option" aria-selected={index === selected} className={`chat-search-row${hit ? ' message' : ''}`} onMouseMove={() => setSelected(index)} onClick={() => open(result)}>
      <span className="palette-icon">{!hit ? <MessageSquare size={15} /> : hit.role === 'user' ? <User size={15} /> : <Sparkles size={15} />}</span>
      {hit
        ? <span className="chat-search-text"><span className="chat-search-snippet">{marked(hit.snippet, needle)}</span><span className="chat-search-meta">{task.title}{where && ` · ${where}`}</span></span>
        : <><span className="palette-label">{marked(task.title, needle)}</span><span className="palette-detail">{where}</span></>}
    </div>
  }

  return <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent className="palette chat-search-dialog" showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle className="sr-only">{t("Search chats")}</DialogTitle>
      <div className="chat-search-field">
        <SearchInput autoFocus aria-label={t("Search chats")} aria-controls="chat-search-results" aria-activedescendant={results.length ? `chat-search-${selected}` : undefined} placeholder={t("Search chat titles and messages…")} value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, results.length - 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
          else if (event.key === 'Enter' && results[selected]) { event.preventDefault(); open(results[selected]!) }
        }} />
      </div>
      <div className="chat-search-results" id="chat-search-results" role="listbox" aria-label={t("Search results")} ref={list}>
        {chats.length > 0 && <div className="chat-search-heading">{needle ? t("Chats") : t("Recent chats")}</div>}
        {chats.map((result, index) => row(result, index))}
        {messages.length > 0 && <div className="chat-search-heading">{t("Messages")}</div>}
        {messages.map((result, index) => row(result, chats.length + index))}
        {!results.length && <p className="chat-search-empty muted">{loading ? t("Searching…") : needle ? t("No chats or messages match.") : t("No chats yet")}</p>}
      </div>
    </DialogContent>
  </Dialog>
}
