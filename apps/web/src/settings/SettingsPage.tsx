import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { SETTINGS_MENU, SETTINGS_MENU_GROUPS, type SettingsMenuId } from '@ramu/shared/settingsMenu'
import { cn } from 'cn'
import { SettingsTargetSelector, SettingsScopeContext } from './SettingsScope'
import { SettingsAccountRow } from './AccountProfile'
import { t, useLanguage } from '../i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { openFoldAround } from '@/components/settings-row'
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
  Smartphone,
  Target,
  Puzzle,
  CircleUserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { SearchInput } from '../SearchInput'
import { searchSettings, type SettingsSearchResult } from './settingsSearch'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useComputers } from '../workspace/computers'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { PermissionNeeded } from './DevicePermissions'
import { revealFound } from '../lib/revealFound'
import { openArchivedThreads } from '../sidebar/projects/threadLists'

export const SETTINGS_GROUPS = SETTINGS_MENU_GROUPS

const SECTION_ICONS: Record<SettingsMenuId, LucideIcon> = {
  appearance: Palette,
  editor: Code,
  git: GitBranch,
  browser: Globe,
  computer: MonitorCog,
  devices: Smartphone,
  shortcuts: Keyboard,
  chats: MessageSquare,
  providers: Cpu,
  models: Layers,
  'agent-setup': Plug,
  plugins: Puzzle,
  identities: UsersRound,
  account: CircleUserRound,
  access: ShieldCheck,
  workflows: Target,
  memory: Brain,
  system: CalendarClock,
  remote: MonitorSmartphone,
}

/** The shared menu (`@ramu/shared/settingsMenu`), which the phone draws too, with the desktop's icons. */
// Plugins live in Customize on the desktop, beside skills and MCP servers; the phone keeps its own Plugins page.
export const SETTINGS_SECTIONS = SETTINGS_MENU.filter((entry) => entry.id !== 'plugins').map((entry) => ({
  ...entry,
  Icon: SECTION_ICONS[entry.id],
}))
export type SettingsSection = SettingsMenuId

function ResultIcon({ result }: { result: SettingsSearchResult }) {
  const Icon = result.kind === 'page' ? SECTION_ICONS[result.section] : Archive
  return <Icon size={14} />
}

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
  /** The row to scroll to and highlight; a new object asks again for the same row. */
  target?: { title: string }
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
  const results = searchSettings(q, t, (section) => SETTINGS_SECTIONS.find((item) => item.id === section)!.label)
  const choose = (result: SettingsSearchResult) => {
    if (result.kind === 'page') return open({ section: result.section, title: result.title })
    setQuery('')
    // Unsaved changes keep Settings open beneath the view rather than discarding them.
    if (!hasChanges) onClose()
    openArchivedThreads()
  }
  /**
   * Scrolls to the row with this title and highlights it. A section can still be loading its host settings, so the row is
   * looked for over a few frames; the highlight starts once the scroll settles, so it is seen rather than spent mid-scroll.
   */
  const reveal = (title: string) => {
    const wanted = title.trim().toLowerCase()
    const find = () => {
      const rows = [
        ...(host.current?.querySelectorAll<HTMLElement>(
          '.settings-page-content .settings-row, .settings-page-content label, .settings-page-content h4, .settings-page-content strong',
        ) ?? []),
      ]
      // An exact title wins over a row that only starts the same way.
      const text = (element: HTMLElement) => element.textContent?.trim().toLowerCase() ?? ''
      const row =
        rows.find((element) => text(element) === wanted) ??
        rows.find((element) => text(element).startsWith(wanted)) ??
        rows.find((element) => text(element).startsWith(wanted.slice(0, 12)))
      return row?.closest<HTMLElement>('.settings-row') ?? row
    }
    let tries = 0
    const attempt = () => {
      const target = find()
      // A folded row is found but has no place on screen until its Advanced fold opens.
      if (target && tries++ < 40 && openFoldAround(target)) window.requestAnimationFrame(attempt)
      else if (target) revealFound(target, target.closest<HTMLElement>('.settings-page-content'))
      else if (++tries < 40) window.requestAnimationFrame(attempt)
    }
    window.requestAnimationFrame(attempt)
  }
  useEffect(() => {
    if (target) reveal(t(target.title))
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
                        ? scope.targets.length === 1
                          ? t('Changes apply to the connected host. Offline hosts keep their settings.')
                          : t('Changes apply to {0} connected hosts. Offline hosts keep their settings.', {
                              0: scope.targets.length,
                            })
                        : t('Changes apply to the selected host.')))}
            </span>
            {scope.permissionHosts.map((host) => (
              <PermissionNeeded key={host} host={host} permission="settings" />
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="flex-none whitespace-nowrap"
              disabled={busy || scope.loading}
              onClick={() => scope.reload()}
            >
              {hasChanges ? t('Discard changes and reload') : t('Reload settings')}
            </Button>
          </div>
        )}
        <div className="settings-page-body flex flex-1 min-h-0">
          <nav
            className="settings-navigation [&_.settings-nav-button]:[border:0] [&_.settings-nav-button]:bg-transparent [&_.settings-nav-button]:text-soft [&_.settings-nav-button]:justify-start [&_.settings-nav-button]:text-left [&_.settings-nav-button]:min-h-8 [&_.settings-nav-button]:p-[0_12px] [&_.settings-nav-button]:rounded-(--radius-s) [&_.settings-nav-button]:text-control [&_.settings-nav-button:not(.on):not(:disabled):hover]:bg-hover [&_.settings-nav-button:not(.on):not(:disabled):hover]:text-foreground [&_.settings-nav-button.on]:text-foreground [&_.settings-nav-button.on]:bg-accent [&_.settings-nav-button.on]:font-medium [&_.settings-nav-button]:flex [&_.settings-nav-button]:items-center [&_.settings-nav-button]:gap-2.5 [&_.settings-nav-button]:whitespace-normal [&_.settings-nav-button]:py-1 [&_.settings-nav-button]:leading-5 [&_.settings-nav-button_svg]:flex-none [&_.settings-nav-button_svg]:text-muted-foreground [&_.settings-nav-button.on_svg]:text-brand flex-none [background:var(--sidebar)] p-[16px_10px] flex flex-col overflow-y-auto gap-0.5 w-[240px]"
            aria-label={t('Settings sections')}
          >
            <SettingsAccountRow disabled={busy || navigationLocked} onOpen={() => onSection('account')} />
            <SearchInput
              className="settings-search m-[0_0_12px]"
              aria-label={t('Find settings')}
              placeholder={t('Search settings')}
              value={query}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && results[0] && !navigationLocked) choose(results[0])
                if (event.key === 'Escape' && query) {
                  event.stopPropagation()
                  setQuery('')
                }
              }}
            />
            {q ? (
              results.length ? (
                results.map((result) => (
                  <Button
                    variant="secondary"
                    key={result.key}
                    className="settings-nav-button bg-fill hover:bg-fill-hover settings-result [&_svg]:mt-[3px] items-start! h-auto! min-h-10! p-[7px_12px]!"
                    disabled={busy || navigationLocked}
                    onClick={() => choose(result)}
                  >
                    <ResultIcon result={result} />
                    <span className="settings-result-text flex flex-col min-w-0 gap-px">
                      <span className="settings-result-title">{title(result.title, result.hits)}</span>
                      <span className="muted text-muted-foreground small text-caption">{t(result.label)}</span>
                    </span>
                  </Button>
                ))
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
          <div className="settings-page-content [&_>_h3]:text-heading [&_>_h3]:font-semibold [&_>_h3]:m-[0_0_20px] [&_.settings-form_>_div_>_h4]:m-[18px_0_10px] [&_.settings-form_>_div_>_p]:m-[8px_0_12px] [&_.settings-form_>_div_>_p]:leading-[1.55] flex-1 min-w-0 overflow-y-auto p-[24px_28px]">
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
