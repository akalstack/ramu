import { t, useLanguage } from '../i18n'
import type { DraftMention } from '@ramu/shared/chat/composerDraft'
import { errorText } from '../lib/errors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/desktop-button'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AgentModel, FileContext, SkillInfo } from '@ramu/shared/types'
import { customAgentHandle, type CustomAgent } from '@ramu/shared/customAgents'
import { modelHandle } from '@ramu/shared/chat/helperMentions'
import { providerName } from '@ramu/shared/providers/providers'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace } from '../workspace/workspace'
import { readBuffer, readSelection } from '../editor/editorBuffers'
import { buildComposerContext } from '@ramu/shared/chat/composerContext'
import { acceptComposerTrigger, composerTrigger } from '@ramu/shared/chat/composerTrigger'
import { notifyError } from '../chat/Notifications'
import { useAppSettings } from '../settings/AppSettings'
import { openReview } from '../git/reviews'

/** Drag payload for a file dragged from the Explorer into a composer: JSON `{ repoId, path }`. */
export const FILE_DRAG_TYPE = 'application/x-ramu-file'
/** Most files that can ride along as dropped context on one message. */
export const MAX_PINNED_FILES = 20

interface Choice {
  id: string
  label: string
  description: string
  kind: 'Command' | 'Skill' | 'File' | 'Model' | 'Agent'
  insertion?: string
  file?: { repoId: string; path: string }
  action?: () => void
}
/**
 * Who `@` at the start of a message can hand it to: a model or custom agent the thread's agent starts as a helper.
 */
export interface ComposerHelpers {
  models: AgentModel[]
  agents: CustomAgent[]
  /** Who a message can start with, so `@sonnet-5.5` draws as that model rather than a file. */
  mentions?: DraftMention[]
}

export function useComposerSuggestions(
  value: string,
  caret: number,
  scopeId?: string,
  chat = false,
  helpers?: ComposerHelpers,
) {
  const language = useLanguage()

  const listId = useId()
  const ws = useWorkspace(),
    scope = scopeId ?? ws.ui.activeTaskId
  const { preferences } = useAppSettings()
  const { invoke } = useHost()
  const [files, setFiles] = useState<{ repoId: string; path: string }[]>([]),
    [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0),
    [dismissed, setDismissed] = useState<string | null>(null)
  const [mentions, setMentions] = useState<{ file: { repoId: string; path: string }; insertion: string }[]>([])
  // Files dropped on the chat ride along as chips above the text, not as text in the box.
  const [pinned, setPinned] = useState<{ repoId: string; path: string }[]>([])
  const trigger = composerTrigger(value, caret)
  const mode = trigger?.mode,
    query = trigger?.query.toLowerCase() ?? ''
  const signature = `${scope}:${caret}:${mode}:${query}`,
    visible = !!mode && dismissed !== signature
  useEffect(() => {
    setSelected(0)
    setDismissed(null)
  }, [scope, mode, query])
  useEffect(() => {
    setFiles([])
    setSkills([])
    setMentions([])
    setPinned([])
  }, [scope])
  useEffect(() => {
    if (!visible || !scope) return
    let disposed = false
    setLoading(true)
    setLoadError(null)
    // A skills failure must not hide files (and slash commands need no file scan).
    const request =
      mode === '@'
        ? invoke('files.all', scope).then((files) => {
            if (!disposed) setFiles(files)
          })
        : invoke('skills.list', scope).then((skills) => {
            if (!disposed) setSkills(skills)
          })
    void request
      .then(undefined, (e) => {
        if (!disposed) setLoadError(errorText(e))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [scope, mode, invoke] by design; the values it reads beyond these are current as of that run
  }, [scope, mode, invoke])
  const repoName = (repoId: string) =>
    Object.values(ws.repos)
      .flat()
      .find((r) => r.id === repoId)?.name ?? repoId
  const choices = useMemo(() => {
    const agentHandles = new Set((helpers?.agents ?? []).map((agent) => customAgentHandle(agent.name)))
    // Only a message that starts with the mention goes to a helper, so they are offered only there.
    const mentions: Choice[] = [
      ...(helpers?.agents ?? []).map((agent) => ({
        id: `agent:${agent.id}`,
        label: `@${customAgentHandle(agent.name)}`,
        description: agent.description || t('Custom agent'),
        kind: 'Agent' as const,
        insertion: `@${customAgentHandle(agent.name)} `,
      })),
      ...(helpers?.models ?? [])
        .filter((model) => !model.isLegacy && !agentHandles.has(modelHandle(model)))
        .map((model) => ({
          id: `model:${model.provider}:${model.id}`,
          label: `@${modelHandle(model)}`,
          description: t('A helper on {0}: reads only unless you ask for changes', {
            0: `${model.name || model.id} · ${providerName(model.provider)}`,
          }),
          kind: 'Model' as const,
          insertion: `@${modelHandle(model)} `,
        })),
    ]
    const commands: Choice[] = [
      { id: 'new', label: '/new', description: t('Start a new thread'), kind: 'Command', action: () => ws.newTask() },
      {
        id: 'goal',
        label: '/goal',
        description: t('Keep working until a goal is complete'),
        kind: 'Command',
        insertion: '/goal ',
      },
      ...(chat
        ? [
            {
              id: 'goal-pause',
              label: '/goal pause',
              description: t('Pause goal'),
              kind: 'Command' as const,
              insertion: '/goal pause',
            },
            {
              id: 'goal-resume',
              label: '/goal resume',
              description: t('Resume goal'),
              kind: 'Command' as const,
              insertion: '/goal resume',
            },
            {
              id: 'goal-clear',
              label: '/goal clear',
              description: t('Clear goal'),
              kind: 'Command' as const,
              insertion: '/goal clear',
            },
          ]
        : []),
      {
        id: 'schedule',
        label: '/schedule',
        description: t('Create a schedule through the agent'),
        kind: 'Command',
        insertion: 'Create a schedule for: ',
      },
      {
        id: 'schedules',
        label: '/schedules',
        description: t('Open schedules and run history'),
        kind: 'Command',
        action: () => ws.setSidebar('schedules'),
      },
      {
        id: 'changes',
        label: '/changes',
        description: t("Open the thread's changed files"),
        kind: 'Command',
        action: () => {
          void invoke('reviews.list').then((reviews) => {
            const review = reviews.find((r) => r.taskId === scope)
            if (review) openReview(ws, { id: review.id, taskId: review.taskId })
            else notifyError('This thread has no recorded file changes yet.', 'Changes')
          })
        },
      },
      {
        id: 'recap',
        label: '/recap',
        description: t('Open your daily recap'),
        kind: 'Command',
        action: () => ws.showHome(),
      },
      {
        id: 'settings',
        label: '/settings',
        description: t('Open app settings'),
        kind: 'Command',
        action: () => window.dispatchEvent(new Event('ramu:settings')),
      },
      ...(preferences.memory.enabled
        ? [
            {
              id: 'remember',
              label: '/remember',
              description: t('Save something to shared memory'),
              kind: 'Command' as const,
              insertion: 'Remember this for future threads: ',
            },
            {
              id: 'forget',
              label: '/forget',
              description: t('Ask the agent to forget a memory'),
              kind: 'Command' as const,
              insertion: 'Forget this memory: ',
            },
            {
              id: 'memory',
              label: '/memory',
              description: t('Open saved memories'),
              kind: 'Command' as const,
              action: () =>
                window.dispatchEvent(
                  new CustomEvent('ramu:settings', { detail: { section: 'memory', target: 'Saved memories' } }),
                ),
            },
          ]
        : []),
      ...(preferences.intelligence.learning !== 'off'
        ? [
            {
              id: 'learn',
              label: '/learn',
              description: t('Review recent threads for lessons and skills now'),
              kind: 'Command' as const,
              action: () => {
                void invoke('learning.run').catch((e) => notifyError(errorText(e), 'Learning'))
              },
            },
          ]
        : []),
      { id: 'clear', label: '/clear', description: t('Clear this draft'), kind: 'Command', insertion: '' },
      // A chat's composer only: the question goes to an aside, never to the agent.
      ...(chat
        ? [
            {
              id: 'mcp',
              label: '/mcp',
              description: t('Show MCP connection status'),
              kind: 'Command' as const,
              action: () => window.dispatchEvent(new CustomEvent('ramu:mcp-status')),
            },
            {
              id: 'aside',
              label: '/aside',
              description: t('Ask a side question without interrupting the thread'),
              kind: 'Command' as const,
              insertion: '/aside ',
            },
            {
              id: 'btw',
              label: '/btw',
              description: t('Same as /aside: ask without interrupting the thread'),
              kind: 'Command' as const,
              insertion: '/btw ',
            },
          ]
        : []),
    ]
    const options: Choice[] =
      mode === '@'
        ? [
            ...(trigger?.start === 0 ? mentions : []),
            ...files.map((file): Choice => ({
              id: `${file.repoId}:${file.path}`,
              label: `${repoName(file.repoId)}/${file.path}`,
              description: t('Add file context'),
              kind: 'File',
              insertion: `@"${repoName(file.repoId)}/${file.path}" `,
              file,
            })),
          ]
        : [
            ...(mode === '/' ? commands : []),
            ...skills.map((s): Choice => ({
              id: `skill:${s.path}`,
              label: `${mode}${s.name}`,
              description: s.description,
              kind: 'Skill',
              insertion: `$${s.name} `,
            })),
          ]
    return options.filter((c) => `${c.label} ${c.description}`.toLowerCase().includes(query)).slice(0, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [mount only] by design; the values it reads beyond these are current as of that run
  }, [
    mode,
    query,
    files,
    skills,
    ws,
    invoke,
    language,
    chat,
    preferences.memory.enabled,
    preferences.intelligence.learning,
    helpers,
    trigger?.start,
  ])
  const hydrate = (): FileContext[] => {
    const state = scope ? ws.taskUi[scope] : undefined
    return buildComposerContext({
      views: state?.views ?? [],
      activeViewId: state?.activeViewId ?? null,
      explicitFiles: [
        ...pinned,
        ...mentions.filter((mention) => value.includes(mention.insertion.trim())).map((mention) => mention.file),
      ],
      includeTabContext: preferences.includeTabContext,
      readBuffer: (file) => (scope ? readBuffer(ws.workspaceOf(scope), file.repoId, file.path) : undefined),
      readSelection,
    })
  }
  const mention = (file: { repoId: string; path: string }): string => {
    const insertion = `@"${repoName(file.repoId)}/${file.path}" `
    setMentions((m) => (m.some((entry) => entry.insertion === insertion) ? m : [...m, { file, insertion }]))
    return insertion
  }
  const pinnedNow = useRef(pinned)
  pinnedNow.current = pinned
  /** Adds files up to the limit and says how many did not fit. */
  const pinMany = (files: { repoId: string; path: string }[]): number => {
    const next = [...pinnedNow.current]
    let dropped = 0
    for (const file of files) {
      if (next.some((entry) => entry.repoId === file.repoId && entry.path === file.path)) continue
      if (next.length >= MAX_PINNED_FILES) {
        dropped++
        continue
      }
      next.push(file)
    }
    pinnedNow.current = next
    setPinned(next)
    return dropped
  }
  const unpin = (file: { repoId: string; path: string }) =>
    setPinned((current) => current.filter((entry) => entry.repoId !== file.repoId || entry.path !== file.path))
  return {
    listId,
    // `$` is ordinary text unless a skill matches, so it never shows an empty picker.
    visible: visible && !(mode === '$' && !loading && choices.length === 0),
    choices,
    mention,
    pinned,
    pinMany,
    scope,
    unpin,
    clearPinned: () => setPinned([]),
    selected: Math.min(selected, Math.max(0, choices.length - 1)),
    loading,
    loadError,
    hydrate,
    repoName,
    move: (delta: number) => setSelected((i) => (i + delta + choices.length) % Math.max(1, choices.length)),
    dismiss: () => setDismissed(signature),
    choose: (choice: Choice) => {
      const insertion = choice.insertion ?? ''
      if (choice.file) setMentions((m) => [...m, { file: choice.file!, insertion }])
      choice.action?.()
      setDismissed(signature)
      return trigger ? acceptComposerTrigger(value, caret, trigger, insertion) : { value, caret }
    },
  }
}
export function ComposerSuggestions({
  suggestions,
  onChoose,
}: {
  suggestions: ReturnType<typeof useComposerSuggestions>
  onChoose: (index: number) => void
}) {
  useLanguage()

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    const option = document.getElementById(`${suggestions.listId}-${suggestions.selected}`)
    if (!list || !option) return
    // Scroll only the popup, keeping the composer and transcript in place.
    const top = option.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop
    if (top < 0) list.scrollTop += top
    else if (top + option.offsetHeight > list.clientHeight)
      list.scrollTop += top + option.offsetHeight - list.clientHeight
  }, [suggestions.listId, suggestions.selected, suggestions.choices])
  return (
    <div
      ref={listRef}
      className="composer-suggestions [animation:arrive_120ms_var(--ease)] [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] absolute z-100 bottom-[calc(100%_+_8px)] left-0 right-0 max-h-[330px] overflow-x-hidden overflow-y-auto bg-raised [border:1px_solid_var(--edge)] rounded-(--radius-row) [box-shadow:0_10px_35px_#0008] p-[5px]"
      role="listbox"
      id={suggestions.listId}
      aria-label={t('Commands, skills, and files')}
    >
      {suggestions.loading && (
        <div className="suggestion-status p-3 muted text-muted-foreground small text-caption">
          {t('Loading commands, skills and files…')}
        </div>
      )}
      {suggestions.loadError && (
        <div className="suggestion-status p-3 error text-bad small text-caption">{suggestions.loadError}</div>
      )}
      {suggestions.choices.map((choice, i) => (
        <Button
          variant="secondary"
          type="button"
          key={choice.id}
          id={`${suggestions.listId}-${i}`}
          role="option"
          aria-selected={i === suggestions.selected}
          title={choice.label}
          className="w-full min-w-0 justify-between gap-3.5 rounded-(--radius-s) border-0 bg-transparent p-[10px_12px] text-left aria-selected:bg-hover hover:bg-hover"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChoose(i)}
        >
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-caption font-medium">
              {choice.file ? choice.file.path.split('/').pop() : choice.label}
            </strong>
            <span className="mt-[3px] block truncate text-muted-foreground text-caption">
              {choice.file ? choice.label : choice.description}
            </span>
          </span>
          <Badge
            variant="outline"
            className="shrink-0 chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap"
          >
            {t(choice.kind)}
          </Badge>
        </Button>
      ))}
      {!suggestions.loading && !suggestions.choices.length && (
        <div className="suggestion-status p-3 muted text-muted-foreground">
          {t('No matching commands, skills, or files.')}
        </div>
      )}
    </div>
  )
}
