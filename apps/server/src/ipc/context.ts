import { join } from 'node:path'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { AppPreferences, FileContext, UsageReading } from '@ramu/shared/types'
import { providerEnabled } from '@ramu/shared/providers'
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
import { ExtraUsageReader, readAntigravityUsage, readCursorUsage } from '../providers/providerUsage'
import { AccountUsage } from '../providers/accountUsage'
import { codexUsage } from '../providers/codex'
import type { Workspace } from '../workspace/workspace'
import { KeyedLock } from './keyedLock'
import { FileWatchers } from './watchers'
import { appPreferences } from './preferences'
import type { HandlerContext, RuntimeHost, Services } from './types'

/** Builds the services and helpers every handler group shares, and wires them into the agent service. */
export function createHandlerContext(host: RuntimeHost, services: Services): HandlerContext {
  const { workspace, agents, recaps, memory, learning } = services
  const hostFolders = new HostFolders(() => workspace.listProjects().flatMap((p) => (p.root ? [p.root] : [])))
  const activity = new ActivityService((items) => host.send('activity:changed', items))
  configureProviderAccounts(join(host.userData, 'provider-accounts'))
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
      return {
        cursor: providerEnabled(config, 'cursor'),
        antigravity: providerEnabled(config, 'antigravity'),
        keychain: !!config.cursor?.usageKeychain,
      }
    },
  )
  // Every login's usage, for providers where "use all accounts" is on. Read on demand, never on a timer.
  const accountUsage = new AccountUsage(
    (readings) => usage.update(readings),
    () => loadPreferences().providerBinaries,
    {
      'claude-code': (account) => (agents ? agents.claudeAccountUsage(account) : Promise.resolve([])),
      codex: (account) => codexUsage(account),
      cursor: (account) =>
        readCursorUsage(
          !!loadPreferences().providerBinaries.cursor?.usageKeychain,
          providerEnvironment('cursor', loadPreferences().providerBinaries, account),
        ),
      antigravity: (account) =>
        readAntigravityUsage(providerEnvironment('antigravity', loadPreferences().providerBinaries, account)),
    },
  )
  const loadPreferences = (): AppPreferences => {
    const saved = storedPreferences()
    return appPreferences.parse({
      ...DEFAULT_APP_PREFERENCES,
      ...saved,
      ...(saved.messageBehaviorVersion === 4 ? {} : { busyMessageAction: 'steer', messageBehaviorVersion: 4 }),
    })
  }
  const savePreferences = (preferences: AppPreferences) => {
    workspace.setAppState('app-preferences', preferences)
    host.send('settings:changed', preferences)
    recaps.settingsChanged()
    providers.settingsChanged()
    awake.settingsChanged()
    host.send('usage:changed', usage.list())
    updates.settingsChanged()
    agents.invalidateCatalog()
    agents.goalsSettingsChanged()
    memory?.settingsChanged()
    learning?.settingsChanged()
  }

  // Archived chats unused for `cleanupArchivedDays` are deleted (worktrees and branches are kept); 0 turns it off.
  const cleanupArchived = async () => {
    const days = loadPreferences().cleanupArchivedDays
    if (!days) return
    const cutoff = Date.now() - days * 86_400_000
    const tasks = workspace.listTasks().filter((task) => task.status === 'archived' && task.lastActiveAt < cutoff)
    if (!tasks.length) return
    await activity.run('Cleaning up archived chats', undefined, async () => {
      for (const task of tasks) {
        try {
          await workspace.deleteTask(task.id, false)
        } catch {
          /* Retried on the next pass. */
        }
      }
    })
  }
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
    loadPreferences,
    savePreferences,
    storedPreferences,
    managedSkills,
    withContext,
    cwdOf: (taskId, repoId) => workspace.getBinding(taskId, repoId).cwd,
    gitCwdOf: (taskId, repoId) => {
      const binding = workspace.getBinding(taskId, repoId)
      if (binding.folderOnly) throw new Error('Chat files are not a Git repository')
      return binding.cwd
    },
  }
}
