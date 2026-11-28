import { dirname, join } from 'node:path'
import { forgeChoiceOf } from '@ramu/shared/identities'
import { fileURLToPath } from 'node:url'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { AgentProvider, AppPreferences, FileContext, UsageReading, ModelPreferences } from '@ramu/shared/types'
import { providerAccountRows } from '@ramu/shared/providers/providers'
import { withContext as withFileContext } from '../context'
import { HostFolders } from '../remote/hostFolders'
import { ActivityService } from '../background/activity'
import { ProviderService } from '../providers/providers'
import { KeepAwakeService } from '../background/keepAwake'
import { AttachmentStore } from '../attachments'
import { AppUpdateService } from '../background/appUpdates'
import { HostUpdater, isSupervised, npmPackage, runCommand, sourceCheckout } from '../background/hostUpdate'
import { ModelNews } from '../providers/modelNews'
import { ModelSignalSource } from '../providers/modelSignals'
import { runtimeVersion } from '../build'
import { configureProviderAccounts } from '../providers/providerBinaries'
import { UsageService } from '../providers/usage'
import { ProviderEnvironmentStore } from '../providers/environmentStore'
import { ProviderApiKeyStore } from '../providers/apiKeyStore'
import { ForgeAccountStore } from '../workspace/forgeAccounts'
import { BitbucketCredentials, configureBitbucketCredentials } from '../workspace/forge/bitbucketCredentials'
import { AzureCredentials, configureAzureCredentials } from '../workspace/forge/azureCredentials'
import { GitlabCredentials, configureGitlabCredentials } from '../workspace/forge/gitlabCredentials'
import { configureForgeAccounts } from '../workspace/forge'
import { ACCOUNT_USAGE_INTERVAL_MS, AccountUsage } from '../providers/accountUsage'
import { onAcpPlanChange } from '../providers/acp'
import { codexUsage } from '../providers/codex'
import type { Workspace } from '../workspace/workspace'
import { KeyedLock } from './keyedLock'
import { FileWatchers } from './watchers'
import { appPreferences } from './preferences'
import type { HandlerContext, RuntimeHost, Services } from './types'

/** Builds the services and helpers every handler group shares, and wires them into the agent service. */
export function createHandlerContext(host: RuntimeHost, services: Services): HandlerContext {
  const { workspace, agents, memory, learning, terminals } = services
  const hostFolders = new HostFolders(() => workspace.listProjects().flatMap((p) => (p.root ? [p.root] : [])))
  const activity = new ActivityService((items) => host.send('activity:changed', items))
  configureProviderAccounts(join(host.userData, 'provider-accounts'))
  const environment = new ProviderEnvironmentStore(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
  )
  // Loaded before threads resume; a locked credential store is reported in Settings and retried there.
  void environment.load().catch(() => {})
  const apiKeys = new ProviderApiKeyStore(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
  )
  // Like the environment above: a locked credential store is reported where the keys are managed, not at startup.
  void apiKeys.load().catch(() => {})
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
  const identities = services.identities
  if (identities) {
    forgeAccounts.identityChoice = (origin, owner, repo) =>
      owner && repo ? identities.forgeChoice(origin, owner, repo) : null
    // Tokens of GitHub connections put in an identity, by project, for the environment of that project's processes.
    const refreshTokens = async () => {
      const tokens = new Map<string, string>()
      for (const project of identities.projects()) {
        const own = identities.ownAccount(project.projectId, 'forge:github:any')
        const choice = own ? forgeChoiceOf(own) : null
        if (!choice || choice.startsWith('cli')) continue
        const token = await forgeAccounts.tokenFor(choice).catch(() => null)
        if (token) tokens.set(project.projectId, token)
      }
      identities.setForgeTokens(tokens)
    }
    void refreshTokens()
    setInterval(() => void refreshTokens(), 60_000).unref()
  }
  configureForgeAccounts(forgeAccounts)
  const bitbucket = new BitbucketCredentials(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
  )
  configureBitbucketCredentials(bitbucket)
  const azure = new AzureCredentials(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
  )
  configureAzureCredentials(azure)
  const gitlab = new GitlabCredentials(
    (key, fallback) => workspace.getAppState(key, fallback),
    (key, value) => workspace.setAppState(key, value),
  )
  configureGitlabCredentials(gitlab)
  const storedPreferences = () => workspace.getAppState<Partial<AppPreferences>>('app-preferences', {})
  const managedSkills = (taskId: string) => learning?.catalog(workspace.projectIdOf(taskId)) ?? []
  // Memories that match the message ride along with it, so recall does not depend on the agent thinking to search.
  const memoryHint = (ws: Workspace, taskId: string, prompt: string) => {
    try {
      return memory?.relevant(ws.projectIdOf(taskId), prompt) ?? ''
    } catch {
      return ''
    }
  }
  const withContext = (ws: Workspace, taskId: string, prompt: string, context?: FileContext[]) =>
    withFileContext(ws, taskId, prompt, context, managedSkills(taskId), memoryHint(ws, taskId, prompt))
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
    process.platform,
    undefined,
    () => (agents?.counts().running ?? 0) > 0,
  )
  const attachmentStore = new AttachmentStore(join(host.userData, 'attachments'))
  const updates = new AppUpdateService(
    host.userData,
    runtimeVersion(process.argv[1] ?? ''),
    () => ({ ...DEFAULT_APP_PREFERENCES, ...storedPreferences() }),
    (state) => host.send('updates:changed', state),
    // Until a desktop app reports in, only a service a packaged macOS app started is expected to have one that installs.
    { installs: process.platform === 'darwin' && !!process.env.RAMU_DESKTOP_APP },
  )
  host.desktopApp?.onInstalled?.((app) => updates.installedApp(app))
  const hostUpdates = new HostUpdater({
    status: async () => updates.status(),
    check: () => updates.check(),
    // Downloading a desktop app this host cannot install only fills its disk.
    download: () =>
      updates.canInstall()
        ? updates.download()
        : Promise.reject(
            new Error('Ramu on this host cannot install updates itself. Install the release from GitHub there.'),
          ),
    desktopAttached: () => host.desktopApp?.attached() === true,
    installOnDesktop: (version) =>
      host.desktopApp ? host.desktopApp.installUpdate(version) : Promise.reject(new Error('No desktop app here')),
    sourceRoot: sourceCheckout(dirname(fileURLToPath(import.meta.url))),
    npmPackage: npmPackage(dirname(fileURLToPath(import.meta.url))),
    run: runCommand,
    supervised: isSupervised(),
  })

  const usage = new UsageService(
    () => workspace.getAppState<UsageReading[]>('usage-limits', []),
    (readings) => workspace.setAppState('usage-limits', readings),
    (readings) => host.send('usage:changed', readings),
    (provider, accountId) => providerAccountRows(loadPreferences().providerBinaries, provider).includes(accountId),
  )
  // Read every enabled login on demand and on a timer, only through each provider's own runtime. Both are read even with
  // one login: their own readings only arrive while they run, and a lone login need not be the default one.
  const accountUsage = new AccountUsage(
    (readings) => usage.update(readings),
    () => loadPreferences().providerBinaries,
    {
      'claude-code': (account) => (agents ? agents.claudeAccountUsage(account) : Promise.resolve([])),
      codex: (account) => codexUsage(account),
    },
    ['codex', 'claude-code'],
  )
  const usageConfigurationChanged = () => {
    accountUsage.forgetAll()
    void accountUsage.refresh().catch(() => {})
  }
  const loadPreferences = (): AppPreferences => {
    const saved = storedPreferences()
    return appPreferences.parse({
      ...DEFAULT_APP_PREFERENCES,
      ...saved,
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
    providers.settingsChanged()
    awake.settingsChanged()
    host.send('usage:changed', usage.list())
    updates.settingsChanged()
    // Ordinary preference saves must not launch provider discovery for the returned settings snapshot.
    if (catalogChanged) {
      agents.invalidateCatalog()
      // A login added, removed or switched, or a provider turned on: its gauges are read now, not at the next poll.
      usageConfigurationChanged()
    }
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
  const refreshUsage = () => void accountUsage.refresh().catch(() => {})
  setTimeout(refreshUsage, 15_000).unref()
  setInterval(refreshUsage, ACCOUNT_USAGE_INTERVAL_MS).unref()
  setTimeout(() => void cleanupArchived(), 30_000).unref()
  setInterval(() => void cleanupArchived(), 6 * 3_600_000).unref()
  if (agents) {
    agents.isolationRoot = join(host.userData, 'subagent-worktrees')
    agents.usage = usage
    agents.preferences = loadPreferences
    const signals = new ModelSignalSource(
      join(host.userData, 'model-signals.json'),
      () => loadPreferences().modelCatalogLookups !== false,
    )
    agents.modelSignals = () => signals.current()
    agents.modelNews = new ModelNews(
      {
        get: (key, fallback) => workspace.getAppState(key, fallback),
        set: (key, value) => workspace.setAppState(key, value),
      },
      () => loadPreferences().newModelNotices !== false,
      (notices) => host.send('models:news', notices),
    )
    // Which logins run on an API key is read with their usage, so a fallback decides on current sign-ins.
    agents.refreshAccountUsage = (provider) =>
      Promise.all([accountUsage.refresh(provider), providers.accountLogins().catch(() => undefined)]).then(() => {})
    agents.apiKeyLogins = () => providers.apiKeyLogins()
    // An upgrade or downgrade changes which models a login offers and how its usage is counted: read both again now.
    const planChanged = (provider: AgentProvider, accountId: string) => {
      agents.invalidateCatalog()
      accountUsage.forget(provider, accountId)
      void accountUsage.refresh(provider).catch(() => {})
    }
    providers.onPlanChange = planChanged
    // Another account behind a login reads its plan, models and usage afresh, and every device names it again.
    providers.onLoginChange = (provider, accountId) => {
      planChanged(provider, accountId)
      host.send('logins:changed', {})
    }
    onAcpPlanChange(planChanged)
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
    hostUpdates,
    usage,
    accountUsage,
    usageConfigurationChanged,
    environment,
    apiKeys,
    forgeAccounts,
    bitbucket,
    azure,
    gitlab,
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
