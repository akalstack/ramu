import { join } from 'node:path'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { AppPreferences, FileContext, UsageReading, ModelPreferences } from '@ramu/shared/types'
import { providerEnabled } from '@ramu/shared/providers/providers'
import { withContext as withFileContext } from '../context'
import { HostFolders } from '../remote/hostFolders'
import { ActivityService } from '../background/activity'
import { ProviderService } from '../providers/providers'
import { KeepAwakeService } from '../background/keepAwake'
import { AttachmentStore } from '../attachments'
import { AppUpdateService } from '../background/appUpdates'
import { runtimeVersion } from '../build'
import { configureProviderAccounts, providerEnvironment } from '../providers/providerBinaries'
import { UsageService } from '../providers/usage'
import { ProviderEnvironmentStore } from '../providers/environmentStore'
import { ForgeAccountStore } from '../workspace/forgeAccounts'
import { configureForgeAccounts } from '../workspace/forge'
import { ExtraUsageReader, readAntigravityUsage, readCursorUsage } from '../providers/providerUsage'
import { ACCOUNT_USAGE_INTERVAL_MS, AccountUsage } from '../providers/accountUsage'
import { codexUsage } from '../providers/codex'
import type { Workspace } from '../workspace/workspace'
import { KeyedLock } from './keyedLock'
import { FileWatchers } from './watchers'
import { appPreferences } from './preferences'
import type { HandlerContext, RuntimeHost, Services } from './types'

/** Builds the services and helpers every handler group shares, and wires them into the agent service. */
export function createHandlerContext(host: RuntimeHost, services: Services): HandlerContext {
  const { workspace, agents, recaps, memory, learning, terminals } = services
  const hostFolders = new HostFolders(() => workspace.listProjects().flatMap((p) => (p.root ? [p.root] : [])))
  const activity = new ActivityService((items) => host.send('activity:changed', items))
  configureProviderAccounts(join(host.userData, 'provider-accounts'))
  const environment = new ProviderEnvironmentStore(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
  )
  // Loaded before threads resume; a locked credential store is reported in Settings and retried there.
  void environment.load().catch(() => {})
  const forgeAccounts = new ForgeAccountStore(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
    undefined,
    undefined,
    undefined,
    ({ removedId, disabledId }) => {
      const id = removedId ?? disabledId
      if (id) services.pullRequestWatches?.stopForConnection(id)
    },
  )
  configureForgeAccounts(forgeAccounts)
  const storedPreferences = () => workspace.getAppState<Partial<AppPreferences>>('app-preferences', {})
  const managedSkills = (taskId: string) => learning?.catalog(workspace.projectIdOf(taskId)) ?? []
  const withContext = (ws: Workspace, taskId: string, prompt: string, context?: FileContext[]) =>
    withFileContext(ws, taskId, prompt, context, managedSkills(taskId))
  const providers = new ProviderService(
    () => ({ ...DEFAULT_APP_PREFERENCES, ...storedPreferences() }),
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
    (statuses) => host.send('providers:updates', statuses),
    activity,
  )
  const awake = new KeepAwakeService(
    () => storedPreferences().keepAwake ?? false,
    () => storedPreferences().keepAwakeWhen ?? 'plugged-in',
  )
  const attachmentStore = new AttachmentStore(join(host.userData, 'attachments'))
  const updates = new AppUpdateService(
    host.userData,
    runtimeVersion(process.argv[1] ?? ''),
    () => ({ ...DEFAULT_APP_PREFERENCES, ...storedPreferences() }),
    (state) => host.send('updates:changed', state),
  )
  const usage = new UsageService(
    () => workspace.getAppState<UsageReading[]>('usage-limits', []),
    (readings) => workspace.setAppState('usage-limits', readings),
    (readings) => host.send('usage:changed', readings),
  )
  const extraUsage = new ExtraUsageReader(
    (readings) => usage.update(readings),
    () => {
      const config = loadPreferences().providerBinaries
      return { cursor: providerEnabled(config, 'cursor') }
    },
  )
  // Read every enabled login on demand and on a timer; Codex and Antigravity also need reads with only one login.
  const accountUsage = new AccountUsage(
    (readings) => usage.update(readings),
    () => loadPreferences().providerBinaries,
    {
      'claude-code': (account) => (agents ? agents.claudeAccountUsage(account) : Promise.resolve([])),
      codex: (account) => codexUsage(account),
      cursor: (account) => readCursorUsage(providerEnvironment('cursor', loadPreferences().providerBinaries, account)),
      antigravity: (account) =>
        readAntigravityUsage(providerEnvironment('antigravity', loadPreferences().providerBinaries, account)),
    },
    ['codex', 'antigravity'],
  )
  const loadPreferences = (): AppPreferences => {
    const saved = storedPreferences()
    return appPreferences.parse({
      ...DEFAULT_APP_PREFERENCES,
      ...saved,
      ...(saved.messageBehaviorVersion === 4 ? {} : { busyMessageAction: 'steer', messageBehaviorVersion: 4 }),
    })
  }
  const savePreferences = (preferences: AppPreferences, models?: ModelPreferences) => {
    if (workspace.settingsStore) workspace.settingsStore.set(preferences, models)
    else {
      workspace.setAppState('app-preferences', preferences)
      if (models) workspace.setAppState('model-preferences', models)
    }
    if (models) host.send('settings:models', models)
    preferencesChanged(preferences)
  }
  let catalogConfiguration = JSON.stringify(loadPreferences().providerBinaries)
  const preferencesChanged = (preferences: AppPreferences) => {
    const nextConfiguration = JSON.stringify(preferences.providerBinaries)
    const catalogChanged = nextConfiguration !== catalogConfiguration
    catalogConfiguration = nextConfiguration
    host.send('settings:changed', preferences)
    recaps.settingsChanged()
    providers.settingsChanged()
    awake.settingsChanged()
    host.send('usage:changed', usage.list())
    updates.settingsChanged()
    // Ordinary preference saves must not launch provider discovery for the returned settings snapshot.
    if (catalogChanged) agents.invalidateCatalog()
    agents.goalsSettingsChanged()
    memory?.settingsChanged()
    learning?.settingsChanged()
  }
  workspace.settingsStore?.subscribe(() => {
    preferencesChanged(loadPreferences())
    host.send('settings:models', workspace.settingsStore!.models())
  })

  // Archived chats unused for `cleanupArchivedDays` are deleted (worktrees and branches are kept); 0 turns it off.
  const cleanupArchived = async () => {
    const days = loadPreferences().cleanupArchivedDays
    if (!days) return
    const cutoff = Date.now() - days * 86_400_000
    const tasks = workspace.listTasks().filter((task) => task.status === 'archived' && task.lastActiveAt < cutoff)
    if (!tasks.length) return
    await activity.run('Cleaning up archived threads', undefined, async () => {
      for (const task of tasks) {
        try {
          // Deliberately persistent commands outlive a turn/archive. Cleanup cannot silently remove their owner.
          if (
            terminals
              .listBackground(task.id)
              .some((command) => ['running', 'stopping', 'unknown'].includes(command.state))
          )
            continue
          terminals.closeTask(task.id)
          await workspace.deleteTask(task.id, false)
        } catch {
          /* Retried on the next pass. */
        }
      }
    })
  }
  // Plan usage only arrives while a provider runs, so poll it too; each read is throttled per login.
  const refreshUsage = () =>
    void Promise.allSettled([agents?.readClaudeUsage(), extraUsage.refresh(), accountUsage.refresh()])
  setTimeout(refreshUsage, 15_000).unref()
  setInterval(refreshUsage, ACCOUNT_USAGE_INTERVAL_MS).unref()
  setTimeout(() => void cleanupArchived(), 30_000).unref()
  setInterval(() => void cleanupArchived(), 6 * 3_600_000).unref()
  if (agents) {
    agents.isolationRoot = join(host.userData, 'subagent-worktrees')
    agents.usage = usage
    agents.preferences = loadPreferences
    agents.refreshAccountUsage = (provider) => accountUsage.refresh(provider)
    agents.onContext = (sessionId, context) => host.send('context:changed', { sessionId, context })
  }

  return {
    ...services,
    host,
    lock: new KeyedLock(),
    watchers: new FileWatchers((channel, payload) => host.send(channel, payload)),
    hostFolders,
    activity,
    providers,
    awake,
    attachmentStore,
    updates,
    usage,
    extraUsage,
    accountUsage,
    environment,
    forgeAccounts,
    loadPreferences,
    savePreferences,
    storedPreferences,
    managedSkills,
    withContext,
    cwdOf: (taskId, repoId) => workspace.getBinding(taskId, repoId).cwd,
    gitCwdOf: (taskId, repoId) => {
      const binding = workspace.getBinding(taskId, repoId)
      if (binding.folderOnly) throw new Error('Thread files are not a Git repository')
      return binding.cwd
    },
  }
}
