import { Button } from '@/components/desktop-button'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import type { DragEvent } from 'react'
import { providerName } from '@ramu/shared/providers'
import type { ModelStep } from '@ramu/shared/types'
import { setRowDragImage } from '../dragState'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { effortDisplayName, modelDisplayName, modelStepName } from '../ModelSets'
import type { useSettingsScope } from '../SettingsScope'
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
  dragging,
  dropBefore,
  dropAfter,
  onDragOver,
  onDrop,
  onDragEnd,
  onGripDragStart,
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
  dragging: boolean
  dropBefore: boolean
  dropAfter: boolean
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onGripDragStart: () => void
  onMove: (delta: number) => void
  onRemove: () => void
  onUpdate: (step: ModelStep) => void
}) {
  const model = models.find(
    (entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)),
  )
  const key = `${step.provider}:${step.model}`
  const options = models.map((entry) => ({
    value: `${entry.provider}:${entry.id}`,
    label: `${modelDisplayName(entry.name)} · ${providerName(entry.provider)}`,
  }))
  if (!options.some((option) => option.value === key))
    options.unshift({
      value: key,
      label: step.model
        ? t('{0} · Unavailable', { '0': step.model })
        : t('{0} default', { '0': providerName(step.provider) }),
    })
  return (
    <section
      className={`settings-step [&.dragging]:[opacity:0.45] [&.drop-before::before]:[content:''] [&.drop-before::before]:absolute [&.drop-before::before]:left-0 [&.drop-before::before]:right-0 [&.drop-before::before]:h-0.5 [&.drop-before::before]:[border-radius:1px] [&.drop-before::before]:[background:var(--accent)] [&.drop-before::before]:pointer-events-none [&.drop-before::before]:top-[-5px] [&.drop-after::after]:[content:''] [&.drop-after::after]:absolute [&.drop-after::after]:left-0 [&.drop-after::after]:right-0 [&.drop-after::after]:h-0.5 [&.drop-after::after]:[border-radius:1px] [&.drop-after::after]:[background:var(--accent)] [&.drop-after::after]:pointer-events-none [&.drop-after::after]:bottom-[-5px] p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) flex flex-col gap-2 relative bg-fill${dragging ? ' dragging' : ''}${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="settings-step-heading flex items-center gap-2">
        <span
          className="settings-step-grip [&:hover]:text-foreground [&:hover]:bg-hover [&:active]:[cursor:grabbing] inline-grid place-items-center w-[18px] h-[22px] flex-none ml-[-4px] text-muted-foreground cursor-grab rounded-(--radius-xs)"
          role="button"
          aria-label={t('Drag step {0} to reorder', { '0': index + 1 })}
          title={t('Drag to reorder')}
          draggable={!busy}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', String(index))
            const card = event.currentTarget.closest('.settings-step')
            setRowDragImage(event, card)
            onGripDragStart()
          }}
          onDragEnd={onDragEnd}
        >
          <GripVertical size={14} />
        </span>
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
          Model
          <Dropdown
            label={t('Step {0} model', { '0': index + 1 })}
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
        <label>
          {t('Effort')}
          <Dropdown
            label={t('Step {0} effort', { '0': index + 1 })}
            value={
              step.effort ??
              (step.provider === 'claude-code' || step.provider === 'codex' ? model?.defaultEffort : null) ??
              ''
            }
            disabled={busy || !model?.efforts.length}
            options={[
              ...(step.provider === 'claude-code' || step.provider === 'codex'
                ? []
                : [{ value: '', label: t('Default effort') }]),
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
      </div>
    </section>
  )
}
