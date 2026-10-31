import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { cn } from 'cn'
import { SettingsTargetSelector, SettingsScopeContext } from './SettingsScope'
import { t, useLanguage } from '../i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import {
  Archive,
  MessageSquare,
  Brain,
  CalendarClock,
  Code,
  Cpu,
  GitBranch,
  Globe,
  MonitorCog,
  Keyboard,
  Layers,
  Palette,
  ShieldCheck,
  MonitorSmartphone,
  Plug,
  Target,
  Variable,
  X,
  type LucideIcon,
} from 'lucide-react'
import { SearchInput } from '../SearchInput'
import { fuzzy } from '../lib/fuzzy'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { APP_AUTO_UPDATE } from '@ramu/shared/updates'
import { useComputers } from '../workspace/computers'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { PermissionNeeded } from './DevicePermissions'

export const SETTINGS_GROUPS = ['Workspace', 'Agents', 'System'] as const

export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance', Icon: Palette, group: 'Workspace' },
  { id: 'editor', label: 'Editor & Terminal', Icon: Code, group: 'Workspace' },
  { id: 'git', label: 'Git', Icon: GitBranch, group: 'Workspace' },
  { id: 'browser', label: 'Browser', Icon: Globe, group: 'Workspace' },
  { id: 'computer', label: 'Computer use', Icon: MonitorCog, group: 'Workspace' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', Icon: Keyboard, group: 'Workspace' },
  { id: 'archived', label: 'Archived threads', Icon: Archive, group: 'Workspace' },
  { id: 'chats', label: 'Threads', Icon: MessageSquare, group: 'Agents' },
  { id: 'providers', label: 'Providers', Icon: Cpu, group: 'Agents' },
  { id: 'models', label: 'Models', Icon: Layers, group: 'Agents' },
  { id: 'environment', label: 'Environment variables', Icon: Variable, group: 'Agents' },
  { id: 'agent-setup', label: 'Agent setup', Icon: Plug, group: 'Agents' },
  { id: 'access', label: 'Permissions', Icon: ShieldCheck, group: 'Agents' },
  { id: 'workflows', label: 'Goals & delegation', Icon: Target, group: 'Agents' },
  { id: 'memory', label: 'Memory & skills', Icon: Brain, group: 'Agents' },
  { id: 'system', label: 'Background & updates', Icon: CalendarClock, group: 'System' },
  { id: 'remote', label: 'Remote access', Icon: MonitorSmartphone, group: 'System' },
] as const satisfies readonly { id: string; label: string; Icon: LucideIcon; group: (typeof SETTINGS_GROUPS)[number] }[]
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

/** Every individual setting, so search finds "Primary color" and jumps to it, not just the page it lives on. */
const SETTINGS_INDEX: { section: SettingsSection; title: string; words?: string }[] = [
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
  { section: 'archived', title: 'Archived threads', words: 'history restore unarchive delete' },
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
  { section: 'git', title: 'GitHub', words: 'github gh account pull requests issues hosting' },
  { section: 'git', title: 'GitLab', words: 'gitlab merge requests pipelines glab hosting' },
  { section: 'git', title: 'Bitbucket Cloud', words: 'bitbucket pull requests hosting coming soon' },
  { section: 'git', title: 'Azure DevOps', words: 'azure devops repos pull requests hosting coming soon' },
  { section: 'git', title: 'Automatic pull', words: 'git auto fetch remote fast-forward background sync' },
  {
    section: 'git',
    title: 'Automatically watch pull requests',
    words: 'pr auto checks reviews feedback thread background',
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
  {
    section: 'chats',
    title: 'Trim long Claude threads before they go cold',
    words: 'compact compaction idle prompt cache expire summarize context tokens cost',
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
    section: 'environment',
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
  { section: 'workflows', title: 'Where sub-agents run', words: 'subagent native provider cross delegate' },
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
  { section: 'chats', title: 'Messages while working', words: 'queue steer steering enter busy' },
  { section: 'chats', title: 'Include open tabs as context', words: 'files mention' },
  { section: 'chats', title: 'Delete archived threads after', words: 'cleanup retention history delete days' },
  { section: 'git', title: 'Commit messages', words: 'style conventional repository custom instructions generated' },
  { section: 'git', title: 'Commit message model', words: 'ai draft default model effort' },
  { section: 'git', title: 'Commit instructions', words: 'custom message ticket language subject' },
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
  { section: 'remote', title: 'Pair a device', words: 'pairing code link phone another host connect add' },
  { section: 'remote', title: 'Paired devices', words: 'revoke remove devices access token' },
  {
    section: 'remote',
    title: 'Connect to a host',
    words: 'remote server use another host switch host pair address link ssh alias tunnel',
  },
]

export function SettingsPage({
  section,
  target,
  onSection,
  children,
  busy,
  hasChanges,
  error,
  onSave,
  onClose,
  navigationLocked = false,
}: {
  navigationLocked?: boolean
  section: SettingsSection
  target?: string
  onSection: (section: SettingsSection) => void
  children: ReactNode
  busy: boolean
  hasChanges: boolean
  error: string | null
  onSave: () => void
  onClose: () => void
}) {
  useLanguage()
  useComputers()
  const scope = useContext(SettingsScopeContext)
  const [query, setQuery] = useState('')
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    host.current?.querySelector('.settings-page-content')?.scrollTo({ top: 0 })
  }, [section])
  const q = query.trim()
  const results = q
    ? SETTINGS_INDEX.map((source) => {
        const entry = { ...source, title: t(source.title) }
        const title = fuzzy(q, entry.title),
          words = fuzzy(
            q,
            `${entry.title} ${source.title} ${entry.words ?? ''} ${t(SETTINGS_SECTIONS.find((item) => item.id === entry.section)!.label)}`,
          )
        return title || words
          ? { entry, hits: title?.hits ?? [], score: (title?.score ?? 0) * 2 + (words?.score ?? 0) }
          : null
      })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
    : []
  /** Scrolls to the row with this title and flashes it, once the page has rendered. */
  const reveal = (title: string) =>
    window.setTimeout(() => {
      const rows = [
        ...(host.current?.querySelectorAll<HTMLElement>(
          '.settings-page-content .settings-row, .settings-page-content label, .settings-page-content h4, .settings-page-content strong',
        ) ?? []),
      ]
      const row = rows.find((element) =>
        element.textContent?.trim().toLowerCase().startsWith(title.toLowerCase().slice(0, 12)),
      )
      const target = row?.closest<HTMLElement>('.settings-row') ?? row
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target?.classList.add('flash')
      window.setTimeout(() => target?.classList.remove('flash'), 1400)
    }, 60)
  useEffect(() => {
    if (target) reveal(t(target))
  }, [target])
  const open = (entry: { section: SettingsSection; title: string }) => {
    setQuery('')
    onSection(entry.section)
    reveal(entry.title)
  }
  const title = (text: string, hits: number[]) =>
    hits.length ? [...text].map((char, i) => (hits.includes(i) ? <mark key={i}>{char}</mark> : char)) : text
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) return
        if (busy) details.cancel()
        else onClose()
      }}
    >
      <DialogContent
        ref={host}
        className="settings-page [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:p-0 [[data-slot='dialog-content']&]:gap-0 [&[data-slot='dialog-content']]:w-[min(1000px,_calc(100vw_-_48px))] flex flex-col w-[min(1000px,_100%)] h-[min(780px,_calc(100vh_-_48px))] min-h-0 bg-canvas [border:1px_solid_var(--edge)] rounded-(--radius-xl) [box-shadow:0_24px_80px_rgba(0,0,0,.45)] overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={() => host.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? true}
      >
        <header className="settings-page-header [&_h2]:m-0 whitespace-nowrap [&_h2]:text-heading [&_h2]:font-semibold [&_[data-slot='dialog-title']]:m-0 flex items-center gap-3 min-h-[58px] p-[12px_20px]">
          <DialogTitle>{t('Settings')}</DialogTitle>
          <span className="grow flex-1 min-w-0 text-left" />
          <SettingsTargetSelector disabled={busy || hasChanges} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center"
            aria-label={t('Close settings')}
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </header>
        {scope && (
          <div
            className="flex min-h-10 flex-nowrap items-center gap-3 border-b border-line px-5 py-1.5 text-caption text-muted-foreground"
            role="status"
          >
            <span className="min-w-0 grow truncate">
              {scope.loading
                ? t('Loading settings…')
                : scope.targets.some((entry) => entry.error)
                  ? scope.targets
                      .filter((entry) => entry.error)
                      .map((entry) => `${entry.name}: ${entry.error}`)
                      .join(' · ')
                  : scope.readOnlyHosts.length
                    ? `${scope.readOnlyHosts.join(', ')}: ${t(VIEW_ONLY_WRITE_NOTICE)}`
                    : (scope.message ??
                      (scope.target === 'all'
                        ? t('Changes apply to {0} connected hosts. Offline hosts keep their settings.', {
                            0: scope.targets.length,
                          })
                        : t('Changes apply to the selected host.')))}
            </span>
            {scope.permissionHosts.map((host) => (
              <PermissionNeeded key={host} host={host} permission="settings" />
            ))}
            {scope.restartTarget && (
              <Button
                size="sm"
                disabled={busy || scope.loading || scope.restarting}
                onClick={() => void scope.restart()}
              >
                {scope.restarting ? t('Restarting…') : t('Restart background service')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="flex-none whitespace-nowrap"
              disabled={busy || scope.loading || scope.restarting}
              onClick={() => scope.reload()}
            >
              {hasChanges ? t('Discard changes and reload') : t('Reload settings')}
            </Button>
          </div>
        )}
        <div className="settings-page-body flex flex-1 min-h-0">
          <nav
            className="settings-navigation [&_.settings-nav-button]:[border:0] [&_.settings-nav-button]:bg-transparent [&_.settings-nav-button]:text-soft [&_.settings-nav-button]:justify-start [&_.settings-nav-button]:text-left [&_.settings-nav-button]:min-h-8 [&_.settings-nav-button]:p-[0_12px] [&_.settings-nav-button]:rounded-(--radius-s) [&_.settings-nav-button]:text-control [&_.settings-nav-button.on]:text-foreground [&_.settings-nav-button.on]:bg-accent [&_.settings-nav-button.on]:font-medium [&_.settings-nav-button]:flex [&_.settings-nav-button]:items-center [&_.settings-nav-button]:gap-2.5 [&_.settings-nav-button]:whitespace-normal [&_.settings-nav-button]:py-1 [&_.settings-nav-button]:leading-5 [&_.settings-nav-button_svg]:flex-none [&_.settings-nav-button_svg]:text-muted-foreground [&_.settings-nav-button.on_svg]:text-brand flex-none [background:var(--sidebar)] p-[16px_10px] flex flex-col overflow-y-auto gap-0.5 w-[240px]"
            aria-label={t('Settings sections')}
          >
            <SearchInput
              className="settings-search m-[0_0_12px]"
              aria-label={t('Find settings')}
              placeholder={t('Search settings')}
              value={query}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && results[0] && !navigationLocked) open(results[0].entry)
                if (event.key === 'Escape' && query) {
                  event.stopPropagation()
                  setQuery('')
                }
              }}
            />
            {q ? (
              results.length ? (
                results.map(({ entry, hits }) => {
                  const Icon = SETTINGS_SECTIONS.find((item) => item.id === entry.section)!.Icon
                  return (
                    <Button
                      variant="secondary"
                      key={`${entry.section}:${entry.title}`}
                      className="settings-nav-button bg-fill hover:bg-fill-hover settings-result [&_svg]:mt-[3px] items-start! h-auto! min-h-10! p-[7px_12px]!"
                      disabled={busy || navigationLocked}
                      onClick={() => open(entry)}
                    >
                      <Icon size={14} />
                      <span className="settings-result-text flex flex-col min-w-0 gap-px">
                        <span className="settings-result-title">{title(entry.title, hits)}</span>
                        <span className="muted text-muted-foreground small text-caption">
                          {t(SETTINGS_SECTIONS.find((item) => item.id === entry.section)!.label)}
                        </span>
                      </span>
                    </Button>
                  )
                })
              ) : (
                <p className="muted text-muted-foreground small text-caption settings-search-empty p-[0_12px]">
                  {t('No settings match “')}
                  {q}”.
                </p>
              )
            ) : (
              SETTINGS_GROUPS.map((group) => (
                <div
                  key={group}
                  role="group"
                  aria-label={t(group)}
                  className="settings-nav-group flex flex-col gap-0.5"
                >
                  <h4 className="m-0 px-3 pt-3 pb-1.5 text-caption font-medium text-muted-foreground">{t(group)}</h4>
                  {SETTINGS_SECTIONS.filter((entry) => entry.group === group).map((entry) => (
                    <Button
                      variant="secondary"
                      key={entry.id}
                      aria-current={entry.id === section ? 'page' : undefined}
                      className={cn('settings-nav-button', entry.id === section && 'on')}
                      disabled={busy || navigationLocked}
                      onClick={() => onSection(entry.id)}
                    >
                      <entry.Icon size={15} />
                      {t(entry.label)}
                    </Button>
                  ))}
                </div>
              ))
            )}
          </nav>
          <div className="settings-page-content [&_>_h3]:text-heading [&_>_h3]:font-semibold [&_>_h3]:m-[0_0_20px] [&_.flash:not(.settings-row)]:[animation:settings-flash_1.4s_ease-out] [&_.flash:not(.settings-row)]:rounded-(--radius-s) [&_.settings-form_>_div_>_h4]:m-[18px_0_10px] [&_.settings-form_>_div_>_p]:m-[8px_0_12px] [&_.settings-form_>_div_>_p]:leading-[1.55] flex-1 min-w-0 overflow-y-auto p-[24px_28px]">
            <h3>{t(SETTINGS_SECTIONS.find((entry) => entry.id === section)!.label)}</h3>
            <fieldset
              className="settings-fields p-0 m-0 [border:0] min-w-0"
              disabled={busy || scope?.loading || (scope && !scope.ready) || undefined}
            >
              {!scope || scope.ready ? (
                <div key={scope?.loadKey}>{children}</div>
              ) : (
                <p className="text-muted-foreground">
                  {scope.loading ? t('Loading settings…') : t('Settings are unavailable for the selected environment.')}
                </p>
              )}
            </fieldset>
          </div>
        </div>
        <footer className="settings-page-footer border-t border-line [&_.error]:flex-1 [&_.error]:[overflow-wrap:anywhere] flex-none flex items-center gap-2 p-[12px_20px] min-h-[58px]">
          {error && (
            <span className="error text-bad small text-caption" role="alert">
              {error}
            </span>
          )}
          <span className="grow flex-1 min-w-0 text-left" />
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            className={PRIMARY_ACTION_CLASS}
            disabled={
              busy ||
              !hasChanges ||
              (scope && !scope.ready) ||
              !!scope?.readOnlyHosts.length ||
              !!scope?.permissionHosts.length ||
              undefined
            }
            onClick={onSave}
          >
            {busy ? t('Saving…') : t('Save changes')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
