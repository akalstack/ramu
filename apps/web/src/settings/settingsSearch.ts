import type { SettingsMenuId } from '@ramu/shared/settingsMenu'
import { APP_AUTO_UPDATE } from '@ramu/shared/updates'
import { fuzzy } from '../lib/fuzzy'

/** Every individual setting, so search finds "Primary color" and jumps to it, not just the page it lives on. */
const SETTINGS_INDEX: { section: SettingsMenuId; title: string; words?: string }[] = [
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
  { section: 'system', title: 'Keep local crash reports', words: 'diagnostics privacy errors crash local export' },
  {
    section: 'git',
    title: 'Default workspace for new threads',
    words: 'checkout workspace worktree isolation default branch naming prefix',
  },
  { section: 'git', title: 'Worktree branch naming', words: 'semantic custom fixed naming generation' },
  { section: 'git', title: 'Branch naming instructions', words: 'ticket team custom branch' },
  { section: 'git', title: 'Branch prefix', words: 'worktree branch namespace naming' },
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
  { section: 'git', title: 'Automatic pull', words: 'git auto fetch remote fast-forward background sync' },
  {
    section: 'git',
    title: 'Automatically watch pull requests',
    words: 'pr auto checks reviews feedback thread background',
  },
  {
    section: 'git',
    title: 'Remove agent credits',
    words: 'co-author coauthored trailer attribution generated with claude codex commit pull request ai signature',
  },
  ...(APP_AUTO_UPDATE
    ? [
        {
          section: 'system' as const,
          title: 'Auto-update Ramu',
          words: 'app update github release download restart background service version',
        },
      ]
    : []),
  {
    section: 'workflows',
    title: 'Automatic goals',
    words: 'goal auto manual off automatic completion continue unfinished',
  },
  {
    section: 'workflows',
    title: 'Maximum continuation turns',
    words: 'goal max limit budget unlimited retry available quota reset',
  },
  { section: 'workflows', title: 'Custom turn limit', words: 'goal max number turns' },
  {
    section: 'chats',
    title: 'Load tools on demand',
    words: 'tool search tokens deferred optional ramu',
  },
  {
    section: 'memory',
    title: 'Automatic learning',
    words: 'self improve skills consolidate review maintenance ask first',
  },
  {
    section: 'memory',
    title: 'Model for background maintenance',
    words: 'maintenance model cheaper background',
  },
  { section: 'memory', title: 'Reviews per day', words: 'maximum daily limit tokens learning' },
  { section: 'memory', title: 'Archive unused skills after', words: 'skill stale expire days' },
  {
    section: 'memory',
    title: 'Shared memory',
    words: 'memory remember recall learn preferences claude codex opencode providers',
  },
  {
    section: 'memory',
    title: 'Memory cleanup',
    words: 'memory consolidate merge duplicates stale contradictions cleanup self improve tokens',
  },
  { section: 'memory', title: 'Archive unused memories after', words: 'memory stale decay archive expire days' },
  { section: 'chats', title: 'Agent notifications', words: 'notify notification alert done finished system toast' },
  { section: 'chats', title: 'Let agents suggest teammates', words: 'teammate review second model suggest invite' },
  {
    section: 'models',
    title: 'Look up model dates online',
    words: 'legacy new retire deprecated models.dev litellm catalog',
  },
  {
    section: 'chats',
    title: 'Continue threads after restart',
    words: 'resume recover recovery interrupted progress startup crash',
  },
  {
    section: 'chats',
    title: 'Move slow commands to background',
    words:
      'background long running slow dev server watcher build test shell command async auto automatic timeout seconds',
  },
  {
    section: 'chats',
    title: 'Keep working while asking questions',
    words: 'async asynchronous optional blocking related grouped answers pending input',
  },
  { section: 'system', title: 'Daily recaps', words: 'recap summary home tokens' },
  { section: 'system', title: 'Generate daily at', words: 'recap time schedule timezone' },
  {
    section: 'system',
    title: 'Keep host awake',
    words: 'sleep awake caffeinate power battery background installed login',
  },
  { section: 'system', title: 'Background service', words: 'daemon login startup' },
  { section: 'appearance', title: 'Language', words: 'bahasa indonesia english system perangkat' },
  { section: 'appearance', title: 'Primary color', words: 'accent blue violet teal theme' },
  { section: 'appearance', title: 'Interface font', words: 'system geist typeface' },
  { section: 'appearance', title: 'Interface font size', words: 'text size zoom' },
  {
    section: 'appearance',
    title: 'Reduce motion',
    words: 'animation transition accessibility movement reduced motion',
  },
  { section: 'appearance', title: 'Crisper text', words: 'font smoothing antialiasing grayscale' },
  { section: 'appearance', title: 'Layout sizes', words: 'reset width height split terminal' },
  { section: 'editor', title: 'Preview tabs', words: 'single click open file' },
  { section: 'editor', title: 'Default Markdown view', words: 'source edit preview read rendered viewer' },
  { section: 'editor', title: 'Editor font size', words: 'monaco text' },
  { section: 'editor', title: 'Terminal font size', words: 'xterm text' },
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
  { section: 'providers', title: 'Provider update notifications', words: 'latest version check updates automatic' },
  { section: 'models', title: 'Model sets', words: 'steps effort reasoning provider codex claude' },
  { section: 'models', title: 'Default set', words: 'model' },
  { section: 'models', title: 'Default step', words: 'model effort' },
  { section: 'models', title: 'Provider fallback', words: 'limit switch provider' },
  { section: 'access', title: 'Default access', words: 'permissions edits auto full' },
  {
    section: 'models',
    title: 'When a usage limit is reached',
    words:
      'automatic provider fallback limit switch another model wait this model stop decide resume auto-resume reset rate quota',
  },
  { section: 'models', title: 'When to switch', words: 'usage threshold percent 5-hour weekly fallback' },
  { section: 'models', title: 'Fallback order', words: 'provider model effort chain list order' },
  { section: 'models', title: 'Abilities', words: 'image generation web search long documents provider routing' },
  {
    section: 'providers',
    title: 'Google Gemini',
    words: 'media api key video omni flash speech voice narration music lyria',
  },
  { section: 'providers', title: 'ElevenLabs', words: 'media api key speech voice narration music sound effects' },
  { section: 'models', title: 'Ask before using another provider', words: 'ability approval image search provider' },
  { section: 'workflows', title: 'Where sub-agents run', words: 'subagent native provider cross delegate' },
  { section: 'workflows', title: 'Custom agents', words: 'custom agent reusable reviewer recipe' },
  { section: 'chats', title: 'Describe this host', words: 'host description gpu office network suggest continue' },
  { section: 'workflows', title: 'Automatic selection', words: 'subagent model effort automatic cap maximum' },
  { section: 'workflows', title: 'By type', words: 'explore plan subagent type route' },
  { section: 'workflows', title: 'When a sub-agent is limited', words: 'subagent fallback order limit separate same' },
  {
    section: 'workflows',
    title: 'Decide before Codex starts its own sub-agents',
    words: 'codex hook trust intercept spawn_agent config',
  },
  {
    section: 'workflows',
    title: 'Advisor',
    words: 'advisor reviewer review second opinion stronger model consult claude opus gpt cross provider',
  },
  { section: 'workflows', title: 'Advisor model', words: 'advisor reviewer model effort provider' },
  { section: 'workflows', title: 'Always wait for advice', words: 'advisor block blocking async wait continue' },
  { section: 'providers', title: 'Show usage limits', words: 'usage gauge 5-hour weekly plan quota' },
  {
    section: 'chats',
    title: 'Sidebar shows',
    words: 'sidebar projects recent threads activity view list group switch mode',
  },
  {
    section: 'chats',
    title: 'Show branches in projects',
    words: 'sidebar branch git worktree two line row thread project',
  },
  { section: 'chats', title: 'Messages while working', words: 'queue steer steering enter busy' },
  { section: 'chats', title: 'Include open tabs as context', words: 'files mention' },
  { section: 'chats', title: 'Delete archived threads after', words: 'cleanup retention history delete days' },
  {
    section: 'git',
    title: 'Style',
    words: 'commit message pull request title conventional repository custom generated',
  },
  {
    section: 'git',
    title: 'Writing model',
    words: 'ai draft commit message pull request description default model effort',
  },
  { section: 'git', title: 'Writing instructions', words: 'commit message pull request custom instructions' },
  { section: 'git', title: 'Commit from default branch', words: 'feature branch current main push' },
  { section: 'system', title: 'Start at login', words: 'startup launch macos service' },
  { section: 'system', title: 'When to keep awake', words: 'battery power plugged in' },
  { section: 'system', title: 'Check app updates', words: 'release version check' },
  { section: 'models', title: 'Default bar mode', words: 'model effort selection' },
  { section: 'git', title: 'Pull behavior', words: 'rebase merge fast-forward sync' },
  { section: 'chats', title: 'Recent threads per project', words: 'sidebar count project' },
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
]

/** Places search finds that are not Settings pages, such as the sidebar's Archived view. */
const SETTINGS_VIEWS: { view: 'archived'; title: string; words: string; label: string }[] = [
  {
    view: 'archived',
    title: 'Archived threads',
    words: 'archived archive history restore unarchive delete sidebar',
    label: 'Sidebar',
  },
]

export type SettingsSearchResult = { key: string; title: string; hits: number[]; label: string } & (
  { kind: 'page'; section: SettingsMenuId } | { kind: 'view'; view: 'archived' }
)

/**
 * The best dozen matches for `query` among every setting and view, by translated title first, then by its search words
 * and the page it is on. `label` names that page (an English copy key); `title` is already translated.
 */
export function searchSettings(
  query: string,
  translate: (text: string) => string,
  pageLabel: (section: SettingsMenuId) => string,
): SettingsSearchResult[] {
  const q = query.trim()
  if (!q) return []
  const candidates = [
    ...SETTINGS_INDEX.map((source) => ({
      kind: 'page' as const,
      section: source.section,
      key: `${source.section}:${source.title}`,
      source,
      label: pageLabel(source.section),
    })),
    ...SETTINGS_VIEWS.map((source) => ({
      kind: 'view' as const,
      view: source.view,
      key: `view:${source.view}`,
      source,
      label: source.label,
    })),
  ]
  return candidates
    .map(({ source, ...entry }) => {
      const title = translate(source.title)
      const inTitle = fuzzy(q, title),
        inWords = fuzzy(q, `${title} ${source.title} ${source.words ?? ''} ${translate(entry.label)}`)
      if (!inTitle && !inWords) return null
      return {
        ...entry,
        title,
        hits: inTitle?.hits ?? [],
        score: (inTitle?.score ?? 0) * 2 + (inWords?.score ?? 0),
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ score: _score, ...result }) => result)
}
