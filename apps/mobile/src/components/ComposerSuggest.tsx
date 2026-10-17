import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Command, FileText, Sparkles } from 'lucide-react-native'
import type { SkillInfo } from '@ramu/shared/types'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { T, tap } from './ui'

export interface Choice {
  id: string
  label: string
  description: string
  kind: 'Command' | 'Skill' | 'File'
  insertion?: string
  file?: { repoId: string; path: string }
  run?: () => void
}
interface Loaded {
  scope: string
  files: { repoId: string; path: string }[]
  skills: SkillInfo[]
  names: Record<string, string>
}

/**
 * The desktop composer's `/` and `@` pickers: commands and skills after a slash, files after an at-sign. The trigger is the
 * word at the caret; choosing an entry replaces it. Files and skills come from the computer for the chat's workspace.
 */
export function useComposerSuggest({
  computerId,
  scope,
  chatId,
  text,
  caret,
}: {
  computerId: string
  scope?: string
  chatId?: string
  text: string
  caret: number
}) {
  const store = useStore()
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const prefix = text.slice(0, caret)
  const trigger = prefix.match(/(?:^|\s)([@/])([^\s]*)$/)
  const mode = trigger?.[1] as '@' | '/' | undefined
  const query = (trigger?.[2] ?? '').toLowerCase()
  const signature = `${caret}:${mode}:${query}`
  const visible = Boolean(mode) && dismissed !== signature
  const online = store.isOnline(computerId)
  useEffect(() => {
    setDismissed(null)
  }, [mode, query])
  useEffect(() => {
    if (!visible || !scope || loaded?.scope === scope) return
    if (!online) {
      setError('Reconnect this host to browse its files and skills.')
      return
    }
    let alive = true
    setLoading(true)
    setError(undefined)
    void Promise.all([
      store.invoke(computerId, 'files.all', scope),
      store.invoke(computerId, 'skills.list', scope),
      store.invoke(computerId, 'tasks.bindings', scope),
    ])
      .then(
        ([files, skills, bindings]) => {
          if (alive)
            setLoaded({ scope, files, skills, names: Object.fromEntries(bindings.map((b) => [b.repoId, b.repoName])) })
        },
        (e) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        },
      )
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [visible, scope, online, computerId])
  const data = loaded?.scope === scope ? loaded : undefined

  const choices = useMemo<Choice[]>(() => {
    if (!mode) return []
    const go = (to: Parameters<typeof router.push>[0]) => () => router.push(to)
    const commands: Choice[] = [
      { id: 'new', label: '/new', description: 'Start a new thread', kind: 'Command', run: go('/new') },
      {
        id: 'goal',
        label: '/goal',
        description: 'Keep working until a goal is complete',
        kind: 'Command',
        insertion: '/goal ',
      },
      ...(chatId
        ? [
            {
              id: 'goal-pause',
              label: '/goal pause',
              description: 'Pause goal',
              kind: 'Command' as const,
              insertion: '/goal pause',
            },
            {
              id: 'goal-resume',
              label: '/goal resume',
              description: 'Resume goal',
              kind: 'Command' as const,
              insertion: '/goal resume',
            },
            {
              id: 'aside',
              label: '/aside',
              description: 'Ask a side question without interrupting the thread',
              kind: 'Command' as const,
              insertion: '/aside ',
            },
            {
              id: 'changes',
              label: '/changes',
              description: 'Open the thread’s changed files',
              kind: 'Command' as const,
              run: go({ pathname: '/chat/[id]/changes', params: { id: chatId } }),
            },
          ]
        : []),
      {
        id: 'schedule',
        label: '/schedule',
        description: 'Create a schedule through the agent',
        kind: 'Command',
        insertion: 'Create a schedule for: ',
      },
      { id: 'settings', label: '/settings', description: 'Open app settings', kind: 'Command', run: go('/settings') },
      {
        id: 'learn',
        label: '/learn',
        description: 'Review recent threads for lessons and skills now',
        kind: 'Command',
        run: () => {
          store.invoke(computerId, 'learning.run').then(
            () => Alert.alert('Learning started', 'Ramu is reviewing recent threads on the host.'),
            (e) => Alert.alert('Could not start learning', e instanceof Error ? e.message : String(e)),
          )
        },
      },
      { id: 'clear', label: '/clear', description: 'Clear this draft', kind: 'Command', insertion: '' },
    ]
    const names = data?.names ?? {}
    const options: Choice[] =
      mode === '@'
        ? (data?.files ?? []).map((file) => ({
            id: `${file.repoId}:${file.path}`,
            label: `${names[file.repoId] ?? ''}${names[file.repoId] ? '/' : ''}${file.path}`,
            description: 'Add file context',
            kind: 'File' as const,
            insertion: `@"${names[file.repoId] ? `${names[file.repoId]}/` : ''}${file.path}" `,
            file,
          }))
        : [
            ...commands,
            ...(data?.skills ?? []).map((s): Choice => ({
              id: `skill:${s.path}`,
              label: `/${s.name}`,
              description: s.description,
              kind: 'Skill',
              insertion: `$${s.name} `,
            })),
          ]
    return options
      .filter((choice) => `${choice.label} ${choice.description}`.toLowerCase().includes(query))
      .slice(0, 30)
  }, [mode, query, data, chatId, computerId])

  return {
    visible,
    choices,
    loading,
    error,
    dismiss: () => setDismissed(signature),
    /** Replaces the typed trigger with the choice; the caller stores the result. */
    choose(choice: Choice) {
      const start = prefix.length - (trigger?.[2]?.length ?? 0) - 1
      const insertion = choice.insertion ?? ''
      choice.run?.()
      setDismissed(signature)
      return {
        text: text.slice(0, start) + insertion + text.slice(caret),
        caret: start + insertion.length,
        file: choice.file,
        insertion,
      }
    },
  }
}

export function SuggestionList({
  choices,
  loading,
  error,
  onChoose,
}: {
  choices: Choice[]
  loading: boolean
  error?: string
  onChoose: (choice: Choice) => void
}) {
  const { c } = useTheme()
  return (
    <View style={{ maxHeight: 232, borderBottomWidth: 0.5, borderBottomColor: c.lineStrong }}>
      <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="none" nestedScrollEnabled>
        {choices.map((choice) => (
          <Pressable
            key={choice.id}
            accessibilityRole="button"
            accessibilityLabel={`${choice.label}. ${choice.description}`}
            onPress={() => {
              tap()
              onChoose(choice)
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.m,
              paddingHorizontal: space.l,
              paddingVertical: 9,
              backgroundColor: pressed ? c.pressed : 'transparent',
            })}
          >
            {choice.kind === 'File' ? (
              <FileText size={15} color={c.soft} />
            ) : choice.kind === 'Skill' ? (
              <Sparkles size={15} color={c.accent} />
            ) : (
              <Command size={15} color={c.soft} />
            )}
            <View style={{ flex: 1 }}>
              <T size={font.control} weight="500" mono={choice.kind !== 'Skill'} numberOfLines={1}>
                {choice.label}
              </T>
              <T size={font.caption} tone="muted" numberOfLines={1}>
                {choice.description}
              </T>
            </View>
            <T size={font.caption} tone="placeholder">
              {choice.kind}
            </T>
          </Pressable>
        ))}
        {loading ? <ActivityIndicator style={{ padding: space.m }} color={c.accent} /> : null}
        {error ? (
          <T size={font.caption} tone="muted" style={{ padding: space.m }}>
            {error}
          </T>
        ) : null}
        {!loading && !error && !choices.length ? (
          <T size={font.caption} tone="muted" style={{ padding: space.m }}>
            Nothing matches.
          </T>
        ) : null}
      </ScrollView>
    </View>
  )
}
