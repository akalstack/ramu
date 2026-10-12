import { t, useLanguage } from './i18n'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Bell, Bot, CalendarClock, Code, Cpu, GitBranch, Keyboard, Lightbulb, Palette, Plug, RefreshCw, ShieldCheck, Target, X, type LucideIcon } from 'lucide-react'
import { SearchInput } from './SearchInput'
import { fuzzy } from './fuzzy'
import { useRef, useState, type ReactNode } from 'react'

export const SETTINGS_SECTIONS = [
  { id: 'updates', label: 'Updates', Icon: RefreshCw },
  { id: 'goals', label: 'Goals', Icon: Target },
  { id: 'automation', label: 'Background & Recaps', Icon: CalendarClock },
  { id: 'appearance', label: 'Appearance', Icon: Palette }, { id: 'editor', label: 'Editor & Terminal', Icon: Code },
  { id: 'models', label: 'Models', Icon: Cpu }, { id: 'providers', label: 'Providers', Icon: Plug }, { id: 'access', label: 'Access & Fallback', Icon: ShieldCheck }, { id: 'subagents', label: 'Sub-agents', Icon: Bot }, { id: 'advisor', label: 'Advisor', Icon: Lightbulb },
  { id: 'git', label: 'Git & Chats', Icon: GitBranch }, { id: 'shortcuts', label: 'Keyboard shortcuts', Icon: Keyboard },
] as const satisfies readonly { id: string; label: string; Icon: LucideIcon }[]
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

/** Every individual setting, so search finds "Primary color" and jumps to it, not just the page it lives on. */
const SETTINGS_INDEX: { section: SettingsSection; title: string; words?: string }[] = [
  { section: 'updates', title: 'Auto-update Ramu', words: 'app update github release download restart background service version' },
  { section: 'goals', title: 'Goal detection', words: 'goal auto manual off automatic completion continue unfinished' },
  { section: 'goals', title: 'Maximum continuation turns', words: 'goal max limit budget unlimited retry available quota reset' },
  { section: 'goals', title: 'Custom turn limit', words: 'goal max number turns' },
  { section: 'automation', title: 'Agent notifications', words: 'notify notification alert done finished system toast' },
  { section: 'automation', title: 'Continue chats after restart', words: 'resume recover recovery interrupted progress startup crash' },
  { section: 'automation', title: 'Keep working while commands run', words: 'background long running slow dev server watcher build test shell command async auto automatic timeout seconds' },
  { section: 'automation', title: 'Keep working while asking questions', words: 'async asynchronous optional blocking related grouped answers pending input' },
  { section: 'automation', title: 'Daily recaps', words: 'recap summary home tokens' },
  { section: 'automation', title: 'Generate daily at', words: 'recap time schedule timezone' },
  { section: 'automation', title: 'Keep computer awake', words: 'sleep awake caffeinate power battery background installed login' },
  { section: 'automation', title: 'Background service', words: 'daemon login startup' },
  { section: 'appearance', title: 'Language', words: 'bahasa indonesia english system perangkat' },
  { section: 'appearance', title: 'Primary color', words: 'accent blue violet teal theme' },
  { section: 'appearance', title: 'Interface font', words: 'system geist typeface' },
  { section: 'appearance', title: 'Interface font size', words: 'text size zoom' },
  { section: 'appearance', title: 'Recent chats in sidebar', words: 'sidebar latest hide show' },
  { section: 'appearance', title: 'Crisper text', words: 'font smoothing antialiasing grayscale' },
  { section: 'appearance', title: 'Layout sizes', words: 'reset width height split terminal' },
  { section: 'editor', title: 'Preview tabs', words: 'single click open file' },
  { section: 'editor', title: 'Format on save', words: 'prettier biome oxfmt formatter' },
  { section: 'editor', title: 'Language servers', words: 'lsp typescript intellisense definition hover autocomplete' },
  { section: 'editor', title: 'AI completion', words: 'ollama codestral mistral ghost text inline suggestion tab next edit' },
  { section: 'editor', title: 'Lint while editing', words: 'eslint biome oxlint problems' },
  { section: 'editor', title: 'Default chat sidebar', words: 'dock open closed conversation' },
  { section: 'editor', title: 'Editor font size', words: 'monaco text' },
  { section: 'editor', title: 'Terminal font size', words: 'xterm text' },
  { section: 'editor', title: 'Default terminal tabs', words: 'top right position' },
  { section: 'providers', title: 'Provider binaries', words: 'claude codex opencode cursor antigravity install setup path executable login' },
  { section: 'providers', title: 'Provider update notifications', words: 'latest version check updates automatic' },
  { section: 'models', title: 'Model sets', words: 'steps effort reasoning provider codex claude' },
  { section: 'models', title: 'Default set', words: 'model' },
  { section: 'models', title: 'Default step', words: 'model effort' },
  { section: 'access', title: 'Default access', words: 'permissions edits auto full' },
  { section: 'access', title: 'Automatic fallback', words: 'provider fallback limit' },
  { section: 'access', title: 'Switch before the limit', words: 'usage threshold percent 5-hour weekly fallback' },
  { section: 'access', title: 'Fallback order', words: 'provider model effort chain list order' },
  { section: 'subagents', title: 'Where sub-agents run', words: 'subagent native provider cross delegate' },
  { section: 'subagents', title: 'By type', words: 'explore plan subagent type route' },
  { section: 'subagents', title: 'Fallback order', words: 'subagent limit separate same' },
  { section: 'subagents', title: 'Decide before Codex starts its own sub-agents', words: 'codex hook trust intercept spawn_agent config' },
  { section: 'advisor', title: 'Advisor', words: 'advisor reviewer review second opinion stronger model consult claude opus gpt cross provider' },
  { section: 'advisor', title: 'Advisor model', words: 'advisor reviewer model effort provider' },
  { section: 'advisor', title: 'Always wait for advice', words: 'advisor block blocking async wait continue' },
  { section: 'providers', title: 'Show usage limits', words: 'usage gauge 5-hour weekly plan quota' },
  { section: 'git', title: 'Messages while working', words: 'queue steer steering enter busy' },
  { section: 'git', title: 'Include open tabs as context', words: 'files mention' },
  { section: 'git', title: 'Pull behavior', words: 'rebase merge fast-forward sync' },
  { section: 'git', title: 'Hide empty Staged Changes', words: 'source control' },
  { section: 'git', title: 'Recent chats', words: 'sidebar count project' },
  { section: 'shortcuts', title: 'Keyboard shortcuts', words: 'keys commands bindings' },
]

export function SettingsPage({ section, onSection, children, busy, error, onSave, onClose }: { section: SettingsSection; onSection: (section: SettingsSection) => void; children: ReactNode; busy: boolean; error: string | null; onSave: () => void; onClose: () => void }) {
  useLanguage()
  const [query, setQuery] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const q = query.trim()
  const results = q ? SETTINGS_INDEX.map((source) => { const entry = { ...source, title: t(source.title) }; const title = fuzzy(q, entry.title), words = fuzzy(q, `${entry.title} ${source.title} ${entry.words ?? ''} ${t(SETTINGS_SECTIONS.find((item) => item.id === entry.section)!.label)}`); return title || words ? { entry, hits: title?.hits ?? [], score: (title?.score ?? 0) * 2 + (words?.score ?? 0) } : null }).filter((item): item is NonNullable<typeof item> => !!item).sort((a, b) => b.score - a.score).slice(0, 12) : []
  /** Opens the page and flashes the row, once the page has rendered. */
  const open = (entry: { section: SettingsSection; title: string }) => {
    setQuery(''); onSection(entry.section)
    window.setTimeout(() => {
      const rows = [...(host.current?.querySelectorAll<HTMLElement>('.settings-page-content .settings-row, .settings-page-content label, .settings-page-content h4, .settings-page-content strong') ?? [])]
      const row = rows.find((element) => element.textContent?.trim().toLowerCase().startsWith(entry.title.toLowerCase().slice(0, 12)))
      const target = row?.closest<HTMLElement>('.settings-row') ?? row
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target?.classList.add('flash'); window.setTimeout(() => target?.classList.remove('flash'), 1400)
    }, 60)
  }
  const title = (text: string, hits: number[]) => hits.length ? [...text].map((char, i) => hits.includes(i) ? <mark key={i}>{char}</mark> : char) : text
  return <Dialog open disablePointerDismissal onOpenChange={(open, details) => { if (open) return; if (busy) details.cancel(); else onClose() }}><DialogContent ref={host} className="settings-page" showCloseButton={false} aria-describedby={undefined} initialFocus={() => host.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? true}>
    <header className="settings-page-header"><DialogTitle>{t("Settings")}</DialogTitle><span className="muted small">{t("Ramu · This device")}</span><span className="grow" /><Button className="ghost icon" aria-label={t("Close settings")} disabled={busy} onClick={onClose}><X size={16} /></Button></header>
    <div className="settings-page-body"><nav className="settings-navigation" aria-label={t("Settings sections")}><SearchInput className="settings-search" aria-label={t("Find settings")} placeholder={t("Search settings")} value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) open(results[0].entry); if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') } }} />
      {q ? (results.length ? results.map(({ entry, hits }) => { const Icon = SETTINGS_SECTIONS.find((item) => item.id === entry.section)!.Icon; return <Button key={`${entry.section}:${entry.title}`} className="settings-result" disabled={busy} onClick={() => open(entry)}><Icon size={14} /><span className="settings-result-text"><span className="settings-result-title">{title(entry.title, hits)}</span><span className="muted small">{t(SETTINGS_SECTIONS.find((item) => item.id === entry.section)!.label)}</span></span></Button> }) : <p className="muted small settings-search-empty">{t("No settings match “")}{q}”.</p>)
        : SETTINGS_SECTIONS.map((entry) => <Button key={entry.id} aria-current={entry.id === section ? 'page' : undefined} className={entry.id === section ? 'on' : ''} disabled={busy} onClick={() => onSection(entry.id)}><entry.Icon size={15} />{t(entry.label)}</Button>)}
    </nav><div className="settings-page-content"><h3>{t(SETTINGS_SECTIONS.find((entry) => entry.id === section)!.label)}</h3><fieldset className="settings-fields" disabled={busy}>{children}</fieldset></div></div>
    <footer className="settings-page-footer">{error && <span className="error small" role="alert">{error}</span>}<span className="grow" /><Button disabled={busy} onClick={onClose}>{t("Cancel")}</Button><Button className="primary" disabled={busy} onClick={onSave}>{busy ? t("Saving…") : t("Save changes")}</Button></footer>
  </DialogContent></Dialog>
}
