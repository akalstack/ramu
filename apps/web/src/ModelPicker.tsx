import { t, useLanguage } from './i18n'
import { errorText } from './errors'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/desktop-button'
import { moveFavorite } from '@ramu/shared/favorites'
import { SearchInput } from './SearchInput'
import { Check, GripVertical, Layers, List, Pencil, Star } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from '@dnd-kit/core'
import { createPortal } from 'react-dom'
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers'
import type { AgentProvider, AgentModel, AgentSettings } from '@ramu/shared/types'
import { useAppSettings } from './AppSettings'
import { notifyError } from './Notifications'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { peakUsage, usageTone, useUsage, windowLabel } from './Usage'

type Tab = 'all' | 'sets' | AgentProvider
const keyOf = (model: Pick<AgentModel, 'provider' | 'id'>) => `${model.provider}:${model.id}`

/** The model picker: a rail of All models, Sets and providers beside a searchable list. ⌘1–⌘9 pick the numbered row. */
export function ModelPicker({
  settings,
  onChange,
  onDone,
  onSet,
}: {
  settings: AgentSettings
  onChange: (settings: AgentSettings) => void
  onDone: () => void
  onSet: (id: string) => void
}) {
  const language = useLanguage()
  const { catalogs, preferences, reload } = useModelSets()
  const app = useAppSettings()
  const favorites = app.preferences.favoriteModels ?? []
  const all = useMemo(() => catalogs.flatMap((catalog) => catalog.models), [catalogs])
  const modelByKey = useMemo(() => new Map(all.map((model) => [keyOf(model), model])), [all])
  const searchable = useMemo(
    () =>
      new Map(
        all.map((model) => [
          model,
          `${modelDisplayName(model.name)} ${model.name} ${model.id} ${providerName(model.provider)}`.toLowerCase(),
        ]),
      ),
    [all],
  )
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [editingFavorites, setEditingFavorites] = useState(false)
  const [draggedFavorite, setDraggedFavorite] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [dropTarget, setDropTarget] = useState<{ key: string; after: boolean } | null>(null)
  const [savingFavorites, setSavingFavorites] = useState(false)
  const [reorderNotice, setReorderNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    input.current?.focus()
  }, [])
  const deferredQuery = useDeferredValue(query)
  const q = deferredQuery.trim().toLowerCase()
  // How much of each provider's plan is left, so a near-limit provider is easy to avoid.
  const usage = useUsage()
  const usageByProvider = useMemo(
    () =>
      new Map(
        AGENT_PROVIDERS.map((provider) => {
          const peak = peakUsage(usage, provider)
          return [
            provider,
            peak ? (
              <span
                className={`mp-usage [&.warn]:text-warn [&.bad]:text-bad text-muted-foreground ${usageTone(peak)}`}
                title={t('{0} usage', { '0': windowLabel(peak) })}
              >
                {' '}
                · {peak.status === 'limited' ? t('limited') : t('{0}% left', { '0': 100 - peak.usedPercent })}
              </span>
            ) : null,
          ]
        }),
      ),
    [usage, language],
  )
  const matchingModels = useMemo(
    () =>
      all.filter(
        (model) => (q || tab === 'all' || model.provider === tab) && (!q || searchable.get(model)!.includes(q)),
      ),
    [all, searchable, q, tab],
  )
  const favoriteKeys = useMemo(() => new Set(favorites), [favorites])
  const matchingKeys = useMemo(() => new Set(matchingModels.map(keyOf)), [matchingModels])
  const favoriteRows = useMemo(
    () => favorites.flatMap((key) => (matchingKeys.has(key) ? [modelByKey.get(key)!] : [])),
    [favorites, matchingKeys, modelByKey],
  )
  const rows = useMemo(
    () => [...favoriteRows, ...matchingModels.filter((model) => !favoriteKeys.has(keyOf(model)))],
    [favoriteRows, matchingModels, favoriteKeys],
  )
  const sets = tab === 'sets' ? preferences.sets.filter((set) => !q || set.name.toLowerCase().includes(q)) : []
  const providerError =
    !q && tab !== 'all' && tab !== 'sets' ? catalogs.find((catalog) => catalog.provider === tab)?.error : undefined

  // Large provider catalogs mount only the visible rows, while search still covers every model.
  const list = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [listHeight, setListHeight] = useState(420)
  const pendingFocus = useRef<number | null>(null)
  const rowHeight = Math.max(48, Math.ceil((app.preferences.fontSize * 2 - 3) * 1.4 + 12))
  const virtual = rows.length > 100
  const start = virtual ? Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / rowHeight)) - 5) : 0
  const end = virtual ? Math.min(rows.length, start + Math.ceil(listHeight / rowHeight) + 11) : rows.length
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const observer = new ResizeObserver(() => setListHeight(el.clientHeight))
    setListHeight(el.clientHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0
    setScrollTop(0)
    pendingFocus.current = null
  }, [q, tab])
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    const row = list.current?.querySelector<HTMLElement>(`[data-model-index="${pendingFocus.current}"]`)
    if (row) {
      row.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  })
  const focusRow = (index: number) => {
    const el = list.current
    if (!el || index < 0 || index >= rows.length) return
    const top = index * rowHeight + 4
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight
    pendingFocus.current = index
    setScrollTop(el.scrollTop)
    const row = el.querySelector<HTMLElement>(`[data-model-index="${index}"]`)
    if (row) {
      row.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }

  // Changing the model starts from that model's own default effort, not the previous model's.
  const choose = (model: AgentModel) => {
    if (editingFavorites) return
    onChange({
      ...settings,
      provider: model.provider,
      model: model.id,
      effort: model.defaultEffort,
      serviceTier:
        model.provider === 'codex' && model.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
          ? settings.serviceTier
          : 'standard',
    })
    onDone()
  }
  const saveFavorites = async (next: string[], notice = '') => {
    if (savingFavorites) return
    setSavingFavorites(true)
    try {
      await app.save({ ...app.preferences, favoriteModels: next })
      setReorderNotice(notice)
    } catch (reason) {
      notifyError(errorText(reason), 'Models')
    } finally {
      setSavingFavorites(false)
    }
  }
  const reorder = (key: string, target: string, after: boolean) => {
    const next = moveFavorite(favorites, key, target, after)
    if (next.join('\0') === favorites.join('\0')) return
    const model = modelByKey.get(key)
    const visible = next.filter((key) => modelByKey.has(key))
    void saveFavorites(
      next,
      `Moved ${model ? modelDisplayName(model.name) : 'favorite'} to position ${visible.indexOf(key) + 1} of ${visible.length}.`,
    )
  }
  // Rows are found under the pointer, so the list can stay virtualized and the overlay never needs droppables.
  const targetUnder = (event: DragMoveEvent) => {
    const origin = event.activatorEvent as PointerEvent,
      x = origin.clientX + event.delta.x,
      y = origin.clientY + event.delta.y
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-favorite-key]')
    if (!row?.dataset.favoriteKey || row.dataset.favoriteKey === String(event.active.id)) return null
    const rect = row.getBoundingClientRect()
    return { key: row.dataset.favoriteKey, after: y >= rect.top + rect.height / 2 }
  }
  const endDrag = () => {
    setDraggedFavorite(null)
    setDropTarget(null)
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
      event.preventDefault()
      event.stopPropagation()
      latest.current.choose(model)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const selected = (model: AgentModel) =>
    settings.provider === model.provider && (settings.model === model.id || (!settings.model && model.isDefault))
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t('All models'), icon: <List size={15} /> },
    { id: 'sets', label: t('Model sets'), icon: <Layers size={15} /> },
    ...AGENT_PROVIDERS.map((provider) => ({
      id: provider,
      label: providerName(provider),
      icon: <ProviderIcon provider={provider} size={16} />,
    })),
  ]
  return (
    <div className="embedded-model-picker model-picker flex h-[340px]" role="menu" aria-label={t('Select model')}>
      <nav
        className="mp-rail [&_button]:w-8 [&_button]:h-8 [&_button]:min-h-8 [&_button]:p-0 [&_button]:justify-center [&_button]:bg-transparent [&_button]:[border:0] [&_button]:rounded-(--radius-s) [&_button]:text-muted-foreground [&_button:hover:not(:disabled)]:bg-hover [&_button:hover:not(:disabled)]:text-foreground [&_button:hover:not(:disabled)]:[border:0] [&_button.on]:bg-accent [&_button.on]:text-foreground [&_button.on_.provider-icon.codex]:text-foreground w-[44px] flex-none flex flex-col items-center gap-1 p-[8px_0]"
        aria-label={t('Model groups')}
      >
        {tabs.map((entry) => (
          <Button
            variant="secondary"
            type="button"
            key={entry.id}
            className={entry.id === (q ? 'all' : tab) ? 'on' : ''}
            aria-label={entry.label}
            aria-pressed={entry.id === (q ? 'all' : tab)}
            title={entry.label}
            onClick={() => {
              setTab(entry.id)
              setEditingFavorites(false)
              setDropTarget(null)
              setDraggedFavorite(null)
            }}
          >
            {entry.icon}
          </Button>
        ))}
      </nav>
      <div className="mp-main flex-1 min-w-0 flex flex-col">
        <div className="mp-search [&_>_.search-input]:flex-1 [&_>_.search-input]:min-w-0 flex-none p-2 h-auto flex items-center gap-1.5">
          <SearchInput
            ref={input}
            aria-label={t('Search models')}
            placeholder={t('Search models…')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setEditingFavorites(false)
              setDropTarget(null)
              setDraggedFavorite(null)
            }}
          />
          {!q && favoriteRows.length > 1 && (
            <Button
              variant="secondary"
              type="button"
              className={`mp-edit [&:hover]:text-foreground [&:hover]:bg-accent [&.on]:text-foreground [&.on]:bg-accent shrink-0 grid place-items-center w-7 h-7 p-0 [border:0] rounded-(--radius-s) bg-transparent text-soft${editingFavorites ? ' on' : ''}`}
              aria-label={editingFavorites ? t('Finish reordering favorites') : t('Reorder favorites')}
              title={editingFavorites ? t('Done') : t('Reorder favorites')}
              aria-pressed={editingFavorites}
              onClick={() => {
                setEditingFavorites((value) => !value)
                setDropTarget(null)
                setDraggedFavorite(null)
              }}
            >
              {editingFavorites ? <Check size={15} /> : <Pencil size={15} />}
            </Button>
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {reorderNotice}
        </span>
        <DndContext
          sensors={sensors}
          autoScroll={{ layoutShiftCompensation: false }}
          onDragStart={(event) => setDraggedFavorite(String(event.active.id))}
          onDragMove={(event) =>
            setDropTarget((current) => {
              const next = savingFavorites ? null : targetUnder(event)
              return current?.key === next?.key && current?.after === next?.after ? current : next
            })
          }
          onDragCancel={endDrag}
          onDragEnd={(event) => {
            const target = savingFavorites ? null : targetUnder(event as DragMoveEvent)
            if (target) reorder(String(event.active.id), target.key, target.after)
            endDrag()
          }}
        >
          <div
            className="mp-list flex-1 min-h-0 overflow-y-auto p-1 [overflow-anchor:none]"
            ref={list}
            aria-busy={query !== deferredQuery}
            onScroll={(event) => {
              if (virtual) setScrollTop(event.currentTarget.scrollTop)
            }}
          >
            {sets.map((set) => (
              <Button
                variant="secondary"
                type="button"
                key={set.id}
                className="bg-fill hover:bg-fill-hover mp-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.selected]:bg-accent [&.drop-before]:[box-shadow:inset_0_2px_var(--accent)] [&.drop-after]:[box-shadow:inset_0_-2px_var(--accent)] flex items-center gap-2 w-full min-h-[44px] p-[6px_8px] [border:0] rounded-(--radius-s) bg-transparent text-left justify-start cursor-default text-foreground"
                onClick={() => {
                  onSet(set.id)
                  onDone()
                }}
              >
                <span className="mp-text flex flex-col min-w-0 flex-1">
                  <span className="mp-name text-control font-medium leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap">
                    {set.name}
                  </span>
                  <span className="mp-sub flex items-center gap-[5px] text-caption text-muted-foreground leading-[1.4]">
                    {set.id === 'recommended'
                      ? t('Recommended set of models')
                      : t('{0} configured steps', { '0': set.steps.length })}
                  </span>
                </span>
              </Button>
            ))}
            {virtual && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
            {rows.slice(start, end).map((model, visibleIndex) => {
              const index = start + visibleIndex
              return (
                <div
                  key={keyOf(model)}
                  data-model-index={index}
                  data-favorite-key={favoriteKeys.has(keyOf(model)) && editingFavorites ? keyOf(model) : undefined}
                  role="menuitemradio"
                  aria-checked={selected(model)}
                  aria-posinset={index + 1}
                  aria-setsize={rows.length}
                  tabIndex={0}
                  style={{ height: rowHeight }}
                  className={`mp-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.selected]:bg-accent [&.drop-before]:[box-shadow:inset_0_2px_var(--accent)] [&.drop-after]:[box-shadow:inset_0_-2px_var(--accent)] flex items-center gap-2 w-full min-h-[44px] p-[6px_8px] [border:0] rounded-(--radius-s) bg-transparent text-left justify-start cursor-default text-foreground mp-model-row [box-sizing:border-box] ${selected(model) ? ' selected' : ''}${dropTarget?.key === keyOf(model) ? (dropTarget.after ? ' drop-after' : ' drop-before') : ''}`}
                  onClick={() => choose(model)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      choose(model)
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault()
                      focusRow(
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? rows.length - 1
                            : index + (event.key === 'ArrowDown' ? 1 : -1),
                      )
                    }
                  }}
                >
                  {favoriteKeys.has(keyOf(model)) && editingFavorites && (
                    <FavoriteHandle
                      id={keyOf(model)}
                      disabled={savingFavorites}
                      name={modelDisplayName(model.name)}
                      className="bg-fill hover:bg-fill-hover mp-drag [&:active]:[cursor:grabbing] bg-transparent [border:none] text-muted-foreground p-[4px_0] cursor-grab shrink-0"
                      onKeyDown={(event) => {
                        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                        event.preventDefault()
                        event.stopPropagation()
                        const direction = event.key === 'ArrowUp' ? -1 : 1
                        const target =
                          favoriteRows[favoriteRows.findIndex((entry) => keyOf(entry) === keyOf(model)) + direction]
                        if (target) reorder(keyOf(model), keyOf(target), direction > 0)
                      }}
                    />
                  )}
                  <span className="mp-text flex flex-col min-w-0 flex-1">
                    <span className="mp-name text-control font-medium leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap">
                      {modelDisplayName(model.name)}
                    </span>
                    <span className="mp-sub flex items-center gap-[5px] text-caption text-muted-foreground leading-[1.4]">
                      <ProviderIcon provider={model.provider} size={13} />
                      {providerName(model.provider)}
                      {usageByProvider.get(model.provider)}
                    </span>
                  </span>
                  {!editingFavorites && index < 9 && <Kbd className="mp-key flex-none">⌘{index + 1}</Kbd>}
                  {!editingFavorites && (
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={savingFavorites}
                      className={
                        favorites.includes(keyOf(model))
                          ? 'mp-star [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:text-foreground [&.on]:[color:#f0a63c] w-[26px] h-[26px] min-h-[26px] p-0 justify-center bg-transparent [border:0] text-muted-foreground rounded-(--radius-s) flex-none on'
                          : 'mp-star [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:text-foreground [&.on]:[color:#f0a63c] w-[26px] h-[26px] min-h-[26px] p-0 justify-center bg-transparent [border:0] text-muted-foreground rounded-(--radius-s) flex-none'
                      }
                      aria-label={
                        favorites.includes(keyOf(model))
                          ? t('Remove {0} from favorites', { '0': modelDisplayName(model.name) })
                          : t('Add {0} to favorites', { '0': modelDisplayName(model.name) })
                      }
                      aria-pressed={favorites.includes(keyOf(model))}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleFavorite(model)
                      }}
                    >
                      <Star size={15} fill={favorites.includes(keyOf(model)) ? 'currentColor' : 'none'} />
                    </Button>
                  )}
                </div>
              )
            })}
            {virtual && <div aria-hidden="true" style={{ height: (rows.length - end) * rowHeight }} />}
            {(q || tab !== 'sets') && !rows.length && (
              <p className="mp-empty m-0 p-3 text-muted-foreground text-control leading-[1.5]">
                {providerError || error || t('No matching models')}
              </p>
            )}
            {(providerError || error) && (
              <Button
                variant="secondary"
                type="button"
                className="bg-fill hover:bg-fill-hover mp-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.selected]:bg-accent [&.drop-before]:[box-shadow:inset_0_2px_var(--accent)] [&.drop-after]:[box-shadow:inset_0_-2px_var(--accent)] flex items-center gap-2 w-full min-h-[44px] p-[6px_8px] [border:0] rounded-(--radius-s) bg-transparent text-left justify-start cursor-default text-foreground"
                onClick={() => {
                  void reload().catch((reason) => setError(errorText(reason)))
                }}
              >
                <span className="mp-text flex flex-col min-w-0 flex-1">
                  <span className="mp-name text-control font-medium leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap">
                    {t('Reload available models')}
                  </span>
                </span>
              </Button>
            )}
          </div>
          {createPortal(
            <DragOverlay dropAnimation={null} zIndex={10000}>
              {draggedFavorite && modelByKey.get(draggedFavorite) && (
                <div className="pointer-events-none flex items-center gap-2 rounded-(--radius-s) border border-(--line-strong) bg-raised p-[6px_8px] text-control text-foreground shadow-lg">
                  <GripVertical size={14} className="text-muted-foreground" />
                  {modelDisplayName(modelByKey.get(draggedFavorite)!.name)}
                </div>
              )}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      </div>
    </div>
  )
}

/** The grip that starts a pointer-driven drag; Alt+↑/↓ still reorders from the keyboard. */
function FavoriteHandle({
  id,
  disabled,
  name,
  className,
  onKeyDown,
}: {
  id: string
  disabled: boolean
  name: string
  className: string
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id, disabled })
  return (
    <Button
      ref={setNodeRef}
      variant="secondary"
      type="button"
      className={`${className} touch-none`}
      {...attributes}
      {...listeners}
      aria-disabled={disabled}
      aria-label={t('Reorder {0}', { '0': name })}
      title={t('Drag to reorder. Alt+↑/↓ moves this favorite.')}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <GripVertical size={14} />
    </Button>
  )
}
