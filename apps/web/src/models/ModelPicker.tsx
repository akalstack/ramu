import { DragHandle } from '@/components/drag-handle'
import { useShowLegacyModels, visiblePickerModels } from './modelVisibility'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/desktop-button'
import { dropFavorite } from '@ramu/shared/workspace/favorites'
import { SearchInput } from '../SearchInput'
import { Check, GripVertical, Layers, List, Pencil, SlidersHorizontal, Star } from 'lucide-react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, AgentModel, AgentSettings } from '@ramu/shared/types'
import { useAppSettings } from '../settings/AppSettings'
import { notifyError } from '../chat/Notifications'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { peakUsage, usageTone, useUsage, windowLabel } from '../settings/Usage'

type Tab = 'all' | 'sets' | AgentProvider
const keyOf = (model: Pick<AgentModel, 'provider' | 'id'>) => `${model.provider}:${model.id}`

/** Favorites reorder up and down a list; the row never leaves its column. */
const alongTheList: Modifier = ({ transform }) => ({ ...transform, x: 0 })

type ListItem =
  | { kind: 'heading'; key: string; label: string; provider?: AgentProvider }
  | { kind: 'model'; model: AgentModel; index: number }

/**
 * The model picker: search, then a strip of All, Sets and providers over one compact list. Models are grouped under a
 * heading that carries each provider's remaining usage once, so rows hold only what differs between them. ⌘1–⌘9 pick
 * the numbered row; only the row under the pointer or focus shows its shortcut and star, unless it is a favorite.
 */
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
  // A dropped row stays where it landed while the save runs, instead of snapping back until the host answers.
  const [landedFavorites, setLandedFavorites] = useState<string[] | null>(null)
  const savedFavorites = app.preferences.favoriteModels
  const favorites = useMemo(() => landedFavorites ?? savedFavorites ?? [], [landedFavorites, savedFavorites])
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
  const [showLegacy, setShowLegacy] = useShowLegacyModels()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [editingFavorites, setEditingFavorites] = useState(false)
  const [draggedFavorite, setDraggedFavorite] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [usage, language] by design; the values it reads beyond these are current as of that run
    [usage, language],
  )
  const matchingModels = useMemo(
    () =>
      visiblePickerModels(all, {
        showLegacy,
        query: q,
        settings,
        favorites,
        visible: app.preferences.visibleModels,
      }).filter(
        (model) => (q || tab === 'all' || model.provider === tab) && (!q || searchable.get(model)!.includes(q)),
      ),
    [all, searchable, q, tab, showLegacy, settings, favorites, app.preferences.visibleModels],
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
  const items = useMemo(() => {
    const list: ListItem[] = []
    if (favoriteRows.length) list.push({ kind: 'heading', key: 'favorites', label: t('Favorites') })
    rows.forEach((model, index) => {
      if (
        index >= favoriteRows.length &&
        (index === favoriteRows.length || rows[index - 1]!.provider !== model.provider)
      )
        list.push({
          kind: 'heading',
          key: model.provider,
          label: providerName(model.provider),
          provider: model.provider,
        })
      list.push({ kind: 'model', model, index })
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on language too, for the Favorites heading
  }, [rows, favoriteRows, language])
  const sets = tab === 'sets' ? preferences.sets.filter((set) => !q || set.name.toLowerCase().includes(q)) : []
  const providerError =
    !q && tab !== 'all' && tab !== 'sets' ? catalogs.find((catalog) => catalog.provider === tab)?.error : undefined

  // Large provider catalogs mount only the visible rows, while search still covers every model.
  const list = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [listHeight, setListHeight] = useState(420)
  const pendingFocus = useRef<number | null>(null)
  const rowHeight = Math.max(34, Math.ceil(app.preferences.fontSize * 1.4 + 14))
  // Sortable rows have to be mounted to be measured, so the list stays whole while favorites are reordered.
  const virtual = items.length > 100 && !editingFavorites
  const start = virtual ? Math.max(0, Math.min(items.length - 1, Math.floor(scrollTop / rowHeight)) - 5) : 0
  const end = virtual ? Math.min(items.length, start + Math.ceil(listHeight / rowHeight) + 11) : items.length
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
  }, [q, tab, showLegacy])
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
    const top = items.findIndex((item) => item.kind === 'model' && item.index === index) * rowHeight + 4
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
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const latestSave = useRef(0)
  /** Saves in the order they were made, so quick moves in a row all land and the last one wins. */
  const saveFavorites = (next: string[], notice = '') => {
    const save = ++latestSave.current
    setLandedFavorites(next)
    saving.current = saving.current
      .then(() => app.save({ ...app.preferences, favoriteModels: next }))
      .then(
        () => setReorderNotice(notice),
        (reason) => notifyError(errorText(reason), 'Models'),
      )
      .finally(() => {
        if (save === latestSave.current) setLandedFavorites(null)
      })
  }
  const shownFavorites = favoriteRows.map(keyOf)
  const reorder = (key: string, target: string) => {
    const next = dropFavorite(favorites, shownFavorites, key, target)
    if (next.join('\0') === favorites.join('\0')) return
    const model = modelByKey.get(key)
    const visible = next.filter((key) => modelByKey.has(key))
    saveFavorites(
      next,
      `Moved ${model ? modelDisplayName(model.name) : 'favorite'} to position ${visible.indexOf(key) + 1} of ${visible.length}.`,
    )
  }
  const drop = ({ active, over }: DragEndEvent) => {
    setDraggedFavorite(null)
    if (over && over.id !== active.id) reorder(String(active.id), String(over.id))
  }
  const toggleFavorite = (model: AgentModel) => {
    const key = keyOf(model)
    const next = favorites.includes(key) ? favorites.filter((entry) => entry !== key) : [...favorites, key]
    saveFavorites(next)
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
    ...AGENT_PROVIDERS.filter((provider) => {
      const catalog = catalogs.find((entry) => entry.provider === provider)
      return catalog?.models.length || catalog?.error
    }).map((provider) => ({
      id: provider,
      label: providerName(provider),
      icon: <ProviderIcon provider={provider} size={16} />,
    })),
  ]
  return (
    <div className="embedded-model-picker model-picker flex h-[400px]" role="menu" aria-label={t('Select model')}>
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
                setDraggedFavorite(null)
              }}
            >
              {editingFavorites ? <Check size={15} /> : <Pencil size={15} />}
            </Button>
          )}
        </div>
        <nav className="flex flex-none items-center gap-0.5 overflow-x-auto px-2 pb-1.5" aria-label={t('Model groups')}>
          {tabs.map((entry) => {
            const on = entry.id === (q ? 'all' : tab)
            return (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                key={entry.id}
                className={`h-7 flex-none gap-1.5 px-2 text-caption ${on ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                aria-label={entry.label}
                aria-pressed={on}
                title={entry.label}
                onClick={() => {
                  setTab(entry.id)
                  setEditingFavorites(false)
                  setDraggedFavorite(null)
                }}
              >
                {entry.icon}
                {on && <span>{entry.label}</span>}
              </Button>
            )
          })}
        </nav>
        <span className="sr-only" role="status" aria-live="polite">
          {reorderNotice}
        </span>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[alongTheList]}
          autoScroll={{ layoutShiftCompensation: false }}
          onDragStart={(event) => setDraggedFavorite(String(event.active.id))}
          onDragCancel={() => setDraggedFavorite(null)}
          onDragEnd={drop}
        >
          <SortableContext items={shownFavorites} strategy={verticalListSortingStrategy}>
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
                  className="bg-fill hover:bg-fill-hover mp-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.selected]:bg-accent flex items-center gap-2 w-full min-h-[44px] p-[6px_8px] [border:0] rounded-(--radius-s) bg-transparent text-left justify-start cursor-default text-foreground"
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
              {items.slice(start, end).map((item) => {
                if (item.kind === 'heading')
                  return (
                    <div
                      key={`heading:${item.key}`}
                      role="presentation"
                      style={{ height: rowHeight }}
                      className="flex items-end gap-1.5 px-2 pb-1 text-caption font-medium text-muted-foreground"
                    >
                      <span className="truncate">{item.label}</span>
                      {item.provider && usageByProvider.get(item.provider)}
                    </div>
                  )
                const { model, index } = item
                const row = (sortable?: SortableFavorite) => (
                  <div
                    ref={sortable?.ref}
                    data-model-index={index}
                    role="menuitemradio"
                    aria-checked={selected(model)}
                    aria-posinset={index + 1}
                    aria-setsize={rows.length}
                    tabIndex={0}
                    style={{ height: rowHeight, ...sortable?.style }}
                    className={`mp-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.selected]:bg-accent group flex items-center gap-2 w-full px-2 [border:0] rounded-(--radius-s) bg-transparent text-left justify-start cursor-default text-foreground mp-model-row [box-sizing:border-box] ${selected(model) ? ' selected' : ''}`}
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
                    {sortable && (
                      <DragHandle
                        {...sortable.handle}
                        className="mp-drag py-1"
                        aria-label={t('Reorder {0}', { '0': modelDisplayName(model.name) })}
                        title={t('Drag to reorder. Alt+↑/↓ moves this favorite.')}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                            event.preventDefault()
                            event.stopPropagation()
                            const direction = event.key === 'ArrowUp' ? -1 : 1
                            const target = shownFavorites[shownFavorites.indexOf(keyOf(model)) + direction]
                            if (target) reorder(keyOf(model), target)
                          } else sortable.handle.onKeyDown?.(event)
                        }}
                      />
                    )}
                    <ProviderIcon provider={model.provider} size={14} />
                    <span className="mp-name min-w-0 flex-1 truncate text-control font-medium">
                      {modelDisplayName(model.name)}
                    </span>
                    {model.isLegacy && (
                      <span className="flex-none text-caption text-muted-foreground">{t('Legacy')}</span>
                    )}
                    {!editingFavorites && index < 9 && (
                      <Kbd className="mp-key flex-none opacity-0 group-hover:opacity-100 group-focus:opacity-100">
                        ⌘{index + 1}
                      </Kbd>
                    )}
                    {selected(model) && <Check size={15} className="flex-none text-brand" aria-hidden="true" />}
                    {!editingFavorites && (
                      <Button
                        variant="secondary"
                        type="button"
                        className={
                          favorites.includes(keyOf(model))
                            ? 'mp-star [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:text-foreground [&.on]:[color:#f0a63c] w-[26px] h-[26px] min-h-[26px] p-0 justify-center bg-transparent [border:0] text-muted-foreground rounded-(--radius-s) flex-none on'
                            : 'mp-star [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:text-foreground [&.on]:[color:#f0a63c] w-[26px] h-[26px] min-h-[26px] p-0 justify-center bg-transparent [border:0] text-muted-foreground rounded-(--radius-s) flex-none opacity-0 group-hover:opacity-100 group-focus:opacity-100 focus-visible:opacity-100'
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
                return favoriteKeys.has(keyOf(model)) && editingFavorites ? (
                  <SortableFavoriteRow key={keyOf(model)} id={keyOf(model)}>
                    {row}
                  </SortableFavoriteRow>
                ) : (
                  <Fragment key={keyOf(model)}>{row()}</Fragment>
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
                  className="bg-fill hover:bg-fill-hover mp-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.selected]:bg-accent flex items-center gap-2 w-full min-h-[44px] p-[6px_8px] [border:0] rounded-(--radius-s) bg-transparent text-left justify-start cursor-default text-foreground"
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
          </SortableContext>
          {createPortal(
            <DragOverlay zIndex={10000}>
              {draggedFavorite && modelByKey.get(draggedFavorite) && (
                <div className="pointer-events-none flex h-full w-full items-center gap-2 rounded-(--radius-s) border border-(--line-strong) bg-raised px-2 text-control font-medium text-foreground shadow-lg">
                  <GripVertical size={14} className="flex-none text-muted-foreground" />
                  <ProviderIcon provider={modelByKey.get(draggedFavorite)!.provider} size={14} />
                  <span className="min-w-0 flex-1 truncate">
                    {modelDisplayName(modelByKey.get(draggedFavorite)!.name)}
                  </span>
                </div>
              )}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
        <div className="flex flex-none items-center justify-between gap-2 border-t border-(--line) p-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              onDone()
              window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } }))
            }}
          >
            <SlidersHorizontal size={13} />
            {t('Choose models')}
          </Button>
          {!q && tab !== 'sets' && all.some((model) => model.isLegacy && (tab === 'all' || model.provider === tab)) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-pressed={showLegacy}
              onClick={() => setShowLegacy(!showLegacy)}
            >
              {showLegacy ? t('Hide legacy models') : t('Show legacy models')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface SortableFavorite {
  ref: Ref<HTMLDivElement>
  style: CSSProperties
  handle: Pick<ComponentProps<typeof DragHandle>, 'ref' | 'onKeyDown'> & Record<string, unknown>
}

/** One favorite while they are being reordered. The grip starts the drag, by pointer or Space; Alt+↑/↓ moves it directly. */
function SortableFavoriteRow({ id, children }: { id: string; children(row: SortableFavorite): ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  return children({
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : undefined },
    handle: { ...attributes, ...listeners, ref: setActivatorNodeRef },
  })
}
