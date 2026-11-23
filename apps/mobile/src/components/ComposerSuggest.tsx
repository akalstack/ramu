import { useSay } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { DraftMention } from '@ramu/shared/chat/composerDraft'
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Command, FileText, Sparkles, Users } from 'lucide-react-native'
import type { AgentModel, SkillInfo } from '@ramu/shared/types'
import { customAgentHandle, type CustomAgent } from '@ramu/shared/customAgents'
import { modelHandle, type AbilityModels } from '@ramu/shared/chat/helperMentions'
import { providerName } from '@ramu/shared/providers/providers'
import { acceptComposerTrigger, composerTrigger } from '@ramu/shared/chat/composerTrigger'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { T, tap } from './ui'

export interface Choice {
  id: string
  label: string
  description: string
  kind: 'Command' | 'Skill' | 'File' | 'Model' | 'Agent'
  insertion?: string
  file?: { repoId: string; path: string }
  run?: () => void
}
/**
 * Who `@` at the start of a message can name: models, custom agents and abilities. The message still goes to the main
 * agent, which hands it to a helper of that kind.
 */
export interface ComposerMentions {
  models: AgentModel[]
  agents: CustomAgent[]
  /** The model each `@ability` handle starts a helper on here. */
  abilities?: AbilityModels
  /** Who a message can start with, so `@sonnet-5.5` draws as that model rather than a file. */
  mentions?: DraftMention[]
}
interface Loaded {
  computerId: string
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
  mentions,
}: {
  computerId: string
  scope?: string
  chatId?: string
  text: string
  caret: number
  mentions?: ComposerMentions
}) {
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const trigger = composerTrigger(text, caret)
  const mode = trigger?.mode
  const query = (trigger?.query ?? '').toLowerCase()
  const signature = `${caret}:${mode}:${query}`
  const visible = Boolean(mode) && dismissed !== signature
  const online = store.isOnline(computerId)
  useEffect(() => {
    setDismissed(null)
  }, [mode, query])
  useEffect(() => {
    if (!visible || !scope || (loaded?.scope === scope && loaded.computerId === computerId)) return
    if (!online) {
      setError(say('Reconnect this host to browse its files and skills.'))
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
            setLoaded({
              computerId,
              scope,
              files,
              skills,
              names: Object.fromEntries(bindings.map((b) => [b.repoId, b.repoName])),
            })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [visible, scope, online, computerId] by design; the values it reads beyond these are current as of that run
  }, [visible, scope, online, computerId])
  const data = loaded && loaded.scope === scope && loaded.computerId === computerId ? loaded : undefined

  const choices = useMemo<Choice[]>(() => {
    if (!mode) return []
    const go = (to: Parameters<typeof router.push>[0]) => () => router.push(to)
    // Only a message that starts with the mention goes to a helper, so they are offered only there.
    const helpers: Choice[] = [
      ...(mentions?.agents ?? []).map((agent) => ({
        id: `agent:${agent.id}`,
        label: `@${customAgentHandle(agent.name)}`,
        description: agent.description || say('Custom agent'),
        kind: 'Agent' as const,
        insertion: `@${customAgentHandle(agent.name)} `,
      })),
      ...(Object.entries(mentions?.abilities ?? {}) as [string, AgentModel][]).map(([handle, model]) => ({
        id: `ability:${handle}`,
        label: `@${handle}`,
        description: `${model.name || model.id} · ${providerName(model.provider)}`,
        kind: 'Model' as const,
        insertion: `@${handle} `,
      })),
      ...(mentions?.models ?? [])
        .filter((model) => !model.isLegacy)
        .map((model) => ({
          id: `model:${model.provider}:${model.id}`,
          label: `@${modelHandle(model)}`,
          description: `${model.name || model.id} · ${providerName(model.provider)}`,
          kind: 'Model' as const,
          insertion: `@${modelHandle(model)} `,
        })),
    ]
    const commands: Choice[] = [
      { id: 'new', label: '/new', description: say('Start a new thread'), kind: 'Command', run: go('/new') },
      {
        id: 'goal',
        label: '/goal',
        description: say('Keep working until a goal is complete'),
        kind: 'Command',
        insertion: '/goal ',
      },
      ...(chatId
        ? [
            {
              id: 'goal-pause',
              label: '/goal pause',
              description: say('Pause goal'),
              kind: 'Command' as const,
              insertion: '/goal pause',
            },
            {
              id: 'goal-resume',
              label: '/goal resume',
              description: say('Resume goal'),
              kind: 'Command' as const,
              insertion: '/goal resume',
            },
            {
              id: 'goal-clear',
              label: '/goal clear',
              description: say('Clear goal'),
              kind: 'Command' as const,
              insertion: '/goal clear',
            },
            {
              id: 'mcp',
              label: '/mcp',
              description: say('Show MCP servers and skills'),
              kind: 'Command' as const,
              run: go({ pathname: '/settings/[section]', params: { section: 'agent-setup' } }),
            },
            {
              id: 'aside',
              label: '/aside',
              description: say('Ask a side question without interrupting the thread'),
              kind: 'Command' as const,
              insertion: '/aside ',
            },
            {
              id: 'btw',
              label: '/btw',
              description: say('Same as /aside: ask without interrupting the thread'),
              kind: 'Command' as const,
              insertion: '/btw ',
            },
            {
              id: 'changes',
              label: '/changes',
              description: say('Open the thread’s changed files'),
              kind: 'Command' as const,
              run: go({ pathname: '/chat/[id]/changes', params: { id: chatId } }),
            },
          ]
        : []),
      {
        id: 'schedule',
        label: '/schedule',
        description: say('Create a schedule through the agent'),
        kind: 'Command',
        insertion: say('Create a schedule for: '),
      },
      {
        id: 'schedules',
        label: '/schedules',
        description: say('Open schedules and run history'),
        kind: 'Command',
        run: go('/schedules'),
      },
      {
        id: 'recap',
        label: '/recap',
        description: say('Open your daily recap'),
        kind: 'Command',
        run: go('/(tabs)/inbox'),
      },
      {
        id: 'settings',
        label: '/settings',
        description: say('Open app settings'),
        kind: 'Command',
        run: go('/settings'),
      },
      ...(store.appPreferences[computerId]?.memory.enabled === false
        ? []
        : [
            {
              id: 'remember',
              label: '/remember',
              description: say('Save something to shared memory'),
              kind: 'Command' as const,
              insertion: say('Remember this for future threads: '),
            },
            {
              id: 'forget',
              label: '/forget',
              description: say('Ask the agent to forget a memory'),
              kind: 'Command' as const,
              insertion: say('Forget this memory: '),
            },
            {
              id: 'memory',
              label: '/memory',
              description: say('Open saved memories'),
              kind: 'Command' as const,
              run: go({ pathname: '/settings/[section]', params: { section: 'memory' } }),
            },
          ]),
      {
        id: 'learn',
        label: '/learn',
        description: say('Review recent threads for lessons and skills now'),
        kind: 'Command',
        run: () => {
          store.invoke(computerId, 'learning.run').then(
            () => Alert.alert(say('Learning started'), say('Ramu is reviewing recent threads on the host.')),
            (e) => Alert.alert(say('Could not start learning'), e instanceof Error ? e.message : String(e)),
          )
        },
      },
      { id: 'clear', label: '/clear', description: say('Clear this draft'), kind: 'Command', insertion: '' },
    ]
    const names = data?.names ?? {}
    const options: Choice[] =
      mode === '@'
        ? [
            ...(trigger?.start === 0 ? helpers : []),
            ...(data?.files ?? []).map((file) => ({
              id: `${file.repoId}:${file.path}`,
              label: `${names[file.repoId] ?? ''}${names[file.repoId] ? '/' : ''}${file.path}`,
              description: say('Add file context'),
              kind: 'File' as const,
              insertion: `@"${names[file.repoId] ? `${names[file.repoId]}/` : ''}${file.path}" `,
              file,
            })),
          ]
        : [
            ...(mode === '/' ? commands : []),
            ...(data?.skills ?? []).map((s): Choice => ({
              id: `skill:${s.path}`,
              label: `${mode}${s.name}`,
              description: s.description,
              kind: 'Skill',
              insertion: `$${s.name} `,
            })),
          ]
    return options
      .filter((choice) => `${choice.label} ${choice.description}`.toLowerCase().includes(query))
      .slice(0, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [mode, query, data, chatId, computerId, mentions, trigger start, language] by design; the values it reads beyond these are current as of that run
  }, [mode, query, data, chatId, computerId, mentions, trigger?.start, store.language])

  return {
    // `$` is ordinary text unless a skill matches, so it never shows an empty picker.
    visible: visible && !(mode === '$' && !loading && choices.length === 0),
    choices,
    loading,
    error,
    dismiss: () => setDismissed(signature),
    /** Replaces the typed trigger with the choice; the caller stores the result. */
    choose(choice: Choice) {
      const insertion = choice.insertion ?? ''
      choice.run?.()
      setDismissed(signature)
      const next = trigger ? acceptComposerTrigger(text, caret, trigger, insertion) : { value: text, caret }
      return {
        text: next.value,
        caret: next.caret,
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
  const say = useSay()
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
            ) : choice.kind === 'Model' || choice.kind === 'Agent' ? (
              <Users size={15} color={c.accent} />
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
              {say(choice.kind)}
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
            {say('Nothing matches.')}
          </T>
        ) : null}
      </ScrollView>
    </View>
  )
}
