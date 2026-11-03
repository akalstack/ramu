import { Button } from '@/components/desktop-button'
import { SettingsFieldContext } from './settingsField'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppPreferences, ModelPreferences } from '@ramu/shared/types'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import {
  commonSettings,
  intersectCatalogs,
  sameValue,
  settingValue,
  type SettingsSnapshot,
} from '@ramu/shared/settingsCompatibility'
import { recommendedSets } from '@ramu/shared/providers/modelDefaults'
import { invoke, invokeOn, ramu } from '../ipc'
import { isViewOnly, VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { mayUse } from '@ramu/shared/devicePermissions'
import { useComputers, statusText } from '../workspace/computers'
import { errorText } from '../lib/errors'
import { Dropdown } from '../Menu'
import { t } from '../i18n'

export type SettingsScope = ReturnType<typeof useSettingsScope>
export const SettingsScopeContext = createContext<SettingsScope | null>(null)
/** Older servers can omit newly introduced fields. Defaults are for rendering only, never capabilities. */
function renderPreferences(saved?: AppPreferences): AppPreferences {
  const merge = (defaults: unknown, value: unknown): unknown =>
    defaults &&
    typeof defaults === 'object' &&
    !Array.isArray(defaults) &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
      ? Object.fromEntries(
          [...new Set([...Object.keys(defaults), ...Object.keys(value)])].map((key) => [
            key,
            merge((defaults as Record<string, unknown>)[key], (value as Record<string, unknown>)[key]),
          ]),
        )
      : value === undefined
        ? defaults
        : value
  return merge(DEFAULT_APP_PREFERENCES, saved) as AppPreferences
}
const currentValue = (snapshot: SettingsSnapshot, path: string) =>
  snapshot.settings.find((field) => field.path === path)?.value
interface Target {
  id: string
  name: string
  snapshot?: SettingsSnapshot
  error?: string
  /** This device is paired view-only on that host, so a save there would be refused. Advisory; the host decides. */
  viewOnly?: boolean
  /** This device lacks that host's Change settings permission, so a save there would be refused. Advisory too. */
  needsPermission?: boolean
}

/** These pages configure one machine (binaries, login, service, network), so "all environments" has no meaning. */
const SINGLE_ENVIRONMENT_SECTIONS: readonly string[] = ['providers', 'environment', 'agent-setup', 'system', 'remote']
/** Remote access and archived history describe the current environment; it is not selectable. */
const CURRENT_ENVIRONMENT_SECTIONS: readonly string[] = ['remote', 'archived']
export const isSingleEnvironmentSection = (section: string) => SINGLE_ENVIRONMENT_SECTIONS.includes(section)
export const isCurrentEnvironmentSection = (section: string) => CURRENT_ENVIRONMENT_SECTIONS.includes(section)

export function useSettingsScope(section: string) {
  const computers = useComputers()
  const [requested, setTarget] = useState('all')
  const current = computers?.current ?? ''
  const target = isCurrentEnvironmentSection(section)
    ? current
    : requested === 'all' && isSingleEnvironmentSection(section)
      ? current
      : requested
  const [targets, setTargets] = useState<Target[]>([])
  const confirmedRoles = useRef(new Map<string, boolean>())
  const latestTargets = useRef(targets)
  latestTargets.current = targets
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [edited, setEdited] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const dirty = useRef(false)
  const connections = JSON.stringify(computers?.computers.map(({ id, name, status }) => ({ id, name, status })) ?? [])
  const available = computers?.computers ?? [
    { id: '', name: t('This host'), local: true, status: 'connected' as const },
  ]
  const selected = available.filter((computer) =>
    target === 'all' ? computer.status === 'connected' : computer.id === target,
  )
  const read = (id: string) => (id ? invoke('computers.settings.get', id) : invoke('settings.app.snapshot'))
  const loadedTarget = useRef<string | null>(null)
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (dirty.current && loadedTarget.current === target) return
    let active = true
    // Any reload keeps showing the current values until the new ones arrive; only the very first load shows loading.
    const refreshing = loadedTarget.current === target
    if (!loadedTarget.current || !refreshing) setLoading(true)
    else setStale(true)
    setError(null)
    setMessage(null)
    void Promise.all(
      selected.map(async ({ id, name }): Promise<Target> => {
        if (available.find((computer) => computer.id === id)?.status !== 'connected')
          return { id, name, error: t('This host is offline.') }
        try {
          const snapshot = await read(id)
          // This computer's own role is always full access; another host may have paired this device view-only.
          const viewOnly = id
            ? await invokeOn(id, 'background.status').then(
                (status) =>
                  status?.access === undefined ? (confirmedRoles.current.get(id) ?? false) : isViewOnly(status),
                () => confirmedRoles.current.get(id) ?? false,
              )
            : false
          confirmedRoles.current.set(id, viewOnly)
          const needsPermission =
            !!id &&
            !viewOnly &&
            (await invokeOn(id, 'device.permissions').then(
              (view) => !mayUse(view, 'settings', Date.now()),
              () => false,
            ))
          return {
            id,
            name,
            snapshot,
            ...(viewOnly ? { viewOnly } : {}),
            ...(needsPermission ? { needsPermission } : {}),
          }
        } catch (reason) {
          return { id, name, error: errorText(reason) }
        }
      }),
    ).then((next) => {
      if (active) {
        loadedTarget.current = target
        setStale(false)
        setTargets((previous) =>
          refreshing
            ? next.map((entry) =>
                entry.error ? (previous.find((old) => old.id === entry.id && old.snapshot) ?? entry) : entry,
              )
            : next,
        )
        setLoading(false)
        setEdited(new Set())
      }
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [target, connections, revision] by design; the values it reads beyond these are current as of that run
  }, [target, connections, revision])
  const ready =
    !loading &&
    targets.length > 0 &&
    targets.every(
      (entry) =>
        entry.snapshot && available.some((computer) => computer.id === entry.id && computer.status === 'connected'),
    ) &&
    (target !== 'all' || selected.every((computer) => targets.some((entry) => entry.id === computer.id)))
  const primary =
    targets.find((entry) => entry.id === computers?.current && entry.snapshot) ??
    targets.find((entry) => entry.snapshot)
  const preferences = renderPreferences(primary?.snapshot?.preferences)
  const snapshots = targets.flatMap((entry) => (entry.snapshot ? [entry.snapshot] : []))
  const common = ready ? commonSettings(snapshots) : []
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [])), [targets] by design; the values it reads beyond these are current as of that run
  const catalogs = useMemo(() => intersectCatalogs(snapshots.map((snapshot) => snapshot.catalogs ?? [])), [targets])
  const models = primary?.snapshot?.models ?? recommendedSets(catalogs)
  const field = (path: string) => {
    const definition = common.find((entry) => entry.path === path)
    let schema = definition?.schema
    const account = /^providerBinaries\.([^.]+)\.accountId$/.exec(path)
    // With one computer the picker's own options already include unsaved accounts; a saved-state filter would hide them.
    if (schema && account && snapshots.length > 1) {
      const options = snapshots.map((snapshot) => [
        'default',
        ...(
          (
            snapshot.preferences?.providerBinaries as
              Record<string, { accounts?: { id: string; enabled?: boolean }[] }> | undefined
          )?.[account[1]!]?.accounts ?? []
        )
          .filter((entry) => entry.enabled !== false)
          .map((entry) => entry.id),
      ])
      schema = { ...schema, enum: (options[0] ?? []).filter((id) => options.every((list) => list.includes(id))) }
    }
    return {
      schema,
      disabled: !definition || !ready || targets.some((entry) => entry.viewOnly || entry.needsPermission),
      mixed:
        !edited.has(path) &&
        snapshots.some((snapshot) => !sameValue(currentValue(snapshot, path), currentValue(primary!.snapshot!, path))),
    }
  }
  const mark = (path: string) => {
    setEdited((current) => new Set([...current, path]))
    setMessage(null)
  }
  const reload = () => {
    dirty.current = false
    setEdited(new Set())
    setRevision((current) => current + 1)
  }
  const save = async (draft: AppPreferences, modelDraft: ModelPreferences, paths: string[]) => {
    if (!ready || stale || saving) return false
    if (latestTargets.current.some((entry) => entry.viewOnly)) {
      setError(t(VIEW_ONLY_WRITE_NOTICE))
      return false
    }
    if (latestTargets.current.some((entry) => entry.needsPermission)) {
      setError(t('This device needs {0} on this host.', { 0: t('Change settings') }))
      return false
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    setEdited((current) => new Set([...current, ...paths]))
    const values = new Map(
      [...paths, ...edited].map((path) => [path, path === '$models' ? modelDraft : settingValue(draft, path)]),
    )
    const results = await Promise.all(
      targets.map(async (entry) => {
        try {
          const edits = [...values]
            .map(([path, value]) => {
              const definition = entry.snapshot!.settings.find((field) => field.path === path)
              if (!definition || !common.some((field) => field.path === path))
                throw new Error(t('Setting options changed. Reload before saving.'))
              return { path, schema: definition.schema, before: definition.value, value }
            })
            .filter((edit) => !sameValue(edit.before, edit.value))
          const snapshot = edits.length
            ? entry.id
              ? await invoke('computers.settings.patch', entry.id, edits)
              : await invoke('settings.app.patch', edits)
            : entry.snapshot!
          if (edits.some((edit) => !sameValue(currentValue(snapshot, edit.path), edit.value)))
            throw new Error(t('This host did not save every setting. Reload and check its supported options.'))
          return { ...entry, snapshot, error: undefined }
        } catch (reason) {
          return { ...entry, error: errorText(reason) }
        }
      }),
    )
    setTargets(results)
    const failed = results.filter((entry) => entry.error)
    setMessage(t('Settings saved on {0} hosts.', { 0: results.length - failed.length }))
    setError(failed.length ? failed.map((entry) => `${entry.name}: ${entry.error}`).join('\n') : null)
    if (!failed.length) {
      setEdited(new Set())
      dirty.current = false
    }
    setSaving(false)
    return !failed.length
  }
  return {
    target,
    setTarget,
    section,
    targets,
    available,
    preferences,
    models,
    catalogs,
    currentId: computers?.current ?? '',
    primaryId: primary?.id,
    /** Names of the selected hosts where this device is view-only; saving there is refused, so it is not offered. */
    readOnlyHosts: targets.filter((entry) => entry.viewOnly).map((entry) => entry.name),
    /** Selected hosts where this device may read settings but needs Change settings to save them. */
    permissionHosts: targets.filter((entry) => entry.needsPermission && entry.id).map((entry) => entry.id!),
    loading,
    stale,
    ready,
    saving,
    error,
    message,
    field,
    mark,
    edited,
    save,
    reload,
    dirty,
    setError,
    revision,
    loadKey: `${target}:${revision}:${targets.map((entry) => entry.id).join(',')}`,
  }
}

export function SettingsField({
  path,
  children,
  compact = false,
}: {
  path: string
  children: ReactNode
  compact?: boolean
}) {
  const scope = useContext(SettingsScopeContext)
  if (!scope) return <>{children}</>
  const state = scope.field(path)
  return (
    <SettingsFieldContext.Provider value={{ path, ...state, mark: () => scope.mark(path) }}>
      {!compact && state.mixed && (
        <span className="inline-flex items-center gap-2 text-caption text-muted-foreground" role="status">
          {t('Mixed')}
          <Button
            variant="link"
            size="xs"
            type="button"
            disabled={state.disabled}
            className="min-h-0 p-0 text-caption text-brand underline"
            onClick={() => scope.mark(path)}
          >
            {t('Use this value for all')}
          </Button>
        </span>
      )}
      {!compact && state.disabled && (
        <span className="text-caption text-muted-foreground">
          {t(scope.readOnlyHosts.length ? VIEW_ONLY_WRITE_NOTICE : 'Not supported by every selected host.')}
        </span>
      )}
      {compact ? (
        children
      ) : (
        <fieldset disabled={state.disabled} className="contents">
          {children}
        </fieldset>
      )}
    </SettingsFieldContext.Provider>
  )
}

export function SettingsFieldNotice({ path }: { path: string }) {
  const scope = useContext(SettingsScopeContext)
  if (!scope) return null
  const state = scope.field(path)
  return state.disabled ? (
    <span className="block mt-1 text-caption text-muted-foreground">
      {t(scope.readOnlyHosts.length ? VIEW_ONLY_WRITE_NOTICE : 'Not supported by every selected host.')}
    </span>
  ) : state.mixed ? (
    <span className="flex flex-wrap items-center gap-2 mt-1 text-caption text-muted-foreground" role="status">
      {t('Mixed')}
      <Button
        variant="link"
        size="xs"
        className="min-h-0 p-0 text-caption text-brand underline"
        type="button"
        onClick={() => scope.mark(path)}
      >
        {t('Use this value for all')}
      </Button>
    </span>
  ) : null
}

// Only the settings reads allowed by the host's viewer boundary. A method's suffix is not access evidence.
const VIEWER_SETTINGS_READS = new Set([
  'background.status',
  'settings.app.get',
  'settings.app.snapshot',
  'preferences.layers.get',
  'settings.models.get',
])

/** Machine actions use the same explicit target; bulk preference edits never run an action on an arbitrary computer. */
export function useSettingsInvoke(): typeof invoke {
  return useScopedInvoke(useContext(SettingsScopeContext))
}
/** The same routing for the settings panel itself, which owns the scope rather than reading it from context. */
export function useScopedInvoke(scope: SettingsScope | null): typeof invoke {
  const current = useRef(scope)
  current.current = scope
  const origin = scope?.primaryId
  const scoped = scope !== null
  // Forwards whatever method a settings screen calls; the typed `invoke` it returns checks the call site.
  const forward = invoke as unknown as (method: string, ...args: unknown[]) => Promise<unknown>
  return useMemo(() => {
    return (async (method: string, ...args: unknown[]) => {
      const scope = current.current
      if (method.startsWith('computers.')) return forward(method, ...args)
      if ((scope?.primaryId ?? null) !== (origin ?? null) || (scope !== null) !== scoped)
        throw new Error(t('The selected host changed. Reopen this action before continuing.'))
      if (!scope) return forward(method, ...args)
      if (!scope.ready || scope.stale) throw new Error(t('Select a connected host.'))
      const readOnly = /\.(get|list|status|history|catalog|connections)$/.test(method) || method === 'advisor.claude'
      if (scope.target === 'all' && scope.targets.length > 1 && !readOnly)
        throw new Error(t('Choose one host in the settings header for this action.'))
      const id = scope.primaryId
      if (scope.targets.find((entry) => entry.id === id)?.viewOnly && !VIEWER_SETTINGS_READS.has(method))
        throw new Error(t(VIEW_ONLY_WRITE_NOTICE))
      return id ? invoke('computers.settings.invoke', id, method, args) : forward(method, ...args)
    }) as typeof invoke
    // eslint-disable-next-line react-hooks/exhaustive-deps -- route identity invalidates host-bound loads; retained callbacks read live access above.
  }, [origin, scoped, scope?.target, scope?.ready, scope?.stale, scope?.revision, scope?.targets])
}

const NO_SETTINGS_EVENTS: typeof ramu.on = () => () => {}

export function useSettingsEvents(): typeof ramu.on {
  const scope = useContext(SettingsScopeContext)
  const computers = useComputers()
  return scope?.primaryId && scope.primaryId !== computers?.current ? NO_SETTINGS_EVENTS : ramu.on
}

export function SettingsTargetSelector({ disabled }: { disabled: boolean }) {
  const scope = useContext(SettingsScopeContext)
  if (!scope) return null
  if (isCurrentEnvironmentSection(scope.section)) return null
  const options = [
    ...(isSingleEnvironmentSection(scope.section) ? [] : [{ value: 'all', label: t('All hosts') }]),
    ...scope.available.map((computer) => ({
      value: computer.id,
      label: `${computer.name}${computer.status !== 'connected' ? ` · ${statusText(computer.status)}` : ''}`,
    })),
  ]
  return (
    <div className="flex flex-none items-center gap-2 text-control">
      <span className="whitespace-nowrap text-muted-foreground">{t('Apply settings to')}</span>
      <Dropdown
        label={t('Settings environment')}
        value={scope.target}
        options={options}
        onChange={scope.setTarget}
        disabled={disabled || scope.saving}
        className="min-w-[180px] max-w-[260px]"
      />
    </div>
  )
}
