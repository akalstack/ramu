import { isGeneratedModelSet } from '@ramu/shared/providers/modelDefaults'
import { providerName } from '@ramu/shared/providers/providers'
import { SettingsField } from './SettingsScope'
import type { useSettingsScope } from './SettingsScope'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ModelPreferences, ModelStep } from '@ramu/shared/types'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { modelStepName } from '../models/ModelSets'
import { GHOST_BUTTON_CLASS, GHOST_ICON_BUTTON_CLASS, MAX_MODEL_SETS, MAX_SET_STEPS } from './constants'
import { ModelStepCard } from './ModelStepCard'

export function ModelSetsEditor({
  draft,
  setDraft,
  selected,
  setSelected,
  catalogs,
  busy,
  onRestore,
  onRefresh,
}: {
  draft: ModelPreferences
  setDraft: Dispatch<SetStateAction<ModelPreferences>>
  selected: string
  setSelected: (id: string) => void
  catalogs: ReturnType<typeof useSettingsScope>['catalogs']
  busy: boolean
  onRestore: () => void
  onRefresh: () => void
}) {
  const set = draft.sets.find((entry) => entry.id === selected) ?? draft.sets[0]!
  const automatic = isGeneratedModelSet(set)
  const models = catalogs.flatMap((catalog) => catalog.models)
  const updateSteps = (steps: ModelStep[]) =>
    setDraft((current) => {
      if (automatic) return current
      const next = {
        ...current,
        sets: current.sets.map((entry) => (entry.id === set.id ? { ...entry, steps } : entry)),
      }
      if (next.defaultSetId === set.id && !steps.some((step) => step.id === next.defaultStepId))
        next.defaultStepId = steps[0]!.id
      return next
    })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const dropStep = (event: DragEndEvent) => {
    const from = set.steps.findIndex((step) => step.id === event.active.id),
      to = set.steps.findIndex((step) => step.id === event.over?.id)
    if (from >= 0 && to >= 0 && from !== to) updateSteps(arrayMove(set.steps, from, to))
  }
  const move = (index: number, delta: number) => {
    const steps = [...set.steps]
    const moved = steps.splice(index, 1)[0]!
    steps.splice(index + delta, 0, moved)
    updateSteps(steps)
  }
  return (
    <SettingsField path="$models">
      <div className="model-settings mt-8 [&_label]:flex [&_label]:flex-col [&_label]:gap-[5px] [&_label]:text-muted-foreground [&_label]:text-caption [&_label]:min-w-0 [&_.dropdown-trigger]:w-full [&_.dropdown-trigger]:text-foreground flex flex-col gap-4">
        <div className="settings-intro">
          <h4>{t('Model sets')}</h4>
          <p className="muted text-muted-foreground">
            {t('Create model and effort presets for the thread selection bar.')}
          </p>
        </div>
        <label>
          {t('Model selection')}
          <Dropdown
            label={t('Model selection')}
            value={draft.defaultBarMode ?? 'model'}
            options={[
              { value: 'model', label: t('Steps') },
              { value: 'effort', label: t('Model then effort') },
            ]}
            onChange={(mode) => setDraft({ ...draft, defaultBarMode: mode === 'effort' ? 'effort' : 'model' })}
            disabled={busy}
          />
        </label>
        <p className="muted text-muted-foreground text-caption">
          {t(
            'Choose configured steps, or choose a model and adjust its supported effort. Switching keeps your current selection and draft.',
          )}{' '}
          {t('Applies to desktop and to phones without their own setting.')}
        </p>
        <div className="settings-defaults grid [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] gap-3">
          <label>
            {t('Default set')}
            <Dropdown
              label={t('Default model set')}
              value={draft.defaultSetId}
              options={draft.sets.map((entry) => ({
                value: entry.id,
                label: entry.name || t('Unnamed set'),
              }))}
              onChange={(id) => {
                const entry = draft.sets.find((entry) => entry.id === id)!
                setDraft({ ...draft, defaultSetId: id, defaultStepId: entry.steps[0]!.id })
              }}
              disabled={busy}
            />
          </label>
          <label>
            {t('Default step')}
            <Dropdown
              label={t('Default model step')}
              value={draft.defaultStepId}
              options={draft.sets
                .find((entry) => entry.id === draft.defaultSetId)!
                .steps.map((step) => ({ value: step.id, label: modelStepName(step, catalogs) }))}
              onChange={(id) => setDraft({ ...draft, defaultStepId: id })}
              disabled={busy}
            />
          </label>
        </div>
        <div className="settings-set-toolbar [&_>_.dropdown-trigger]:flex-1 [&_>_.dropdown-trigger]:min-w-0 flex items-center gap-2">
          <Dropdown
            settingNavigation
            label={t('Edit model set')}
            value={set.id}
            options={draft.sets.map((entry) => ({ value: entry.id, label: entry.name || t('Unnamed set') }))}
            onChange={setSelected}
            disabled={busy}
          />
          <Button
            variant="ghost"
            className={GHOST_BUTTON_CLASS}
            disabled={busy || draft.sets.length >= MAX_MODEL_SETS}
            onClick={() => {
              const id = crypto.randomUUID()
              const steps = [{ ...set.steps[0]!, id: crypto.randomUUID() }]
              setDraft({ ...draft, sets: [...draft.sets, { id, name: 'New set', steps }] })
              setSelected(id)
            }}
          >
            <Plus size={13} />
            {t('Add set')}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={GHOST_ICON_BUTTON_CLASS}
            title={t('Remove set')}
            aria-label={t('Remove model set')}
            disabled={busy || automatic || draft.sets.length < 2}
            onClick={() => {
              const sets = draft.sets.filter((entry) => entry.id !== set.id)
              const fallback = sets[0]!
              setDraft({
                ...draft,
                sets,
                defaultSetId: draft.defaultSetId === set.id ? fallback.id : draft.defaultSetId,
                defaultStepId: draft.defaultSetId === set.id ? fallback.steps[0]!.id : draft.defaultStepId,
              })
              setSelected(fallback.id)
            }}
          >
            <Trash2 size={13} />
          </Button>
        </div>
        {automatic ? (
          <>
            <p className="text-muted-foreground text-caption">
              {t(
                'Default updates automatically from active providers. Add a custom set to edit model and effort choices.',
              )}
            </p>
            <ol className="settings-steps flex flex-col gap-2" aria-label={t('Automatic model steps')}>
              {set.steps.map((step, index) => (
                <li key={step.id} className="flex items-center gap-2 rounded-(--radius-s) bg-fill p-2.5">
                  <span className="text-muted-foreground text-caption">{index + 1}</span>
                  <span className="min-w-0 flex-1">{modelStepName(step, catalogs)}</span>
                  <span className="text-muted-foreground text-caption">{providerName(step.provider)}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <label className="settings-set-name">
              {t('Set name')}
              <Input
                value={set.name}
                maxLength={80}
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    sets: draft.sets.map((entry) =>
                      entry.id === set.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  })
                }
              />
            </label>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropStep}>
              <SortableContext items={set.steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
                <div className="settings-steps flex flex-col gap-2">
                  {set.steps.map((step, index) => (
                    <ModelStepCard
                      key={step.id}
                      step={step}
                      index={index}
                      count={set.steps.length}
                      models={models}
                      catalogs={catalogs}
                      busy={busy}
                      onMove={(delta) => move(index, delta)}
                      onRemove={() => updateSteps(set.steps.filter((entry) => entry.id !== step.id))}
                      onUpdate={(next) => updateSteps(set.steps.map((entry) => (entry.id === next.id ? next : entry)))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="settings-set-footer [&_>_span]:ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                className={GHOST_BUTTON_CLASS}
                disabled={busy || set.steps.length >= MAX_SET_STEPS}
                onClick={() => updateSteps([...set.steps, { ...set.steps.at(-1)!, id: crypto.randomUUID() }])}
              >
                <Plus size={13} />
                {t('Add step')}
              </Button>
              <span className="muted text-muted-foreground small text-caption">
                {set.steps.length} {t(' steps · up to 20')}
              </span>
            </div>
          </>
        )}
        <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between">
          <Button variant="ghost" className={GHOST_BUTTON_CLASS} disabled={busy} onClick={onRestore}>
            <RotateCcw size={13} />
            {t('Restore model sets')}
          </Button>
          <Button variant="ghost" className={GHOST_BUTTON_CLASS} disabled={busy} onClick={onRefresh}>
            {t('Refresh available models')}
          </Button>
        </div>
      </div>
    </SettingsField>
  )
}
