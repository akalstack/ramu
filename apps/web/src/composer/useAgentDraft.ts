import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NO_PROJECT, type AgentSettings } from '@ramu/shared/types'
import {
  agentSettingsForDraft,
  editAgentDraft,
  modelChoice,
  type AgentDraftChoice,
} from '@ramu/shared/workspace/agentDefaults'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { draftStore } from './drafts'
import { clearAgentDraft, loadAgentDraft, saveAgentDraft, type StoredAgentDraft } from './agentDraft'
import { t } from '../i18n'

/** Device-owned explicit choices sit above live repository and host defaults. */
export function useAgentDraft(project: string, base: AgentSettings) {
  const host = useHost()
  const runtime = useHostRuntime()
  const queryClient = useQueryClient()
  const scope = JSON.stringify([host.id, project])
  const restore = (): StoredAgentDraft & { key: string; confirmed?: boolean } => ({
    key: scope,
    ...loadAgentDraft(project, draftStore(host.id)),
  })
  const [state, setState] = useState<StoredAgentDraft & { key: string; confirmed?: boolean }>(restore)
  const current = state.key === scope ? state : restore()
  useEffect(() => {
    setState({ key: scope, ...loadAgentDraft(project, draftStore(host.id)) })
  }, [scope, host.id, project])
  const choice = current.choice
  const general = project === NO_PROJECT
  const query = useQuery({
    queryKey: ['project-agent-defaults', host.id, project, base.provider],
    enabled: !general,
    retry: false,
    queryFn: () => host.invoke('tasks.agentDefaults', project, base.provider),
  })
  const settings = agentSettingsForDraft(base, general ? undefined : query.data, choice)
  const fingerprint = JSON.stringify([scope, base, choice, query.data?.status, modelChoice(settings)])
  const active = useRef(fingerprint)
  active.current = fingerprint
  const sourceRevision = useRef({ value: 0 }).current
  useEffect(() => {
    ++sourceRevision.value
    const refresh = () => {
      ++sourceRevision.value
      void queryClient.invalidateQueries({ queryKey: ['project-agent-defaults', host.id, project] })
    }
    const offWorkspace = runtime.on('workspace:changed', refresh)
    const offSettings = runtime.on('settings:changed', refresh)
    return () => {
      ++sourceRevision.value
      offWorkspace()
      offSettings()
    }
  }, [runtime, host.id, host.status, project, queryClient, sourceRevision])
  const choose = (next: AgentDraftChoice) => {
    if (active.current !== fingerprint) return
    const saved = saveAgentDraft(project, next, draftStore(host.id))
    setState({
      key: scope,
      choice: next,
      confirmed: true,
      ...(saved
        ? { serialized: loadAgentDraft(project, draftStore(host.id)).serialized }
        : { problem: 'storage' as const }),
    })
  }
  const confirmed = current.confirmed || !current.problem
  const blocked =
    !confirmed ||
    (!choice.selection &&
      !general &&
      (!query.data || query.data.status === 'unavailable' || query.data.status === 'invalid' || !!query.error))
  const verify = async () => {
    if (blocked) throw new Error(t('Choose a model or use the host default before starting.'))
    if (choice.selection || general) return settings
    const revision = sourceRevision.value
    const latest = await host.invoke('tasks.agentDefaults', project, base.provider)
    if (active.current !== fingerprint || revision !== sourceRevision.value)
      throw new Error(t('The draft changed. Review the model before sending.'))
    queryClient.setQueryData(['project-agent-defaults', host.id, project, base.provider], latest)
    const next = agentSettingsForDraft(base, latest, choice)
    if (
      latest.status === 'unavailable' ||
      latest.status === 'invalid' ||
      JSON.stringify(modelChoice(next)) !== JSON.stringify(modelChoice(settings))
    )
      throw new Error(t('Project model defaults changed. Review the model before sending.'))
    return next
  }
  return {
    settings,
    choice,
    problem: current.problem,
    confirmed,
    blocked,
    defaults: query.data,
    error: query.error,
    loading: !general && !query.data && !query.error,
    change: (next: AgentSettings) => {
      const edited = editAgentDraft(choice, settings, next)
      if (!confirmed && !edited.selection) return
      choose(edited)
    },
    useHostDefault: () => choose({ ...choice, selection: modelChoice(base) }),
    useProjectDefault: () => {
      const { selection: _selection, ...next } = choice
      choose(next)
    },
    retry: () =>
      confirmed ? choose(choice) : setState({ key: scope, ...loadAgentDraft(project, draftStore(host.id)) }),
    verify,
    consume: () => !current.problem && clearAgentDraft(project, choice, draftStore(host.id), current.serialized),
  }
}
