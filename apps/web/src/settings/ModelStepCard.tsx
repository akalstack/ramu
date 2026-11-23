import { DragHandle } from '@/components/drag-handle'
import { Button } from '@/components/desktop-button'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ModelStep } from '@ramu/shared/types'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { useAppSettings } from './AppSettings'
import { effortDisplayName, modelStepName } from '../models/ModelSets'
import { missingModelOption, modelOption } from '../models/modelOptions'
import { Combobox } from '@/components/combobox'
import type { useSettingsScope } from './SettingsScope'
import { GHOST_ICON_BUTTON_CLASS } from './constants'

type Catalogs = ReturnType<typeof useSettingsScope>['catalogs']
type CatalogModel = Catalogs[number]['models'][number]

export function ModelStepCard({
  step,
  index,
  count,
  models,
  catalogs,
  busy,
  onMove,
  onRemove,
  onUpdate,
}: {
  step: ModelStep
  index: number
  count: number
  models: CatalogModel[]
  catalogs: Catalogs
  busy: boolean
  onMove: (delta: number) => void
  onRemove: () => void
  onUpdate: (step: ModelStep) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: busy || count < 2,
  })
  const model = models.find(
    (entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)),
  )
  const key = `${step.provider}:${step.model}`
  const { visibleModels } = useAppSettings().preferences
  const options = models
    .filter((entry) => isModelListed(visibleModels, entry) || `${entry.provider}:${entry.id}` === key)
    .map((entry) => modelOption(entry, `${entry.provider}:${entry.id}`))
  if (!options.some((option) => option.value === key))
    options.unshift(missingModelOption(step.provider, step.model, key))
  return (
    <section
      ref={setNodeRef}
      className="settings-step p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) flex flex-col gap-2 relative bg-fill"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <div className="settings-step-heading flex items-center gap-2">
        <DragHandle
          ref={setActivatorNodeRef}
          className="settings-step-grip ml-[-4px]"
          aria-label={t('Drag step {0} to reorder', { '0': index + 1 })}
          title={t('Drag to reorder')}
          disabled={busy || count < 2}
          {...attributes}
          {...listeners}
        />
        <span className="settings-step-number w-[18px] flex-none text-muted-foreground text-caption text-center">
          {index + 1}
        </span>
        <span className="settings-step-name flex-1 min-w-0 [overflow-wrap:anywhere]">
          {modelStepName(step, catalogs)}
        </span>
        <div className="settings-step-actions flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className={GHOST_ICON_BUTTON_CLASS}
            title={t('Move step up')}
            aria-label={t('Move step {0} up', { '0': index + 1 })}
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={GHOST_ICON_BUTTON_CLASS}
            title={t('Move step down')}
            aria-label={t('Move step {0} down', { '0': index + 1 })}
            disabled={busy || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={GHOST_ICON_BUTTON_CLASS}
            title={t('Remove step')}
            aria-label={t('Remove step {0}', { '0': index + 1 })}
            disabled={busy || count < 2}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
      <div className="settings-step-controls grid [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] gap-3">
        <label>
          {t('Model')}
          <Combobox
            label={t('Step {0} model', { '0': index + 1 })}
            searchPlaceholder={t('Search models')}
            emptyText={t('No matching models')}
            value={key}
            options={options}
            disabled={busy}
            onChange={(value) => {
              const entry = models.find((entry) => `${entry.provider}:${entry.id}` === value)
              if (entry)
                onUpdate({
                  ...step,
                  provider: entry.provider,
                  model: entry.id,
                  effort: step.effort && entry.efforts.includes(step.effort) ? step.effort : entry.defaultEffort,
                })
            }}
          />
        </label>
        {!!model?.efforts.length && (
          <label>
            {t('Effort')}
            <Dropdown
              label={t('Step {0} effort', { '0': index + 1 })}
              value={step.effort ?? model?.defaultEffort ?? ''}
              disabled={busy || !model?.efforts.length}
              options={[
                ...(model?.efforts ?? []).map((effort) => ({
                  value: effort,
                  label: effortDisplayName(effort, step.provider),
                })),
              ]}
              onChange={(effort) =>
                onUpdate({ ...step, effort: model?.efforts.find((entry) => entry === effort) ?? null })
              }
            />
          </label>
        )}
      </div>
    </section>
  )
}
