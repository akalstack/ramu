import { translate } from '@ramu/shared/i18n'
import type { ModelFlow } from '@ramu/shared/modelFlow'
import { useStore } from '../runtime/store'
import { useModelFlow } from '../runtime/useModelFlow'
import type { ScopedChoiceControl } from '../runtime/useScopedChoice'
import { ScopedChoiceRow } from './ScopedChoiceRow'

/** Steps versus Model then effort, for all devices, all your phones or this phone. */
export function ModelFlowRow({
  title,
  help,
  options,
  save,
  disabled,
}: {
  title: string
  help?: string
  options: { value: unknown; label: string }[]
  /** Saves the computer's own setting (the all-device baseline). */
  save: (value: ModelFlow) => void
  disabled?: boolean
}) {
  const { language, selected, computers } = useStore()
  const flow = useModelFlow(selected)
  const viewer = computers.find((computer) => computer.id === selected)?.access === 'viewer'
  const tr = (text: string) => translate(language, text)
  const control: ScopedChoiceControl<ModelFlow> = {
    effective: flow.effective,
    held: { all: flow.host, ...flow.held },
    // Clearing the setting for all your phones leaves phones without their own choice on the computer's setting.
    inherited: (scope) => (scope === 'mobile' ? { value: flow.host, source: 'all' } : flow.inherited(scope)),
    blocked: {
      ...(disabled ? { all: 'permission' as const } : {}),
      ...(!flow.sharedAvailable ? { mobile: 'host-update' as const } : viewer ? { mobile: 'viewer' as const } : {}),
    },
    pending: flow.pending,
    error: flow.error,
    set(scope, value) {
      if (scope === 'device') flow.setDevice(value)
      else if (scope === 'mobile') void flow.setMobile(value)
      else if (value && !disabled) save(value)
    },
  }
  return (
    <ScopedChoiceRow<ModelFlow>
      title={title}
      help={help ? tr(help) : undefined}
      options={options.map((o) => ({ key: o.value as ModelFlow, label: tr(o.label) }))}
      control={control}
    />
  )
}
