import type { SettingsMenuId } from './settingsMenu'
import { APP_AUTO_UPDATE } from './updates'

/**
 * One row of Settings as search finds it. `path` names the portable setting the row edits (see `portableSettings`),
 * so agents' settings tools and the person's search find the same rows by the same titles and words; a row without one
 * holds something only the person changes there (sign-ins, pairing, permissions) or a list with its own editor.
 * `title` and `help` are English copy keys, the same ones the row draws.
 */
export interface SettingsCatalogEntry {
  section: SettingsMenuId
  title: string
  words?: string
  path?: string
  help?: string
}

/** Every individual setting, so search finds "Primary color" and jumps to it, not just the page it lives on. */
export const SETTINGS_CATALOG: SettingsCatalogEntry[] = [
  {
    section: 'computer',
    title: 'Computer use',
    words:
      'computer screen display desktop control agent native app accessibility screen recording permission lock awake share phone',
  },
  {
    section: 'computer',
    title: 'Limit access to one app',
    words: 'computer use open computer use app scoped install calculator accessibility',
  },
  {
    section: 'computer',
    title: 'Let app drags use your real pointer',
    words: 'computer use drag pointer mouse window move select text',
  },
  {
    section: 'computer',
    title: 'Keep this computer awake',
    words: 'computer use sleep awake caffeinate screen lock',
  },
  {
    section: 'devices',
    title: 'Let agents use test devices',
    words: 'test devices simulator emulator ios android iphone ipad pixel phone app mobile check',
  },
  {
    section: 'devices',
    title: 'Setup',
    words: 'test devices simulator emulator xcode android sdk idb install setup ready missing',
  },
  { section: 'devices', title: 'In use', words: 'test devices simulator emulator running stop thread' },
  {
    section: 'chats',
    title: 'Voice input',
    words: 'microphone dictation speech voice dictate language transcribe record',
  },
  { section: 'browser', title: 'Open clicked links in', words: 'browser links system integrated web external' },
  {
    section: 'browser',
    title: 'Agent browser',
    path: 'agentBrowser.agentBrowser',
    help: 'Applies on the selected execution host. Keep Ramu desktop open there. Helpers and other access modes need browser-only approval. Changes apply the next time the provider starts.',
    words: 'browser provider override profile temporary default sessions control',
  },
  { section: 'agent-setup', title: 'MCP servers', words: 'shared tools external service connection authentication' },
  {
    section: 'plugins',
    title: 'Plugins',
    words:
      'install marketplace index extension service integration railway fly cloudflare supabase grafana amplitude salesforce',
  },
  { section: 'agent-setup', title: 'Skills', words: 'installed skills your own skill install preview copy archive' },
  { section: 'plugins', title: 'Install from a source', words: 'git folder plugin.json claude code codex' },
  {
    section: 'account',
    title: 'Ramu account',
    words: 'sign in backup restore recovery code github gist your hosts pair',
  },
  {
    section: 'identities',
    title: 'Identities',
    words: 'work personal client account git author email profile login company',
  },
  {
    section: 'system',
    title: 'Keep local crash reports',
    path: 'localCrashReports',
    help: 'Off by default. Keeps sanitized service errors and Electron crash dumps on this device, never uploaded. Restart Ramu to apply. Native dumps may hold process memory and are left out of copied diagnostics.',
    words: 'diagnostics privacy errors crash local export',
  },
  {
    section: 'git',
    title: 'Default workspace for new threads',
    path: 'defaultCheckoutMode',
    help: 'Choose the current checkout or an isolated worktree. Each draft can override this default.',
    words: 'checkout workspace worktree isolation default branch naming prefix',
  },
  {
    section: 'git',
    title: 'Worktree branch naming',
    path: 'worktreeBranchNaming',
    help: 'Generated names use the opening message. If generation fails, Ramu uses a default name.',
    words: 'semantic custom fixed naming generation',
  },
  {
    section: 'git',
    title: 'Branch naming instructions',
    path: 'worktreeBranchInstructions',
    help: 'Describe the complete branch name, including any ticket or team prefix.',
    words: 'ticket team custom branch',
  },
  { section: 'git', title: 'Branch prefix', path: 'worktreeBranchPrefix', words: 'worktree branch namespace naming' },
  { section: 'git', title: 'Hosting accounts', words: 'github accounts tokens sign in gh connection credentials' },
  {
    section: 'deploy',
    title: 'Hosting',
    words: 'deploy ship publish vercel netlify hosting account sign in token production preview',
  },
  { section: 'deploy', title: 'Databases', words: 'deploy database postgres neon provision' },
  { section: 'deploy', title: 'App stores', words: 'expo eas ios android release store build phone app' },
  { section: 'git', title: 'GitHub', words: 'github gh account pull requests issues hosting' },
  { section: 'git', title: 'GitLab', words: 'gitlab merge requests pipelines glab hosting' },
  { section: 'git', title: 'Bitbucket Cloud', words: 'bitbucket pull requests builds issues api token hosting' },
  {
    section: 'git',
    title: 'Azure DevOps',
    words: 'azure devops repos pull requests pipelines work items boards token hosting',
  },
  {
    section: 'git',
    title: 'Automatic pull',
    path: 'autoPull',
    help: 'Pull when the checkout is clean and can fast-forward. Skipped while an agent is working, files are unsaved, or Git is busy.',
    words: 'git auto fetch remote fast-forward background sync',
  },
  {
    section: 'git',
    title: 'Automatically watch pull requests',
    path: 'autoWatchPullRequests',
    help: 'Watch pull requests you create from a thread. New failures and requested changes go back to that thread, and you review and push. Manage existing watches in Source Control.',
    words: 'pr auto checks reviews feedback thread background',
  },
  {
    section: 'git',
    title: 'Remove agent credits',
    path: 'removeAgentCredits',
    help: 'Keep AI agent Co-authored-by trailers and Generated with lines out of commits and pull requests. Agents are told not to add them, and Ramu strips any that remain. Credits for people stay.',
    words: 'co-author coauthored trailer attribution generated with claude codex commit pull request ai signature',
  },
  ...(APP_AUTO_UPDATE
    ? [
        {
          section: 'system' as const,
          title: 'Auto-update Ramu',
          path: 'appAutoUpdate',
          help: 'Download updates automatically, then restart when ready. Threads keep running.',
          words: 'app update github release download restart background service version',
        },
      ]
    : []),
  {
    section: 'workflows',
    title: 'Automatic goals',
    path: 'goals.mode',
    help: 'Let the agent set a goal for longer tasks. When off, start one with /goal. Applies when a thread starts or restarts.',
    words: 'goal auto manual off automatic completion continue unfinished',
  },
  {
    section: 'workflows',
    title: 'Maximum continuation turns',
    path: 'goals.maxTurns',
    help: "How many follow-up turns a goal may take on its own. Your messages and the first turn don't count.",
    words: 'goal max limit budget unlimited retry available quota reset',
  },
  { section: 'workflows', title: 'Custom turn limit', words: 'goal max number turns' },
  {
    section: 'chats',
    title: 'Load tools on demand',
    path: 'intelligence.toolSearch',
    help: 'Keep optional Ramu tools out of the prompt until the agent needs them. Applies to new provider sessions.',
    words: 'tool search tokens deferred optional ramu',
  },
  {
    section: 'memory',
    title: 'Automatic learning',
    path: 'intelligence.learning',
    help: 'After a thread, look for lasting notes and reusable skills. Uses model tokens when idle.',
    words: 'self improve skills consolidate review maintenance ask first',
  },
  {
    section: 'memory',
    title: 'Model for background maintenance',
    path: 'intelligence.maintenanceModel',
    help: 'Used for learning reviews and memory cleanup. A cheaper model keeps token use low.',
    words: 'maintenance model cheaper background',
  },
  {
    section: 'memory',
    title: 'Reviews per day',
    path: 'intelligence.dailyReviews',
    help: 'Caps background reviews to limit token use.',
    words: 'maximum daily limit tokens learning',
  },
  {
    section: 'memory',
    title: 'Archive unused skills after',
    path: 'intelligence.archiveSkillDays',
    help: 'Only skills Ramu created are archived. Pinned skills are kept.',
    words: 'skill stale expire days',
  },
  {
    section: 'memory',
    title: 'Shared memory',
    path: 'memory.enabled',
    help: 'Agents on every provider read and save the same notes, including during threads. Learning also saves lasting lessons after threads. Applies when a thread starts or restarts.',
    words: 'memory remember recall learn preferences claude codex opencode providers',
  },
  {
    section: 'memory',
    title: 'Memory cleanup',
    path: 'memory.dream',
    help: 'Once a day, merge duplicates and archive unused notes. Notes you wrote are never changed. Uses model tokens. Anything archived can be restored.',
    words: 'memory consolidate merge duplicates stale contradictions cleanup self improve tokens',
  },
  {
    section: 'memory',
    title: 'Archive unused memories after',
    path: 'memory.staleAfterDays',
    help: 'Applies to project notes that were never used. Notes you wrote and essential memories are kept.',
    words: 'memory stale decay archive expire days',
  },
  {
    section: 'chats',
    title: 'Agent notifications',
    path: 'notifyAgentDone',
    help: 'Notify when an agent finishes, needs input, or fails.',
    words: 'notify notification alert done finished system toast',
  },
  {
    section: 'chats',
    title: 'Let agents suggest teammates',
    path: 'teammateSuggestions',
    help: "The thread's agent may suggest bringing another model in, for example to review its work. Each suggestion asks you first and says which login it uses.",
    words: 'teammate review second model suggest invite',
  },
  {
    section: 'models',
    title: 'Look up model dates online',
    path: 'modelCatalogLookups',
    help: 'Once a day, this host reads public model lists (models.dev and LiteLLM) to tag new models and ones their provider is retiring or has deprecated. Nothing about you is sent. When off, Ramu tags older versions as legacy itself.',
    words: 'legacy new retire deprecated models.dev litellm catalog',
  },
  {
    section: 'chats',
    title: 'Continue threads after restart',
    path: 'resumeChatsOnRestart',
    help: 'Resume unfinished threads when the service restarts. Stopped and completed threads stay stopped.',
    words: 'resume recover recovery interrupted progress startup crash',
  },
  {
    section: 'chats',
    title: 'Move slow commands to background',
    path: 'autoBackgroundSeconds',
    help: 'Let the agent keep working when a command runs longer than this.',
    words:
      'background long running slow dev server watcher build test shell command async auto automatic timeout seconds',
  },
  {
    section: 'chats',
    title: 'Keep working while asking questions',
    path: 'asyncQuestions',
    help: 'Let the agent continue independent work while it waits for your answer. Applies when a thread starts or restarts.',
    words: 'async asynchronous optional blocking related grouped answers pending input',
  },
  {
    section: 'system',
    title: 'Daily recaps',
    path: 'recapsEnabled',
    help: 'Show recent threads and unfinished work on Home. Uses model tokens to write the summary.',
    words: 'recap summary home tokens',
  },
  {
    section: 'system',
    title: 'Generate daily at',
    path: 'recapTime',
    help: 'Create the recap at this time in your system timezone.',
    words: 'recap time schedule timezone',
  },
  {
    section: 'system',
    title: 'Keep host awake',
    path: 'keepAwake',
    help: 'Stop your Mac sleeping from idle while the service runs. Display sleep and manual sleep still work.',
    words: 'sleep awake caffeinate power battery background installed login',
  },
  { section: 'system', title: 'Background service', words: 'daemon login startup' },
  {
    section: 'appearance',
    title: 'Language',
    path: 'language',
    help: 'Choose your preferred language. Changes apply after saving.',
    words: 'bahasa indonesia english system perangkat',
  },
  {
    section: 'appearance',
    title: 'Primary color',
    path: 'accent',
    help: 'Used for primary actions, activity, and links.',
    words: 'accent blue violet teal theme',
  },
  { section: 'appearance', title: 'Interface font', path: 'fontFamily', words: 'system geist typeface' },
  { section: 'appearance', title: 'Interface font size', path: 'fontSize', words: 'text size zoom' },
  {
    section: 'appearance',
    title: 'Reduce motion',
    path: 'reduceMotion',
    help: 'Turn off interface animations. Your system’s reduced motion setting always applies.',
    words: 'animation transition accessibility movement reduced motion',
  },
  {
    section: 'appearance',
    title: 'Crisper text',
    path: 'fontSmoothing',
    help: 'Use lighter text rendering on macOS.',
    words: 'font smoothing antialiasing grayscale',
  },
  { section: 'appearance', title: 'Layout sizes', words: 'reset width height split terminal' },
  {
    section: 'editor',
    title: 'Preview tabs',
    path: 'previewTabs',
    help: 'Single-click previews a file. Double-click or edit to keep it open.',
    words: 'single click open file',
  },
  {
    section: 'editor',
    title: 'Default Markdown view',
    path: 'defaultMarkdownView',
    help: 'Choose how Markdown files open. Links to a specific line open Source.',
    words: 'source edit preview read rendered viewer',
  },
  { section: 'editor', title: 'Editor font size', path: 'editorFontSize', words: 'monaco text' },
  { section: 'editor', title: 'Terminal font size', path: 'terminalFontSize', words: 'xterm text' },
  {
    section: 'editor',
    title: 'Default terminal position',
    words: 'terminal panel dock bottom right',
    path: 'defaultTerminalDock',
    help: 'Choose where the terminal panel opens. Checkouts with a saved terminal position keep that choice.',
  },
  { section: 'editor', title: 'Default terminal tabs', words: 'top right position' },
  {
    section: 'providers',
    title: 'Provider binaries',
    words: 'claude codex opencode cursor antigravity install setup path executable login',
  },
  {
    section: 'agent-setup',
    title: 'Environment variables',
    words: 'env dotenv .env api key token base url proxy secret global per provider export copy paste',
  },
  {
    section: 'providers',
    title: 'Provider update notifications',
    path: 'providerUpdateChecks',
    help: 'Runs in the background, even while Ramu is closed.',
    words: 'latest version check updates automatic',
  },
  { section: 'models', title: 'Model sets', path: '$models', words: 'steps effort reasoning provider codex claude' },
  { section: 'models', title: 'Default set', words: 'model' },
  { section: 'models', title: 'Default step', words: 'model effort' },
  { section: 'models', title: 'Provider fallback', words: 'limit switch provider' },
  {
    section: 'access',
    title: 'Default access',
    path: 'defaultAccess',
    help: 'Starting access for new threads. Existing threads keep theirs.',
    words: 'permissions edits auto full',
  },
  {
    section: 'models',
    title: 'When a usage limit is reached',
    path: 'defaultAutoFallback',
    help: 'Switching applies to new threads. Waiting and stopping apply to every thread, including ones already waiting.',
    words:
      'automatic provider fallback limit switch another model wait this model stop decide resume auto-resume reset rate quota',
  },
  {
    section: 'models',
    title: 'When to switch',
    path: 'fallback.switchAt',
    help: 'Switch at a usage limit, or earlier at the selected percentage.',
    words: 'usage threshold percent 5-hour weekly fallback',
  },
  {
    section: 'models',
    title: 'Fallback order',
    path: 'fallback.order',
    words: 'provider model effort chain list order',
  },
  { section: 'models', title: 'Abilities', words: 'image generation web search long documents provider routing' },
  {
    section: 'providers',
    title: 'Google Gemini',
    words: 'media api key video omni flash speech voice narration music lyria',
  },
  { section: 'providers', title: 'ElevenLabs', words: 'media api key speech voice narration music sound effects' },
  {
    section: 'models',
    title: 'Ask before using another provider',
    path: 'abilities.askBeforeOtherProvider',
    help: 'Calls to a provider other than the thread’s wait for your approval, which shows the provider and what is sent.',
    words: 'ability approval image search provider',
  },
  { section: 'workflows', title: 'Where sub-agents run', words: 'subagent native provider cross delegate' },
  { section: 'workflows', title: 'Custom agents', words: 'custom agent reusable reviewer recipe' },
  {
    section: 'chats',
    title: 'Describe this host',
    path: 'hostDescription',
    help: 'A few words such as GPU box or office network. Continue on another host suggests it when a request mentions them.',
    words: 'host description gpu office network suggest continue',
  },
  { section: 'workflows', title: 'Automatic selection', words: 'subagent model effort automatic cap maximum' },
  { section: 'workflows', title: 'By type', words: 'explore plan subagent type route' },
  { section: 'workflows', title: 'When a sub-agent is limited', words: 'subagent fallback order limit separate same' },
  {
    section: 'workflows',
    title: 'Decide before Codex starts its own sub-agents',
    path: 'subagents.codexHook',
    words: 'codex hook trust intercept spawn_agent config',
  },
  {
    section: 'workflows',
    title: 'Advisor',
    path: 'advisor.enabled',
    help: 'Sends the thread transcript to the advisor model and uses model tokens. Applies when a thread starts or restarts.',
    words: 'advisor reviewer review second opinion stronger model consult claude opus gpt cross provider',
  },
  {
    section: 'workflows',
    title: 'Advisor model',
    path: 'advisor.step',
    words: 'advisor reviewer model effort provider',
  },
  {
    section: 'workflows',
    title: 'Always wait for advice',
    path: 'advisor.wait',
    help: 'Pause until advice arrives. When off, the agent keeps working on other things.',
    words: 'advisor block blocking async wait continue',
  },
  {
    section: 'providers',
    title: 'Show usage limits',
    path: 'showUsageLimits',
    help: 'Show provider usage in the sidebar or status bar.',
    words: 'usage gauge 5-hour weekly plan quota',
  },
  {
    section: 'chats',
    title: 'Sidebar shows',
    path: 'recentChatMode',
    help: 'Projects groups threads under their project. Recent threads lists every thread by latest activity.',
    words: 'sidebar projects recent threads activity view list group switch mode',
  },
  {
    section: 'chats',
    title: 'Show branches in projects',
    path: 'threadRowBranches',
    help: 'Threads under a project get a second line with the branch their work lands on. Recent threads always show it.',
    words: 'sidebar branch git worktree two line row thread project',
  },
  {
    section: 'chats',
    title: 'Messages while working',
    path: 'busyMessageAction',
    help: 'Steer adds your message after the current tools finish. Queue waits for the whole turn. Cmd/Ctrl+Enter does the other one.',
    words: 'queue steer steering enter busy',
  },
  {
    section: 'chats',
    title: 'Include open tabs as context',
    path: 'includeTabContext',
    help: 'Send the active file or selection with each message, plus the paths of other open tabs. Unsaved edits are included.',
    words: 'files mention',
  },
  {
    section: 'chats',
    title: 'Delete archived threads after',
    path: 'cleanupArchivedDays',
    help: 'Worktrees and branches are kept.',
    words: 'cleanup retention history delete days',
  },
  {
    section: 'git',
    title: 'Style',
    path: 'commitStyle',
    help: 'How commit messages and pull request titles are worded.',
    words: 'commit message pull request title conventional repository custom generated',
  },
  {
    section: 'git',
    title: 'Writing model',
    path: 'commitModel',
    help: 'Writes commit messages and pull request titles and descriptions. Default uses your default model.',
    words: 'ai draft commit message pull request description default model effort',
  },
  {
    section: 'git',
    title: 'Writing instructions',
    path: 'commitInstructions',
    help: 'Used for commit messages and pull requests. For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.',
    words: 'commit message pull request custom instructions',
  },
  {
    section: 'git',
    title: 'Commit from default branch',
    path: 'defaultCommitBranch',
    help: 'What to do when you commit and push while on the default branch.',
    words: 'feature branch current main push',
  },
  { section: 'system', title: 'Start at login', words: 'startup launch macos service' },
  {
    section: 'system',
    title: 'When to keep awake',
    path: 'keepAwakeWhen',
    help: 'Choose whether to keep awake on battery power.',
    words: 'battery power plugged in',
  },
  {
    section: 'system',
    title: 'Check app updates',
    path: 'appUpdateChecks',
    help: 'The background service checks while Ramu is closed.',
    words: 'release version check',
  },
  { section: 'models', title: 'Default bar mode', path: '$models.defaultBarMode', words: 'model effort selection' },
  {
    section: 'git',
    title: 'Pull behavior',
    path: 'pullMode',
    help: 'How Pull and Sync combine local and remote commits. Tracked edits are stashed and restored for you.',
    words: 'rebase merge fast-forward sync',
  },
  {
    section: 'chats',
    title: 'Recent threads per project',
    path: 'recentChats',
    help: 'Older threads stay available under Show more.',
    words: 'sidebar count project',
  },
  { section: 'shortcuts', title: 'Keyboard shortcuts', words: 'keys commands bindings' },
  {
    section: 'remote',
    title: 'Allow other devices',
    words: 'remote access network listen phone tablet vpn tailscale netbird zerotier wireguard lan server',
  },
  {
    section: 'remote',
    title: 'Discoverable on this network',
    words: 'nearby discovery bonjour mdns advertise visible host name find automatic lan',
  },
  { section: 'remote', title: 'Network', words: 'choose select wifi lan vpn tailscale address interface listen' },
  { section: 'remote', title: 'Pair a device', words: 'pairing code link phone another host connect add' },
  { section: 'remote', title: 'Paired devices', words: 'revoke remove devices access token' },
  {
    section: 'remote',
    title: 'Connect to a host',
    words: 'remote server use another host switch host pair address link ssh alias',
  },
  {
    section: 'account',
    title: 'Copy settings',
    words: 'export import transfer settings copy from another host file new machine move restore',
  },
  {
    section: 'chats',
    title: 'Warn before changing model',
    words: 'model switch cache usage warning',
    path: 'warnModelChange',
    help: "A new model can't reuse the cache of a conversation in progress, so the first message after switching uses more of your usage.",
  },
  {
    section: 'chats',
    title: 'Choose the project automatically',
    words: 'project auto routing home',
    path: 'autoProjectSelection',
    help: 'Home picks the project from your first message and asks when more than one fits. Turn off to always choose the project yourself.',
  },
  {
    section: 'chats',
    title: 'Let agents start threads',
    words: 'agent thread start delegate host',
    path: 'agentThreads',
    help: "Agents can start threads in this project, other projects and hosts added for agents. A paired host's agents can also start threads here. Sub-agents are not affected. Turn off so only you start threads.",
  },
  {
    section: 'chats',
    title: 'Float on desktop',
    words: 'live view float tray corner window browser computer test device',
    path: 'liveViewDesktop',
    help: 'Browser, Computer and test device trays can float as a small live view in a corner or a window above other apps. Stop stays in reach.',
  },
  {
    section: 'models',
    title: 'Tell me about new models',
    words: 'new model notification notice announce',
    path: 'newModelNotices',
    help: 'When a provider adds a model you have not had before, each device shows it once and the model list tags it New.',
  },
  {
    section: 'workflows',
    title: 'Helpers use',
    words: 'subagent helper model routing cheaper automatic',
    path: 'subagents.model',
  },
  {
    section: 'workflows',
    title: 'All sub-agents use',
    words: 'subagent helper model step pick',
    path: 'subagents.step',
  },
  {
    section: 'browser',
    title: 'Default integrated profile',
    words: 'browser profile sign-ins temporary default',
    path: 'agentBrowser.defaultProfileId',
    help: 'Default shares website sign-ins on this desktop. Temporary keeps this run separate and is cleared when the run ends.',
  },
  {
    section: 'memory',
    title: 'Recall past conversations',
    words: 'search history cross thread previous conversations remember',
    path: 'intelligence.crossThreadRecall',
    help: 'Let agents search earlier threads across providers. Turning this off keeps your history and same-thread recall. Applies when a thread starts or restarts.',
  },
  {
    section: 'memory',
    title: 'Summary',
    words: 'recap summary daily weekly digest learned',
    path: 'intelligence.summaryInterval',
    help: 'A short, read-only summary of the memories and skills Ramu saved, merged or archived on its own. Uses model tokens only when something changed.',
  },
  {
    section: 'memory',
    title: 'Include memories',
    words: 'summary recap memories',
    path: 'intelligence.summaryMemory',
    help: 'Notes Ramu saved, merged or archived.',
  },
  {
    section: 'memory',
    title: 'Include skills',
    words: 'summary recap skills',
    path: 'intelligence.summarySkills',
    help: 'Skills Ramu created, updated or archived.',
  },
]

/** Places search finds that are not Settings pages, such as the sidebar's Archived view. */
export const SETTINGS_VIEWS: { view: 'archived'; title: string; words: string; label: string }[] = [
  {
    view: 'archived',
    title: 'Archived threads',
    words: 'archived archive history restore unarchive delete sidebar',
    label: 'Sidebar',
  },
]

/** The catalog row that edits `path`, if Settings shows one. */
export const catalogEntryFor = (path: string) => SETTINGS_CATALOG.find((entry) => entry.path === path)

/**
 * Rows matching every word of `query` in their title, words, path or page name, best first: title matches count
 * double. English only, for agents; people search translated titles in Settings itself.
 */
export function findSettingsEntries(query: string, pageLabel: (section: SettingsMenuId) => string, limit = 12) {
  const words = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (!words.length) return []
  return SETTINGS_CATALOG.map((entry) => {
    const title = entry.title.toLowerCase()
    const haystack = `${title} ${entry.words ?? ''} ${entry.path ?? ''} ${pageLabel(entry.section)}`.toLowerCase()
    if (!words.every((word) => haystack.includes(word))) return null
    return { entry, score: words.filter((word) => title.includes(word)).length * 2 + (entry.path ? 1 : 0) }
  })
    .filter((hit): hit is NonNullable<typeof hit> => !!hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((hit) => hit.entry)
}
