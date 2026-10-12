import { t, useLanguage } from './i18n'
import { ChevronDown, LockOpen, Pencil, Sparkles } from 'lucide-react'
import type { AgentSettings } from '../../shared/types'
import { ModelBar } from './ModelBar'
import { Menu } from './Menu'

export const accessName = (access: AgentSettings['access']) => t(({ edits: 'Allow edits', auto: 'Auto', full: 'Full access' })[access])
const accessModes = [
  { key: 'edits', label: 'Allow edits', description: 'File edits go through; commands still ask first.', Icon: Pencil },
  { key: 'auto', label: 'Auto', description: 'Routine actions are approved for you where the provider supports it; the rest still ask.', Icon: Sparkles },
  { key: 'full', label: 'Full access', description: 'Commands and edits run without asking.', Icon: LockOpen },
] as const

export { providerName } from '../../shared/providers'
export function AgentControls({ settings, onChange, disabled = false, showAccess = true, trailing }: { settings: AgentSettings; onChange: (s: AgentSettings) => void; disabled?: boolean; showAccess?: boolean; trailing?: React.ReactNode }) {
  useLanguage()
  return <div className="agent-controls">
    <ModelBar settings={settings} onChange={onChange} disabled={disabled} />
    <div className="agent-control-options">
    {showAccess && <Menu label={t("Access mode")} className="control-btn" menuClassName="access-menu" disabled={disabled}
      icon={<>{settings.access === 'full' ? <LockOpen size={13} /> : settings.access === 'edits' ? <Pencil size={13} /> : <Sparkles size={13} />}{accessName(settings.access)}<ChevronDown size={12} /></>}
      items={accessModes.map(({ key, label, description, Icon }) => ({
        key, selected: settings.access === key,
        label: <span className="access-option"><span className="access-option-title"><Icon size={16} />{t(label)}</span><span className="muted block">{t(description)}</span></span>,
        onSelect: () => onChange({ ...settings, access: key }),
      }))} />}
    </div>
    {trailing}
  </div>
}
