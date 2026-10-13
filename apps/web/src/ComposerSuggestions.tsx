import { t, useLanguage } from './i18n'
import { errorText } from './errors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/desktop-button'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FileContext, SkillInfo } from '@ramu/shared/types'
import { invoke } from './ipc'
import { useWorkspace } from './workspace'
import { readBuffer, readSelection } from './editorBuffers'
import { buildComposerContext } from '@ramu/shared/composerContext'
import { notifyError } from './Notifications'
import { useAppSettings } from './AppSettings'
import { openReview } from './reviews'

/** Drag payload for a file dragged from the Explorer into a composer: JSON `{ repoId, path }`. */
export const FILE_DRAG_TYPE = 'application/x-ramu-file'
/** Most files that can ride along as dropped context on one message. */
export const MAX_PINNED_FILES = 20

interface Choice { id: string; label: string; description: string; kind: 'Command' | 'Skill' | 'File'; insertion?: string; file?: { repoId: string; path: string }; action?: () => void }
export function useComposerSuggestions(value: string, caret: number, scopeId?: string, chat = false) {
  const language = useLanguage()

  const listId = useId()
  const ws = useWorkspace(), scope = scopeId ?? ws.ui.activeTaskId
  const { preferences } = useAppSettings()
  const [files, setFiles] = useState<{ repoId: string; path: string }[]>([]), [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0), [dismissed, setDismissed] = useState<string | null>(null)
  const [mentions, setMentions] = useState<{ file: { repoId: string; path: string }; insertion: string }[]>([])
  // Files dropped on the chat ride along as chips above the text, not as text in the box.
  const [pinned, setPinned] = useState<{ repoId: string; path: string }[]>([])
  const prefix = value.slice(0, caret), trigger = prefix.match(/(?:^|\s)([@/])([^\s]*)$/)
  const mode = trigger?.[1], query = trigger?.[2]?.toLowerCase() ?? ''
  const signature = `${scope}:${caret}:${mode}:${query}`, visible = !!mode && dismissed !== signature
  useEffect(() => { setSelected(0); setDismissed(null) }, [scope, mode, query])
  useEffect(() => { setFiles([]); setSkills([]); setMentions([]); setPinned([]) }, [scope])
  useEffect(() => {
    if (!visible || !scope) return
    let disposed = false
    setLoading(true); setLoadError(null)
    void Promise.all([invoke('files.all', scope), invoke('skills.list', scope)]).then(([f, s]) => { if (!disposed) { setFiles(f); setSkills(s) } }, (e) => { if (!disposed) setLoadError(errorText(e)) }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [scope, mode])
  const repoName = (repoId: string) => Object.values(ws.repos).flat().find((r) => r.id === repoId)?.name ?? repoId
  const choices = useMemo(() => {
    const commands: Choice[] = [
      { id: 'new', label: '/new', description: t("Start a new chat"), kind: 'Command', action: () => ws.newTask() },
      { id: 'goal', label: '/goal', description: t('Keep working until a goal is complete'), kind: 'Command', insertion: '/goal ' },
      ...(chat ? [{ id: 'goal-pause', label: '/goal pause', description: t('Pause goal'), kind: 'Command' as const, insertion: '/goal pause' }, { id: 'goal-resume', label: '/goal resume', description: t('Resume goal'), kind: 'Command' as const, insertion: '/goal resume' }, { id: 'goal-clear', label: '/goal clear', description: t('Clear goal'), kind: 'Command' as const, insertion: '/goal clear' }] : []),
      { id: 'schedule', label: '/schedule', description: t("Create a schedule through the agent"), kind: 'Command', insertion: 'Create a schedule for: ' },
      { id: 'schedules', label: '/schedules', description: t("Open schedules and run history"), kind: 'Command', action: () => ws.setSidebar('schedules') },
      { id: 'changes', label: '/changes', description: t("Open the chat's changed files"), kind: 'Command', action: () => { void invoke('reviews.list').then((reviews) => { const review = reviews.find((r) => r.taskId === scope); if (review) openReview(ws, { id: review.id, taskId: review.taskId }); else notifyError('This chat has no recorded file changes yet.', 'Changes') }) } },
      { id: 'recap', label: '/recap', description: t("Open your daily recap"), kind: 'Command', action: () => ws.showHome() },
      { id: 'settings', label: '/settings', description: t("Open app settings"), kind: 'Command', action: () => window.dispatchEvent(new Event('ramu:settings')) },
      { id: 'clear', label: '/clear', description: t("Clear this draft"), kind: 'Command', insertion: '' },
      // A chat's composer only: the question goes to an aside, never to the agent.
      ...(chat ? [{ id: 'aside', label: '/aside', description: t("Ask a side question without interrupting the chat"), kind: 'Command' as const, insertion: '/aside ' }] : []),
    ]
    const options: Choice[] = mode === '@' ? files.map((file) => ({ id: `${file.repoId}:${file.path}`, label: `${repoName(file.repoId)}/${file.path}`, description: t("Add file context"), kind: 'File', insertion: `@"${repoName(file.repoId)}/${file.path}" `, file })) : [...commands, ...skills.map((s): Choice => ({ id: `skill:${s.path}`, label: `/${s.name}`, description: s.description, kind: 'Skill', insertion: `$${s.name} ` }))]
    return options.filter((c) => `${c.label} ${c.description}`.toLowerCase().includes(query)).slice(0, 30)
  }, [mode, query, files, skills, ws, language, chat])
  const hydrate = (): FileContext[] => {
    const state = scope ? ws.taskUi[scope] : undefined
    return buildComposerContext({
      views: state?.views ?? [], activeViewId: state?.activeViewId ?? null,
      explicitFiles: [...pinned, ...mentions.filter((mention) => value.includes(mention.insertion.trim())).map((mention) => mention.file)],
      includeTabContext: preferences.includeTabContext,
      readBuffer: (file) => scope ? readBuffer(ws.workspaceOf(scope), file.repoId, file.path) : undefined,
      readSelection,
    })
  }
  const mention = (file: { repoId: string; path: string }): string => {
    const insertion = `@"${repoName(file.repoId)}/${file.path}" `
    setMentions((m) => m.some((entry) => entry.insertion === insertion) ? m : [...m, { file, insertion }])
    return insertion
  }
  const pinnedNow = useRef(pinned); pinnedNow.current = pinned
  /** Adds files up to the limit and says how many did not fit. */
  const pinMany = (files: { repoId: string; path: string }[]): number => {
    const next = [...pinnedNow.current]; let dropped = 0
    for (const file of files) {
      if (next.some((entry) => entry.repoId === file.repoId && entry.path === file.path)) continue
      if (next.length >= MAX_PINNED_FILES) { dropped++; continue }
      next.push(file)
    }
    pinnedNow.current = next; setPinned(next)
    return dropped
  }
  const unpin = (file: { repoId: string; path: string }) => setPinned((current) => current.filter((entry) => entry.repoId !== file.repoId || entry.path !== file.path))
  return { listId, visible, choices, mention, pinned, pinMany, scope, unpin, clearPinned: () => setPinned([]), selected: Math.min(selected, Math.max(0, choices.length - 1)), loading, loadError, hydrate, repoName,
    move: (delta: number) => setSelected((i) => (i + delta + choices.length) % Math.max(1, choices.length)),
    dismiss: () => setDismissed(signature),
    choose: (choice: Choice) => {
      const start = prefix.length - (trigger?.[2]?.length ?? 0) - 1
      const insertion = choice.insertion ?? ''
      if (choice.file) setMentions((m) => [...m, { file: choice.file!, insertion }])
      choice.action?.(); setDismissed(signature)
      return { value: value.slice(0, start) + insertion + value.slice(caret), caret: start + insertion.length }
    },
  }
}
export function ComposerSuggestions({ suggestions, onChoose }: { suggestions: ReturnType<typeof useComposerSuggestions>; onChoose: (index: number) => void }) {
  const language = useLanguage()

  useEffect(() => { document.getElementById(`${suggestions.listId}-${suggestions.selected}`)?.scrollIntoView({ block: 'nearest' }) }, [suggestions.listId, suggestions.selected])
  return <div className="composer-suggestions [&_button]:w-full [&_button]:[border:0] [&_button]:bg-transparent [&_button]:text-left [&_button]:flex [&_button]:items-center [&_button]:justify-between [&_button]:gap-3.5 [&_button]:p-[10px_12px] [&_button]:rounded-(--radius-s) [&_button.selected]:[background:#ffffff10] [&_button_strong]:text-caption [&_button_strong]:font-medium [&_button_>_span:first-child]:min-w-0 [&_button_.block]:overflow-hidden [&_button_.block]:text-ellipsis [&_button_.block]:whitespace-nowrap [&_button_.block]:max-w-[600px] [&_button_.block]:mt-[3px] [animation:arrive_120ms_var(--ease)] [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] absolute z-100 bottom-[calc(100%_+_8px)] left-0 right-0 max-h-[330px] overflow-y-auto bg-raised [border:1px_solid_var(--edge)] rounded-(--radius-row) [box-shadow:0_10px_35px_#0008] p-[5px]" role="listbox" id={suggestions.listId} aria-label={t("Commands, skills, and files")}>
    {suggestions.loading && <div className="suggestion-status p-3 muted text-muted-foreground small text-caption">{t("Loading commands, skills and files…")}</div>}
    {suggestions.loadError && <div className="suggestion-status p-3 error text-bad small text-caption">{suggestions.loadError}</div>}
    {suggestions.choices.map((choice, i) => <Button variant="secondary" type="button" key={choice.id} id={`${suggestions.listId}-${i}`} role="option" aria-selected={i === suggestions.selected} className={i === suggestions.selected ? 'selected' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onChoose(i)}><span><strong>{choice.label}</strong><span className="muted text-muted-foreground small text-caption block block">{choice.description}</span></span><Badge variant="outline" className="chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap">{t(choice.kind)}</Badge></Button>)}
    {!suggestions.loading && !suggestions.choices.length && <div className="suggestion-status p-3 muted text-muted-foreground">{t("No matching commands, skills, or files.")}</div>}
  </div>
}
