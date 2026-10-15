import { SettingsField } from '../SettingsScope'
import type { useSettingsScope } from '../SettingsScope'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ModelPreferences, ModelStep } from '@ramu/shared/types'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { modelStepName } from '../ModelSets'
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
  const models = catalogs.flatMap((catalog) => catalog.models)
  const updateSteps = (steps: ModelStep[]) =>
    setDraft((current) => {
      const next = {
        ...current,
        sets: current.sets.map((entry) => (entry.id === set.id ? { ...entry, steps } : entry)),
      }
      if (next.defaultSetId === set.id && !steps.some((step) => step.id === next.defaultStepId))
        next.defaultStepId = steps[0]!.id
      return next
    })
  // Drag a step by its grip to reorder; a line shows where it will land.
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const endDrag = () => {
    setDragFrom(null)
    setDropAt(null)
  }
  const dropStep = () => {
    if (dragFrom !== null && dropAt !== null) {
      const steps = [...set.steps],
        moved = steps.splice(dragFrom, 1)[0]!
      steps.splice(dropAt > dragFrom ? dropAt - 1 : dropAt, 0, moved)
      updateSteps(steps)
    }
    endDrag()
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
            {t('Create model and effort presets for the chat selection bar.')}
          </p>
        </div>
        <label>
          {t('Default bar mode')}
          <Dropdown
            label={t('Default bar mode')}
            value={draft.defaultBarMode ?? 'model'}
            options={[
              { value: 'model', label: t('Model + effort') },
              { value: 'effort', label: t('Effort only') },
            ]}
            onChange={(mode) => setDraft({ ...draft, defaultBarMode: mode === 'effort' ? 'effort' : 'model' })}
            disabled={busy}
          />
        </label>
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
            disabled={busy || draft.sets.length < 2}
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
        <label className="settings-set-name">
          {t('Set name')}
          <Input
            value={set.name}
            maxLength={80}
            disabled={busy}
            onChange={(event) =>
              setDraft({
                ...draft,
                sets: draft.sets.map((entry) => (entry.id === set.id ? { ...entry, name: event.target.value } : entry)),
              })
            }
          />
        </label>
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
              dragging={dragFrom === index}
              dropBefore={dropAt === index}
              dropAfter={dropAt === set.steps.length && index === set.steps.length - 1}
              onDragOver={(event) => {
                if (dragFrom === null) return
                event.preventDefault()
                const box = event.currentTarget.getBoundingClientRect()
                setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1)
              }}
              onDrop={(event) => {
                event.preventDefault()
                dropStep()
              }}
              onDragEnd={endDrag}
              onGripDragStart={() => setDragFrom(index)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => updateSteps(set.steps.filter((entry) => entry.id !== step.id))}
              onUpdate={(next) => updateSteps(set.steps.map((entry) => (entry.id === next.id ? next : entry)))}
            />
          ))}
        </div>
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
