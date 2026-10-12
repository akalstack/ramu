import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import { moveFavorite } from '../../shared/favorites'
import { SearchInput } from './SearchInput'
import { Check, GripVertical, Layers, List, Pencil, Star } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_PROVIDERS, providerName } from '../../shared/providers'
import type { AgentProvider, AgentModel, AgentSettings } from '../../shared/types'
import { useAppSettings } from './AppSettings'
import { notifyError } from './Notifications'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { peakUsage, usageTone, useUsage, windowLabel } from './Usage'

type Tab = 'all' | 'sets' | AgentProvider
const keyOf = (model: Pick<AgentModel, 'provider' | 'id'>) => `${model.provider}:${model.id}`

/** The model picker: a rail of All models, Sets and providers beside a searchable list. ⌘1–⌘9 pick the numbered row. */
export function ModelPicker({ settings, onChange, onDone, onSet }: { settings: AgentSettings; onChange: (settings: AgentSettings) => void; onDone: () => void; onSet: (id: string) => void }) {
  useLanguage()
  const { catalogs, preferences, reload } = useModelSets()
  const app = useAppSettings()
  const favorites = app.preferences.favoriteModels ?? []
  const all = catalogs.flatMap((catalog) => catalog.models)
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [editingFavorites, setEditingFavorites] = useState(false)
  const draggedFavorite = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ key: string; after: boolean } | null>(null)
  const [savingFavorites, setSavingFavorites] = useState(false)
  const [reorderNotice, setReorderNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { input.current?.focus() }, [])
  const q = query.trim().toLowerCase()
  // How much of each provider's plan is left, so a near-limit provider is easy to avoid.
  const usage = useUsage()
  const usageLeft = (provider: AgentModel['provider']) => { const peak = peakUsage(usage, provider); return peak ? <span className={`mp-usage ${usageTone(peak)}`} title={t("{0} usage", { "0": windowLabel(peak) })}> · {peak.status === 'limited' ? t("limited") : t("{0}% left", { "0": 100 - peak.usedPercent })}</span> : null }
  const matches = (model: AgentModel) => !q || `${modelDisplayName(model.name)} ${model.name} ${model.id} ${providerName(model.provider)}`.toLowerCase().includes(q)
  const matchingModels = q || tab === 'all' ? all.filter(matches) : tab === 'sets' ? [] : all.filter((model) => model.provider === tab && matches(model))
  const favoriteKeys = new Set(favorites)
  const favoriteRows = favorites.flatMap((key) => matchingModels.filter((model) => keyOf(model) === key))
  const rows = [...favoriteRows, ...matchingModels.filter((model) => !favoriteKeys.has(keyOf(model)))]
  const sets = tab === 'sets' ? preferences.sets.filter((set) => !q || set.name.toLowerCase().includes(q)) : []
  const providerError = !q && tab !== 'all' && tab !== 'sets' ? catalogs.find((catalog) => catalog.provider === tab)?.error : undefined

  // Changing the model starts from that model's own default effort, not the previous model's.
  const choose = (model: AgentModel) => {
    if (editingFavorites) return
    onChange({ ...settings, provider: model.provider, model: model.id, effort: model.defaultEffort, serviceTier: model.provider === 'codex' && model.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority') ? settings.serviceTier : 'standard' })
    onDone()
  }
  const saveFavorites = async (next: string[], notice = '') => {
    if (savingFavorites) return
    setSavingFavorites(true)
    try { await app.save({ ...app.preferences, favoriteModels: next }); setReorderNotice(notice) }
    catch (reason) { notifyError(String(reason), 'Models') }
    finally { setSavingFavorites(false) }
  }
  const reorder = (key: string, target: string, after: boolean) => {
    const next = moveFavorite(favorites, key, target, after)
    if (next.join('\0') === favorites.join('\0')) return
    const model = all.find((model) => keyOf(model) === key)
    const visible = next.filter((key) => all.some((model) => keyOf(model) === key))
    void saveFavorites(next, `Moved ${model ? modelDisplayName(model.name) : 'favorite'} to position ${visible.indexOf(key) + 1} of ${visible.length}.`)
  }
  const toggleFavorite = (model: AgentModel) => {
    const key = keyOf(model)
    const next = favorites.includes(key) ? favorites.filter((entry) => entry !== key) : [...favorites, key]
    void saveFavorites(next)
  }
  const latest = useRef({ rows, choose })
  latest.current = { rows, choose }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey || !/^[1-9]$/.test(event.key)) return
      const model = latest.current.rows[Number(event.key) - 1]
      if (!model) return
      event.preventDefault(); event.stopPropagation()
      latest.current.choose(model)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const selected = (model: AgentModel) => settings.provider === model.provider && (settings.model === model.id || !settings.model && model.isDefault)
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t("All models"), icon: <List size={15} /> },
    { id: 'sets', label: t("Model sets"), icon: <Layers size={15} /> },
    ...AGENT_PROVIDERS.map((provider) => ({ id: provider, label: providerName(provider), icon: <ProviderIcon provider={provider} size={16} /> })),
  ]
  return <div className="embedded-model-picker model-picker" role="menu" aria-label={t("Select model")}>
    <nav className="mp-rail" aria-label={t("Model groups")}>
      {tabs.map((entry) => <Button type="button" key={entry.id} className={entry.id === (q ? 'all' : tab) ? 'on' : ''} aria-label={entry.label} aria-pressed={entry.id === (q ? 'all' : tab)} title={entry.label} onClick={() => { setTab(entry.id); setEditingFavorites(false); setDropTarget(null); draggedFavorite.current = null }}>{entry.icon}</Button>)}
    </nav>
    <div className="mp-main">
      <div className="mp-search"><SearchInput ref={input} aria-label={t("Search models")} placeholder={t("Search models…")} value={query} onChange={(event) => { setQuery(event.target.value); setEditingFavorites(false); setDropTarget(null); draggedFavorite.current = null }} />{!q && favoriteRows.length > 1 && <Button type="button" className={`mp-edit${editingFavorites ? ' on' : ''}`} aria-label={editingFavorites ? t("Finish reordering favorites") : t("Reorder favorites")} title={editingFavorites ? t("Done") : t("Reorder favorites")} aria-pressed={editingFavorites} onClick={() => { setEditingFavorites((value) => !value); setDropTarget(null); draggedFavorite.current = null }}>{editingFavorites ? <Check size={15} /> : <Pencil size={15} />}</Button>}</div>
      <span className="sr-only" role="status" aria-live="polite">{reorderNotice}</span>
      <div className="mp-list">
        {sets.map((set) => <Button type="button" key={set.id} className="mp-row" onClick={() => { onSet(set.id); onDone() }}>
          <span className="mp-text"><span className="mp-name">{set.name}</span><span className="mp-sub">{set.id === 'recommended' ? t("Recommended set of models") : t("{0} configured steps", { "0": set.steps.length })}</span></span>
        </Button>)}
        {rows.map((model, index) => <div key={keyOf(model)} role="menuitemradio" aria-checked={selected(model)} tabIndex={0} className={`mp-row${selected(model) ? ' selected' : ''}${dropTarget?.key === keyOf(model) ? dropTarget.after ? ' drop-after' : ' drop-before' : ''}`} onClick={() => choose(model)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(model) } }}
          onDragOver={(event) => { if (!editingFavorites || !favoriteKeys.has(keyOf(model)) || !draggedFavorite.current || savingFavorites) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ key: keyOf(model), after: event.clientY >= rect.top + rect.height / 2 }) }}
          onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null) }}
          onDrop={(event) => { if (!editingFavorites || !draggedFavorite.current || !favoriteKeys.has(keyOf(model)) || savingFavorites) return; event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); reorder(draggedFavorite.current, keyOf(model), event.clientY >= rect.top + rect.height / 2); draggedFavorite.current = null; setDropTarget(null) }}>
          {favoriteKeys.has(keyOf(model)) && editingFavorites && <Button type="button" className="mp-drag" draggable={!savingFavorites} aria-disabled={savingFavorites} aria-label={t("Reorder {0}", { "0": modelDisplayName(model.name) })} title={t("Drag to reorder. Alt+↑/↓ moves this favorite.")} onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => { event.stopPropagation(); draggedFavorite.current = keyOf(model); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-ramu-favorite', keyOf(model)) }}
            onDragEnd={() => { draggedFavorite.current = null; setDropTarget(null) }}
            onKeyDown={(event) => { if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const direction = event.key === 'ArrowUp' ? -1 : 1; const target = favoriteRows[favoriteRows.findIndex((entry) => keyOf(entry) === keyOf(model)) + direction]; if (target) reorder(keyOf(model), keyOf(target), direction > 0) }}><GripVertical size={14} /></Button>}
          <span className="mp-text"><span className="mp-name">{modelDisplayName(model.name)}</span><span className="mp-sub"><ProviderIcon provider={model.provider} size={13} />{providerName(model.provider)}{usageLeft(model.provider)}</span></span>
          {!editingFavorites && index < 9 && <Kbd className="mp-key">⌘{index + 1}</Kbd>}
          {!editingFavorites && <Button type="button" disabled={savingFavorites} className={favorites.includes(keyOf(model)) ? 'mp-star on' : 'mp-star'} aria-label={favorites.includes(keyOf(model)) ? t("Remove {0} from favorites", { "0": modelDisplayName(model.name) }) : t("Add {0} to favorites", { "0": modelDisplayName(model.name) })} aria-pressed={favorites.includes(keyOf(model))} onClick={(event) => { event.stopPropagation(); toggleFavorite(model) }}><Star size={15} fill={favorites.includes(keyOf(model)) ? 'currentColor' : 'none'} /></Button>}
        </div>)}
        {(q || tab !== 'sets') && !rows.length && <p className="mp-empty">{providerError || error || t("No matching models")}</p>}
        {(providerError || error) && <Button type="button" className="mp-row" onClick={() => { void reload().catch((reason) => setError(String(reason))) }}><span className="mp-text"><span className="mp-name">{t("Reload available models")}</span></span></Button>}
      </div>
    </div>
  </div>
}
