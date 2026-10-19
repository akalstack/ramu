import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSettings } from '@ramu/shared/types'
import {
  agentSettingsForDraft,
  editAgentDraft,
  modelChoice,
  parseAgentDraft,
  type AgentDraftChoice,
  type ProjectAgentDefaults,
} from '@ramu/shared/workspace/agentDefaults'
import { useStore } from './store'
import { isMethodMissing } from './goalVerify'
import { useT } from '../i18n'

/** Active model intent stays device/host/scope qualified; queued settings are frozen by createChat. */
export function useAgentDraft(
  host: string,
  project: string | null,
  draftKey: string,
  base: AgentSettings,
  baselineAvailable = true,
) {
  const store = useStore()
  const t = useT()
  const runtime = useRef({ store, t })
  runtime.current = { store, t }
  const general = !project || project === 'no-project'
  const key = JSON.stringify([host, project, base.provider])
  const storedKey = `${draftKey}:agent`
  const raw = store.drafts[storedKey]
  let choice: AgentDraftChoice | null = { version: 1 }
  try {
    if (raw) choice = parseAgentDraft(JSON.parse(raw))
  } catch {
    choice = null
  }
  const invalid = !choice
  choice ??= { version: 1 }
  // Results stay keyed by host/project/provider so switching back reuses the last known default.
  const [entries, setEntries] = useState<
    Record<string, { value?: ProjectAgentDefaults; error?: string; unsupported?: boolean }>
  >({})
  const current = entries[key] ?? {}
  const setData = useCallback(
    (entryKey: string, entry: (typeof entries)[string]) =>
      setEntries((previous) => ({ ...previous, [entryKey]: entry })),
    [setEntries],
  )
  const settings = agentSettingsForDraft(base, current.unsupported ? undefined : current.value, choice)
  const fingerprint = JSON.stringify([key, storedKey, base, baselineAvailable, choice])
  const active = useRef(fingerprint)
  active.current = fingerprint
  const scope = useRef(key)
  scope.current = key
  const lifecycle = useRef({ version: 0, sequence: 0 }).current
  const online = store.isOnline(host)
  const read = useCallback(
    async (version: number) => {
      if (
        scope.current !== key ||
        version !== lifecycle.version ||
        !project ||
        general ||
        !runtime.current.store.isOnline(host)
      )
        return
      const request = ++lifecycle.sequence
      try {
        const value = await runtime.current.store.invoke(
          host,
          'tasks.agentDefaults',
          project.slice(project.indexOf(':') + 1),
          base.provider,
        )
        if (version === lifecycle.version && scope.current === key && request === lifecycle.sequence)
          setData(key, { value })
      } catch (error) {
        if (version === lifecycle.version && scope.current === key && request === lifecycle.sequence)
          setEntries((previous) => ({
            ...previous,
            [key]: {
              ...previous[key],
              error: error instanceof Error ? error.message : String(error),
              unsupported: isMethodMissing(error),
            },
          }))
      }
    },
    [key, host, project, general, base.provider, lifecycle, setData],
  )
  useEffect(() => {
    const version = ++lifecycle.version
    if (general || !online) return
    void read(version)
    const off = runtime.current.store.subscribe(host, (channel) => {
      if (channel === 'workspace:changed' || channel === 'settings:changed') void read(version)
    })
    return () => {
      ++lifecycle.version
      off()
    }
  }, [host, general, online, read, lifecycle])
  const blocked =
    invalid ||
    (!baselineAvailable && !choice.behavior) ||
    (!choice.selection &&
      (!baselineAvailable ||
        (!general &&
          !current.unsupported &&
          (!current.value ||
            current.value.status === 'unavailable' ||
            current.value.status === 'invalid' ||
            !!current.error))))
  const choose = (next: AgentDraftChoice) => {
    if (active.current !== fingerprint) return
    if (!parseAgentDraft(next)) throw new Error(t.projectModelInvalid)
    store.setDraft(storedKey, JSON.stringify({ ...next, at: Date.now() }))
  }
  const verify = async () => {
    if (blocked) throw new Error(t.projectModelChoose)
    if (choice.selection || general || current.unsupported || !online) return settings
    const version = lifecycle.version
    const request = ++lifecycle.sequence
    const value = await store.invoke(
      host,
      'tasks.agentDefaults',
      project!.slice(project!.indexOf(':') + 1),
      base.provider,
    )
    if (active.current !== fingerprint || version !== lifecycle.version || request !== lifecycle.sequence)
      throw new Error(t.projectModelChanged)
    setData(key, { value })
    const next = agentSettingsForDraft(base, value, choice)
    if (
      value.status === 'unavailable' ||
      value.status === 'invalid' ||
      JSON.stringify(modelChoice(next)) !== JSON.stringify(modelChoice(settings))
    )
      throw new Error(t.projectModelChanged)
    return next
  }
  return {
    settings,
    choice,
    invalid,
    defaults: current.value,
    error: current.error,
    unsupported: current.unsupported,
    blocked,
    loading: !general && !current.value && !current.error,
    change: (next: AgentSettings) => {
      const edited = editAgentDraft(choice, settings, next)
      if (invalid && !edited.selection) return
      choose(edited)
    },
    useHostDefault: () => {
      if (baselineAvailable) choose({ ...choice, selection: modelChoice(base) })
    },
    useProjectDefault: () => {
      const { selection: _selection, ...next } = choice
      choose(next)
    },
    verify,
    consume: () => {
      const latest = runtime.current.store
      if (raw && latest.drafts[storedKey] === raw) latest.setDraft(storedKey, '')
    },
  }
}
