import { t, useLanguage } from '../i18n'
import { Check } from 'lucide-react'
import type { AgentModel, AgentSettings } from '@ramu/shared/types'
import { MenuItems, type MenuEntry } from '../Menu'
import { effortDisplayName } from './ModelSets'

export function ReasoningPicker({
  settings,
  model,
  onChange,
  onDone,
}: {
  settings: AgentSettings
  model?: AgentModel
  onChange: (settings: AgentSettings) => void
  onDone: () => void
}) {
  useLanguage()
  const fastSupported =
    settings.provider === 'codex' && !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  const selectedEffort = settings.effort ?? model?.defaultEffort ?? null
  const items: MenuEntry[] = [
    ...((model?.efforts.length ?? 0) > 0 ? [{ key: 'reasoning', heading: t('Reasoning') }] : []),
    ...(model?.efforts ?? []).map((effort) => ({
      key: effort,
      selected: selectedEffort === effort,
      label: (
        <>
          <span className="grow flex-1 min-w-0 text-left">{effortDisplayName(effort, settings.provider)}</span>
          {selectedEffort === effort && <Check size={13} />}
        </>
      ),
      onSelect: () => onChange({ ...settings, effort }),
    })),
  ]
  if (settings.provider === 'codex')
    items.push(
      { key: 'separator', separator: true },
      { key: 'tier', heading: t('Service Tier') },
      {
        key: 'standard',
        selected: settings.serviceTier !== 'fast',
        label: (
          <>
            <span className="grow flex-1 min-w-0 text-left">{t('Standard')}</span>
            {settings.serviceTier !== 'fast' && <Check size={13} />}
          </>
        ),
        onSelect: () => onChange({ ...settings, serviceTier: 'standard' }),
      },
      {
        key: 'fast',
        selected: settings.serviceTier === 'fast',
        disabled: !fastSupported,
        label: (
          <>
            <span className="grow flex-1 min-w-0 text-left">
              {t('Fast')}
              <span className="muted text-muted-foreground block block">
                {fastSupported ? t('Faster responses, higher usage') : t('Unavailable for this model')}
              </span>
            </span>
            {settings.serviceTier === 'fast' && <Check size={13} />}
          </>
        ),
        onSelect: () => onChange({ ...settings, serviceTier: 'fast' }),
      },
    )
  return (
    <div role="menu" aria-label={t('Reasoning and service tier')}>
      <MenuItems items={items} close={onDone} />
    </div>
  )
}
