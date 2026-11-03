import {
  LIMIT_CHOICE_HELP,
  LIMIT_CHOICE_TITLE,
  limitChoiceOf,
  limitChoiceOptions,
  limitChoicePatch,
  type LimitChoice,
} from '@ramu/shared/chat/limitPolicy'
import {
  HOST_ONLY_SECTIONS,
  SETTINGS_MENU,
  SETTINGS_MENU_GROUPS,
  type PhoneSettingsMenuId,
} from '@ramu/shared/settingsMenu'
import type { SettingEdit, SettingSchema, SettingsSnapshot, SharedSetting } from '@ramu/shared/settingsCompatibility'

// The phone's settings menu: the desktop's own menu (`@ramu/shared/settingsMenu`), in its order and wording, without
// the sections that only matter at the host's keyboard, plus a group for things that live on this phone.

export type Language = 'en' | 'id'
export type SettingsGroup = 'workspace' | 'agents' | 'system' | 'phone'
export type SettingsSection = PhoneSettingsMenuId | 'notifications' | 'about'

/** Labels are English copy keys, translated where they are drawn (as the desktop does). */
type Text = string
const text = (key: string): Text => key

export const SETTINGS_GROUPS: { id: SettingsGroup; label: Text }[] = [
  ...SETTINGS_MENU_GROUPS.map((group) => ({ id: group.toLowerCase() as SettingsGroup, label: text(group) })),
  { id: 'phone', label: text('This phone') },
]

/** Pages about this phone rather than the selected host: no host picker on them. */
const PHONE_PAGES: readonly SettingsSection[] = ['appearance', 'archived', 'remote', 'notifications', 'about']

/** `host` pages edit the selected computer's shared preferences; `phone` pages only touch this device. */
export const SETTINGS_SECTIONS: { id: SettingsSection; group: SettingsGroup; scope: 'host' | 'phone'; label: Text }[] =
  [
    ...SETTINGS_MENU.filter((entry): entry is Extract<typeof entry, { phone: true }> => entry.phone).map((entry) => ({
      id: entry.id,
      group: entry.group.toLowerCase() as SettingsGroup,
      scope: PHONE_PAGES.includes(entry.id) ? ('phone' as const) : ('host' as const),
      label: text(entry.label),
    })),
    { id: 'notifications', group: 'phone', scope: 'phone', label: text('Notifications') },
    { id: 'about', group: 'phone', scope: 'phone', label: text('About') },
  ]

/** The desktop sections the phone leaves to the host, named once under the menu. */
export const HOST_ONLY_LABELS = HOST_ONLY_SECTIONS

export const sectionById = (id: string) => SETTINGS_SECTIONS.find((section) => section.id === id)
export const sectionLabel = (id: SettingsSection) => sectionById(id)!.label

type Value = string | number | boolean | null
export interface Option {
  value: Value
  label: string
}

interface RowBase {
  /** The key in the computer's shared preferences, dotted for nested ones (`goals.mode`). */
  path: string
  title: string
  help?: string
  /** Extra search terms. */
  words?: string
  /** Shown only while another setting has this value, like the desktop's "When to keep awake". */
  when?: { path: string; equals: Value }
}
export type SettingRow =
  | (RowBase & { kind: 'toggle' })
  | (RowBase & { kind: 'choice'; options: Option[] })
  | (RowBase & { kind: 'text'; placeholder?: string; maxLength?: number })
  /** One of the host's model steps, stored as provider, model and effort; `emptyLabel` names the choice of none. */
  | (RowBase & { kind: 'model'; emptyLabel: string })
  /** "When a usage limit is reached": one choice stored as two settings, `path` (fallback on or off) and `resumePath`. */
  | (RowBase & { kind: 'limit'; resumePath: string })
export interface RowGroup {
  title?: string
  rows: SettingRow[]
}

const choice = (values: Value[], label: (value: Value) => string): Option[] =>
  values.map((value) => ({ value, label: label(value) }))
const count = (n: number) => String(n)
const days = (n: Value) => (n === 0 ? 'Never' : n === 365 ? '1 year' : `${n} days`)
const afterSeconds = (n: Value) =>
  n === 0
    ? 'Never'
    : n === 60
      ? 'After 1 minute'
      : Number(n) > 60
        ? `After ${Number(n) / 60} minutes`
        : `After ${n} seconds`
const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)

/** The desktop's rows that make sense on a phone, in the desktop's order and wording. Heavy editors stay on the desktop. */
export const SETTINGS_ROWS: Partial<Record<SettingsSection, RowGroup[]>> = {
  git: [
    {
      title: 'New threads & worktrees',
      rows: [
        {
          kind: 'choice',
          path: 'defaultCheckoutMode',
          title: 'Default workspace for new threads',
          help: 'Choose the current checkout or an isolated worktree. Each draft can override this default.',
          words: 'checkout workspace worktree isolation default branch naming',
          options: [
            { value: 'current', label: 'Current checkout' },
            { value: 'worktree', label: 'New worktree' },
          ],
        },
        {
          kind: 'choice',
          path: 'worktreeBranchNaming',
          title: 'Worktree branch naming',
          help: 'Generated names use the opening message. If generation fails, Ramu uses a default name.',
          words: 'branch semantic custom naming',
          options: [
            { value: 'fixed', label: 'Fixed prefix' },
            { value: 'semantic', label: 'Semantic name' },
            { value: 'custom', label: 'Custom instructions' },
          ],
        },
        {
          kind: 'text',
          path: 'worktreeBranchInstructions',
          title: 'Branch naming instructions',
          help: 'Describe the complete branch name, including any ticket or team prefix.',
          words: 'branch naming instructions',
          maxLength: 2000,
          when: { path: 'worktreeBranchNaming', equals: 'custom' },
        },
        {
          kind: 'text',
          path: 'worktreeBranchPrefix',
          when: { path: 'worktreeBranchNaming', equals: 'fixed' },
          title: 'Branch prefix',
          help: 'Git namespace for new worktree branches, such as ramu/ or feature/. Empty means no prefix.',
          words: 'branch prefix naming namespace',
          maxLength: 120,
        },
      ],
    },
    {
      title: 'Sync',
      rows: [
        {
          kind: 'toggle',
          path: 'autoPull',
          title: 'Automatic pull',
          help: 'Pull when the checkout is clean and can fast-forward. Skipped while an agent is working, files are unsaved, or Git is busy.',
          words: 'auto fetch remote fast-forward background sync',
        },
        {
          kind: 'choice',
          path: 'pullMode',
          title: 'Pull behavior',
          help: 'How Pull and Sync combine local and remote commits. Tracked edits are stashed and restored for you.',
          words: 'rebase merge fast-forward sync',
          options: [
            { value: 'rebase', label: 'Rebase' },
            { value: 'merge', label: 'Merge' },
            { value: 'ff-only', label: 'Fast-forward only' },
          ],
        },
      ],
    },
    {
      title: 'Pull requests',
      rows: [
        {
          kind: 'toggle',
          path: 'autoWatchPullRequests',
          title: 'Automatically watch pull requests',
          help: 'Watch pull requests you create from a thread. New failures and requested changes return to that thread. You review and push.',
          words: 'pr auto checks reviews feedback thread background',
        },
      ],
    },
    {
      title: 'Commits',
      rows: [
        {
          kind: 'choice',
          path: 'defaultCommitAction',
          title: 'Default commit action',
          help: 'What the commit button does first, on this computer and on your phones. Each commit can pick another.',
          words: 'commit push sync button primary default',
          options: [
            { value: 'commit', label: 'Commit' },
            { value: 'push', label: 'Commit & Push' },
            { value: 'sync', label: 'Commit & Sync' },
          ],
        },
        {
          kind: 'model',
          path: 'commitModel',
          title: 'Writing model',
          help: 'Writes commit messages and pull request titles and descriptions. Default uses your default model.',
          words: 'commit message pull request model generated writing',
          emptyLabel: 'Default model',
        },
        {
          kind: 'choice',
          path: 'commitStyle',
          title: 'Style',
          help: 'How commit messages and pull request titles are worded.',
          words: 'commit message pull request title conventional repository custom generated',
          options: [
            { value: 'conventional', label: 'Conventional commits' },
            { value: 'repository', label: 'Match this repository' },
            { value: 'custom', label: 'My own instructions' },
          ],
        },
        {
          kind: 'text',
          path: 'commitInstructions',
          title: 'Writing instructions',
          help: 'Used for commit messages and pull requests. For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.',
          words: 'commit message pull request custom ticket language subject',
          placeholder: 'Describe how commit messages and pull requests should be written',
          maxLength: 2000,
          when: { path: 'commitStyle', equals: 'custom' },
        },
        {
          kind: 'choice',
          path: 'defaultCommitBranch',
          title: 'Commit from default branch',
          help: 'What to do when you commit and push while on the default branch.',
          words: 'feature branch current main push',
          options: [
            { value: 'new-branch', label: 'Create feature branch' },
            { value: 'current', label: 'Continue on current branch' },
          ],
        },
      ],
    },
  ],
  browser: [
    {
      rows: [
        {
          kind: 'choice',
          path: 'agentBrowser.agentBrowser',
          title: 'Agent browser',
          help: 'Applies on the selected host, which must keep Ramu desktop open. Changes apply on the next provider launch.',
          words: 'browser agent integrated provider web',
          options: [
            { value: 'provider', label: 'Provider browser setup' },
            { value: 'integrated', label: 'Ramu integrated browser' },
          ],
        },
      ],
    },
  ],
  chats: [
    {
      title: 'Sending messages',
      rows: [
        {
          kind: 'toggle',
          path: 'autoProjectSelection',
          title: 'Choose the project automatically',
          help: 'Home picks the project from your first message and asks when more than one fits. Turn off to always choose the project yourself.',
          words: 'project auto routing home',
        },
        {
          kind: 'text',
          path: 'hostDescription',
          title: 'Describe this host',
          help: 'A few words such as GPU box or office network. Continue on another host suggests it when a request mentions them.',
          words: 'host description continue another computer gpu office',
          maxLength: 80,
        },
        {
          kind: 'toggle',
          path: 'operator',
          title: 'Operator',
          help: 'Inbox gets a box where one sentence proposes actions across threads and schedules on connected hosts. Nothing runs until you confirm. Each request uses one short model call; it costs nothing otherwise.',
          words: 'operator actions command inbox stop retry',
        },
        {
          kind: 'toggle',
          path: 'agentThreads',
          title: 'Let agents start threads',
          help: "Agents can start threads in this project, other projects and hosts added for agents, and a paired host's agents can start threads here. Sub-agents are not affected. Turn off to start threads only yourself.",
          words: 'agent thread start delegate host',
        },
        {
          kind: 'toggle',
          path: 'teammateSuggestions',
          title: 'Let agents suggest teammates',
          help: "The thread's agent may suggest bringing another model in, for example to review its work. Each suggestion asks you first and says which login it uses.",
          words: 'teammate review second model suggest invite',
        },
      ],
    },
    {
      title: 'While agents work',
      rows: [
        {
          kind: 'toggle',
          path: 'resumeChatsOnRestart',
          title: 'Continue threads after restart',
          help: 'Resume unfinished threads when the service restarts. Stopped and completed threads stay stopped.',
          words: 'resume recover recovery interrupted progress startup crash',
        },
        {
          kind: 'toggle',
          path: 'asyncQuestions',
          title: 'Keep working while asking questions',
          help: 'Let the agent continue independent work while it waits for your answer. Applies when a thread starts or restarts.',
          words: 'async asynchronous optional blocking related grouped answers pending input',
        },
        {
          kind: 'choice',
          path: 'autoBackgroundSeconds',
          title: 'Move slow commands to background',
          help: 'Let the agent keep working when a command runs longer than this.',
          words: 'background long running slow dev server watcher build test shell command async timeout seconds',
          options: choice([0, 30, 60, 120, 300], afterSeconds),
        },
        {
          kind: 'toggle',
          path: 'intelligence.toolSearch',
          title: 'Load tools on demand',
          help: 'Keep optional Ramu tools out of the prompt until the agent needs them. Saves tokens.',
          words: 'tool search tokens deferred optional ramu',
        },
      ],
    },
    {
      title: 'Thread history',
      rows: [
        {
          kind: 'choice',
          path: 'recentChats',
          title: 'Recent threads per project',
          help: 'Older threads stay available under Show more.',
          words: 'sidebar count project',
          options: choice(
            Array.from({ length: 18 }, (_, index) => index + 3),
            (n) => count(Number(n)),
          ),
        },
        {
          kind: 'choice',
          path: 'cleanupArchivedDays',
          title: 'Delete archived threads after',
          help: 'Worktrees and branches are kept.',
          words: 'cleanup retention history delete days',
          options: choice([0, 7, 30, 90, 365], days),
        },
      ],
    },
  ],
  models: [
    {
      title: 'Model selection',
      rows: [
        {
          kind: 'choice',
          path: '$models.defaultBarMode',
          title: 'Model selection',
          help: 'Choose configured steps, or choose a model and adjust its supported effort. Switching keeps your current selection and draft.',
          words: 'model effort steps selection slider',
          options: [
            { value: 'model', label: 'Steps' },
            { value: 'effort', label: 'Model then effort' },
          ],
        },
        {
          kind: 'toggle',
          path: 'modelCatalogLookups',
          title: 'Look up model dates online',
          help: 'This host reads public model lists (models.dev and LiteLLM) once a day to tag new models and ones their provider is retiring or calls deprecated. Nothing about you is sent. Off, Ramu tags older versions as legacy on its own.',
          words: 'new legacy deprecated retiring release date models.dev litellm',
        },
      ],
    },
    {
      title: 'Provider fallback',
      rows: [
        {
          kind: 'limit',
          path: 'defaultAutoFallback',
          resumePath: 'fallback.autoResume',
          title: LIMIT_CHOICE_TITLE,
          help: LIMIT_CHOICE_HELP,
          words: 'provider fallback limit switch wait stop resume automatic model usage reset auto-resume',
        },
      ],
    },
  ],
  providers: [
    {
      title: 'Usage',
      rows: [
        {
          kind: 'toggle',
          path: 'showUsageLimits',
          title: 'Show usage limits',
          help: 'Show the 5-hour and weekly plan usage gauges.',
          words: 'usage gauge 5-hour weekly plan quota',
        },
        {
          kind: 'toggle',
          path: 'providerUpdateChecks',
          title: 'Provider update notifications',
          help: 'Tell this host to check for newer provider CLIs.',
          words: 'latest version check updates automatic',
        },
      ],
    },
  ],
  access: [
    {
      title: 'Permissions',
      rows: [
        {
          kind: 'choice',
          path: 'defaultAccess',
          title: 'Default access',
          help: 'Starting access for new threads. Existing threads keep theirs.',
          words: 'permissions edits auto full',
          options: [
            { value: 'edits', label: 'Allow edits' },
            { value: 'auto', label: 'Auto' },
            { value: 'full', label: 'Full access' },
          ],
        },
      ],
    },
  ],
  workflows: [
    {
      title: 'Goals',
      rows: [
        {
          kind: 'choice',
          path: 'goals.mode',
          title: 'Automatic goals',
          help: 'Let the agent set a goal for longer tasks. When off, start one with /goal. Applies when a thread starts or restarts.',
          words: 'goal auto manual off automatic completion continue unfinished',
          options: [
            { value: 'auto', label: 'On' },
            { value: 'manual', label: 'Off' },
          ],
        },
        {
          kind: 'choice',
          path: 'goals.maxTurns',
          title: 'Maximum continuation turns',
          help: "How many follow-up turns a goal may take on its own. Your messages and the first turn don't count.",
          words: 'goal max limit budget unlimited retry available quota reset custom turn limit',
          options: [...choice([3, 5, 10, 25, 50, 100], (n) => count(Number(n))), { value: null, label: 'Unlimited' }],
        },
      ],
    },
    {
      title: 'Sub-agents',
      rows: [
        {
          kind: 'choice',
          path: 'subagents.maxConcurrent',
          title: 'At once per thread',
          help: 'Additional sub-agents wait for an available slot.',
          words: 'subagent concurrent parallel helpers limit',
          options: choice([1, 2, 3, 4, 5, 6, 7, 8], (n) => count(Number(n))),
        },
        {
          kind: 'toggle',
          path: 'subagents.isolate',
          title: 'Separate checkout for each',
          help: 'Run each sub-agent in a separate checkout. Apply its changes back when finished; keep conflicts for review.',
          words: 'subagent isolate worktree copy',
        },
        {
          kind: 'toggle',
          path: 'subagents.shareContext',
          title: 'Share thread context',
          help: "Attach the thread's recent transcript to each sub-agent's task.",
          words: 'subagent transcript context share',
        },
      ],
    },
  ],
  memory: [
    {
      title: 'Memory',
      rows: [
        {
          kind: 'toggle',
          path: 'memory.enabled',
          title: 'Shared memory',
          help: "Agents of every provider read and write Ramu's shared memory.",
          words: 'memory remember recall learn preferences claude codex opencode providers',
        },
        {
          kind: 'toggle',
          path: 'memory.dream',
          title: 'Memory cleanup',
          help: 'Periodically merge duplicates, resolve contradictions and retire stale notes. Uses model tokens.',
          words: 'memory consolidate merge duplicates stale contradictions cleanup self improve tokens',
          when: { path: 'memory.enabled', equals: true },
        },
        {
          kind: 'choice',
          path: 'memory.staleAfterDays',
          title: 'Archive unused memories after',
          help: 'Unused, low-importance memories are archived after this long.',
          words: 'memory stale decay archive expire days',
          options: choice([30, 60, 90, 180, 365], days),
          when: { path: 'memory.enabled', equals: true },
        },
      ],
    },
    {
      title: 'Recall',
      rows: [
        {
          kind: 'toggle',
          path: 'intelligence.crossThreadRecall',
          title: 'Recall past conversations',
          help: 'Let agents search and recall your earlier threads. Turning it off blocks new recalls at once and keeps your history.',
          words: 'search history cross thread previous conversations remember',
        },
      ],
    },
    {
      title: 'What Ramu learned',
      rows: [
        {
          kind: 'choice',
          path: 'intelligence.summaryInterval',
          title: 'Learning summaries',
          help: 'How often Ramu writes up what it learned. Uses model tokens.',
          words: 'recap summary daily weekly digest learned',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ],
        },
        {
          kind: 'toggle',
          path: 'intelligence.summaryMemory',
          title: 'Include memories',
          words: 'summary recap memories',
        },
        {
          kind: 'toggle',
          path: 'intelligence.summarySkills',
          title: 'Include skills',
          words: 'summary recap skills',
        },
      ],
    },
    {
      title: 'Skills',
      rows: [
        {
          kind: 'choice',
          path: 'intelligence.learning',
          title: 'Automatic learning',
          help: 'Let Ramu turn finished threads into skills and memories.',
          words: 'self improve skills consolidate review maintenance ask first',
          options: [
            { value: 'auto', label: 'Automatic' },
            { value: 'review', label: 'Ask first' },
            { value: 'off', label: 'Off' },
          ],
        },
        {
          kind: 'choice',
          path: 'intelligence.dailyReviews',
          title: 'Reviews per day',
          help: 'Maximum daily learning reviews. Each one uses model tokens.',
          words: 'maximum daily limit tokens learning',
          options: choice([1, 3, 5, 10, 20], (n) => count(Number(n))),
        },
        {
          kind: 'model',
          path: 'intelligence.maintenanceModel',
          title: 'Model for background maintenance',
          help: 'Used for learning reviews and memory cleanup. A cheaper model keeps token use low.',
          words: 'background model cheap tokens learning cleanup maintenance',
          emptyLabel: 'Same as thread',
        },
        {
          kind: 'choice',
          path: 'intelligence.archiveSkillDays',
          title: 'Archive unused skills after',
          help: 'Skills that no thread has used are archived after this long.',
          words: 'skill stale expire days',
          options: choice([30, 60, 90, 180, 365], days),
        },
      ],
    },
  ],
  notifications: [
    {
      title: 'Host alerts',
      rows: [
        {
          kind: 'toggle',
          path: 'notifyAgentDone',
          title: 'Notifications on the host',
          help: 'Show desktop notifications on this host when an agent finishes, needs input, or fails. Phone alerts are controlled above.',
          words: 'notify notification alert done finished system toast',
        },
      ],
    },
  ],
  system: [
    {
      title: 'Background service',
      rows: [
        {
          kind: 'toggle',
          path: 'localCrashReports',
          title: 'Keep local crash reports',
          help: 'Off by default. Keep sanitized service errors and local crash dumps on the host. Nothing is uploaded.',
          words: 'diagnostics privacy errors crash local export',
        },
        {
          kind: 'toggle',
          path: 'keepAwake',
          title: 'Keep host awake',
          help: 'Stop the host sleeping from idle while the service runs. Display sleep and manual sleep still work.',
          words: 'sleep awake caffeinate power battery background installed login',
        },
        {
          kind: 'choice',
          path: 'keepAwakeWhen',
          title: 'When to keep awake',
          help: 'Choose whether to keep awake on battery power.',
          words: 'battery power plugged in',
          options: [
            { value: 'plugged-in', label: 'Plugged in only' },
            { value: 'always', label: 'Plugged in and on battery' },
          ],
          when: { path: 'keepAwake', equals: true },
        },
      ],
    },
    {
      title: 'Daily recaps',
      rows: [
        {
          kind: 'toggle',
          path: 'recapsEnabled',
          title: 'Daily recaps',
          help: 'Show recent threads and unfinished work on Home. Uses model tokens to write the summary.',
          words: 'recap summary home tokens',
        },
        {
          kind: 'choice',
          path: 'recapTime',
          title: 'Generate daily at',
          help: 'Create the recap at this time in the host’s timezone.',
          words: 'recap time schedule timezone',
          options: hours.map((value) => ({ value, label: value })),
          when: { path: 'recapsEnabled', equals: true },
        },
      ],
    },
    {
      title: 'Updates',
      rows: [
        {
          kind: 'toggle',
          path: 'appUpdateChecks',
          title: 'Check app updates',
          help: 'Look for new Ramu releases on the host.',
          words: 'release version check',
        },
        {
          kind: 'toggle',
          path: 'appAutoUpdate',
          title: 'Install updates automatically',
          help: 'Download and install new Ramu releases on the host when they are found.',
          words: 'release version auto download install',
        },
      ],
    },
  ],
}

/** Settings that live on this phone, for search. Their pages draw them directly. */
const PHONE_ENTRIES: { section: SettingsSection; title: string; words: string }[] = [
  { section: 'chats', title: 'Messages while working, on this phone', words: 'queue steer steering enter busy' },
  { section: 'chats', title: 'Warn before changing model, on this phone', words: 'model switch cache usage warning' },
  { section: 'appearance', title: 'Theme', words: 'light dark system appearance mode' },
  { section: 'appearance', title: 'Language', words: 'bahasa indonesia english' },
  { section: 'appearance', title: 'Haptic feedback', words: 'vibration taps feel' },
  { section: 'appearance', title: 'Voice input', words: 'microphone dictation speech voice dictate language' },
  { section: 'notifications', title: 'Background alerts', words: 'push notifications needs attention' },
  { section: 'notifications', title: 'Live Activities', words: 'lock screen dynamic island ongoing work ios' },
  {
    section: 'computer',
    title: 'Computer use',
    words: 'screen display desktop control agent app pointer accessibility screen recording share',
  },
  { section: 'remote', title: 'Paired hosts', words: 'pair connect switch host reconnect revoke forget hosts' },
  { section: 'archived', title: 'Archived threads', words: 'history restore unarchive delete' },
  { section: 'agent-setup', title: 'MCP servers', words: 'shared tools external service connection skills' },
  { section: 'memory', title: 'Memories', words: 'remember forget saved memory archive restore' },
]

const offered = (row: SettingRow, known: ReadonlySet<string>) => known.has(row.path)

/** One computer-side row for a section, hiding rows its server doesn't offer or whose condition isn't met. */
export function visibleGroups(
  section: SettingsSection,
  settings: SharedSetting[],
  /** Reads a setting's current value, including optimistic edits. */
  read: (path: string) => unknown = (path) => settings.find((setting) => setting.path === path)?.value,
): RowGroup[] {
  const known = new Set(settings.map((setting) => setting.path))
  return (SETTINGS_ROWS[section] ?? [])
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => offered(row, known) && (!row.when || read(row.when.path) === row.when.equals)),
    }))
    .filter((group) => group.rows.length)
}

/** The choices a row offers on this computer: the server's own enum and numeric range win over the phone's list. */
export function allowedOptions(options: Option[], schema: SettingSchema | undefined, current: unknown): Option[] {
  const enumValues = schema?.enum
  const minimum = typeof schema?.minimum === 'number' ? schema.minimum : -Infinity
  const maximum = typeof schema?.maximum === 'number' ? schema.maximum : Infinity
  const allowed = options.filter(
    (option) =>
      (!enumValues || enumValues.includes(option.value)) &&
      (typeof option.value !== 'number' || (option.value >= minimum && option.value <= maximum)),
  )
  // Never hide the value in force, e.g. a custom turn limit set on the desktop.
  return allowed.some((option) => option.value === current) || current === undefined
    ? allowed
    : [{ value: current as Value, label: String(current) }, ...allowed]
}

/** The edit that `settings.app.patch` expects: path, the server's schema, and the value before and after. */
export function buildEdit(setting: SharedSetting, value: unknown): SettingEdit {
  return { path: setting.path, schema: setting.schema, before: setting.value, value }
}

export function applyValue(snapshot: SettingsSnapshot, path: string, value: unknown): SettingsSnapshot {
  return {
    ...snapshot,
    settings: snapshot.settings.map((setting) => (setting.path === path ? { ...setting, value } : setting)),
  }
}

export interface SearchHit {
  section: SettingsSection
  title: string
}

const norm = (text: string) => text.toLowerCase()
/** Every word of the query must appear in the title, the section name or the row's search terms. */
export function searchSettings(
  query: string,
  settings: SharedSetting[] | null,
  /** Translates a section name, so a search in the phone's language finds its page too. */
  say: (text: string) => string = (value) => value,
): SearchHit[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const known = settings ? new Set(settings.map((setting) => setting.path)) : null
  const candidates: (SearchHit & { words: string })[] = [
    ...Object.entries(SETTINGS_ROWS).flatMap(([section, groups]) =>
      (groups ?? []).flatMap((group) =>
        group.rows
          // Before a computer has answered, offer every row; after, only the ones it has.
          .filter((row) => !known || offered(row, known))
          .map((row) => ({
            section: section as SettingsSection,
            title: row.title,
            words: `${group.title ?? ''} ${row.words ?? ''}`,
          })),
      ),
    ),
    {
      section: 'agent-setup',
      title: 'Rules',
      words: 'instructions guidance agent setup history revisions aturan instruksi',
    },
    ...PHONE_ENTRIES,
  ]
  return candidates
    .map((entry) => {
      const title = norm(entry.title)
      const label = sectionLabel(entry.section)
      const haystack = `${title} ${norm(label)} ${norm(say(label))} ${norm(entry.words)}`
      if (!words.every((word) => haystack.includes(word))) return null
      return {
        entry,
        score: words.filter((word) => title.includes(word)).length * 2 + (title.startsWith(words[0]!) ? 1 : 0),
      }
    })
    .filter((hit): hit is NonNullable<typeof hit> => !!hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ entry }) => ({ section: entry.section, title: entry.title }))
}

/** The store's typed `invoke`, seen as the plain call these helpers make with method names they have checked themselves. */
export type LooseInvoke = (computerId: string, method: string, ...args: unknown[]) => Promise<unknown>
export const looseInvoke = (invoke: unknown) => invoke as LooseInvoke

/** The two host methods settings need; the store's `invoke` satisfies it. */
export interface SettingsHost {
  (method: 'settings.app.snapshot'): Promise<SettingsSnapshot>
  (method: 'settings.app.patch', edits: SettingEdit[]): Promise<SettingsSnapshot>
}

/** Saves one setting against what the computer last confirmed, so a change made on the desktop meanwhile is not overwritten blindly. */
export async function patchSetting(host: SettingsHost, confirmed: SettingsSnapshot, path: string, value: unknown) {
  const setting = confirmed.settings.find((entry) => entry.path === path)
  if (!setting) throw new Error(`This host has no “${path}” setting.`)
  return host('settings.app.patch', [buildEdit(setting, value)])
}

/** Changes one setting without a page of settings open, e.g. "don't warn again" from a thread. */
export async function setHostSetting(invoke: LooseInvoke, computerId: string, path: string, value: unknown) {
  const host = ((method: string, ...args: unknown[]) => invoke(computerId, method, ...args)) as SettingsHost
  return patchSetting(host, await host('settings.app.snapshot'), path, value)
}

/** The option the host's two stored values stand for, with the options to offer (the hidden fourth only while it is stored). */
export function limitChoiceState(read: (path: string) => unknown, row: { path: string; resumePath: string }) {
  const current = limitChoiceOf({
    defaultAutoFallback: read(row.path) === true,
    fallback: { autoResume: read(row.resumePath) as boolean | undefined },
  })
  return { current, options: limitChoiceOptions(current) as { value: LimitChoice; label: string }[] }
}

/** The settings to save for a choice: both stored values, leaving out one that is already right. */
export function limitChoiceEdits(
  choice: LimitChoice,
  read: (path: string) => unknown,
  row: { path: string; resumePath: string },
): [path: string, value: boolean][] {
  const patch = limitChoicePatch(choice)
  const edits: [string, boolean][] = [
    [row.path, patch.defaultAutoFallback],
    [row.resumePath, patch.autoResume],
  ]
  return edits.filter(([path, value]) => read(path) !== value)
}
