import { SETTINGS_MENU, type SettingsMenuId } from '@ramu/shared/settingsMenu'
import { SETTINGS_CATALOG, SETTINGS_VIEWS } from '@ramu/shared/settingsCatalog'
import { fuzzy } from '../lib/fuzzy'

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
    ...SETTINGS_CATALOG.map((source) => ({
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

/** The page a result is on, as the desktop names it: Plugins are kept in Customize, not in the Settings menu. */
export const desktopPageLabel = (section: SettingsMenuId) =>
  section === 'plugins' ? 'Customize' : SETTINGS_MENU.find((entry) => entry.id === section)!.label
