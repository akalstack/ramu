import { t, useLanguage } from '../i18n'
import { ChevronDown, LockOpen, Pencil, Sparkles } from 'lucide-react'
import type { AgentProvider, AgentSettings } from '@ramu/shared/types'
import { ModelBar } from '../models/ModelBar'
import { Menu } from '../Menu'

const asksInAuto = (provider?: AgentProvider) => provider === 'antigravity'
export const accessName = (access: AgentSettings['access'], provider?: AgentProvider) =>
  t(
    access === 'auto' && asksInAuto(provider)
      ? 'Auto (rules)'
      : { edits: 'Allow edits', auto: 'Auto', full: 'Full access' }[access],
  )
const accessModes = [
  { key: 'edits', label: 'Allow edits', description: 'File edits go through; commands still ask first.', Icon: Pencil },
  {
    key: 'auto',
    label: 'Auto',
    description: 'Routine actions are approved for you where the provider supports it; the rest still ask.',
    Icon: Sparkles,
  },
  { key: 'full', label: 'Full access', description: 'Commands and edits run without asking.', Icon: LockOpen },
] as const

export { providerName } from '@ramu/shared/providers/providers'
export function AgentControls({
  settings,
  current,
  onChange,
  disabled = false,
  running = false,
  showAccess = true,
  trailing,
}: {
  settings: AgentSettings
  current?: AgentSettings
  onChange: (s: AgentSettings) => void
  disabled?: boolean
  running?: boolean
  showAccess?: boolean
  trailing?: React.ReactNode
}) {
  useLanguage()
  return (
    <div className="agent-controls flex items-center flex-wrap gap-[4px_8px] w-full min-w-0">
      <ModelBar settings={settings} current={current} onChange={onChange} disabled={disabled} running={running} />
      <div className="agent-control-options [&_.control-btn]:min-h-7 [&_.control-btn]:text-control flex items-center flex-wrap gap-[4px_8px]">
        {showAccess && (
          <Menu
            standard
            label={t('Access mode')}
            className="control-btn h-8 gap-2 px-2 text-sm"
            menuClassName="access-menu w-[380px] max-w-[calc(100vw_-_16px)]"
            disabled={disabled}
            icon={
              <>
                {settings.access === 'full' ? (
                  <LockOpen size={13} />
                ) : settings.access === 'edits' ? (
                  <Pencil size={13} />
                ) : (
                  <Sparkles size={13} />
                )}
                {accessName(settings.access, settings.provider)}
                <ChevronDown size={12} />
              </>
            }
            items={accessModes.map(({ key, label, description, Icon }) => ({
              key,
              selected: settings.access === key,
              label: (
                <span className="access-option [.access-menu_&]:block [.access-menu_&]:flex-1 [.access-menu_&]:min-w-0 [.access-menu_&]:max-w-[none] [.access-menu_&]:pr-7 [.access-menu_&_.block]:max-w-[none] [.access-menu_&_.block]:w-auto [.access-menu_&_.block]:m-[2px_0_0] [.access-menu_&_.block]:pl-0 [.access-menu_&_.block]:whitespace-normal [.access-menu_&_.muted]:max-w-[none] [.access-menu_&_.muted]:w-auto [.access-menu_&_.muted]:m-[2px_0_0] [.access-menu_&_.muted]:pl-0 [.access-menu_&_.muted]:whitespace-normal flex flex-col gap-[3px] w-full">
                  <span className="access-option-title flex items-center gap-2 text-[length:var(--ui-font-size)]">
                    <Icon size={16} />
                    {key === 'auto' ? accessName('auto', settings.provider) : t(label)}
                  </span>
                  <span className="muted text-muted-foreground block block">
                    {t(
                      key === 'auto' && asksInAuto(settings.provider)
                        ? 'Edits run automatically. Read-only command rules skip routine prompts; other commands ask.'
                        : key === 'auto' && settings.provider === 'opencode'
                          ? 'Approves permission requests automatically. OpenCode deny rules still apply.'
                          : key === 'full' && settings.provider === 'opencode'
                            ? 'Commands and edits run without asking, including anything your OpenCode rules would block.'
                            : description,
                    )}
                  </span>
                </span>
              ),
              onSelect: () => onChange({ ...settings, access: key }),
            }))}
          />
        )}
      </div>
      {trailing}
    </div>
  )
}
