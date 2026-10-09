import { ChevronDown, Lock, LockOpen, Pencil, Sparkles } from 'lucide-react'
import type { AgentSettings } from '../../shared/types'
import { ModelBar } from './ModelBar'
import { Menu } from './Menu'

export const accessName = (access: AgentSettings['access']) => ({ ask: 'Supervised', edits: 'Auto-accept edits', auto: 'Auto', full: 'Full access' })[access]
const accessModes = [
  { key: 'ask', label: 'Supervised', description: 'Ask before commands and file changes.', Icon: Lock },
  { key: 'edits', label: 'Auto-accept edits', description: 'Auto-approve edits, ask before other actions.', Icon: Pencil },
  { key: 'auto', label: 'Auto', description: 'Supported providers approve routine actions; others still ask.', Icon: Sparkles },
  { key: 'full', label: 'Full access', description: 'Allow commands and edits without prompts.', Icon: LockOpen },
] as const

export { providerName } from '../../shared/providers'
export function AgentControls({ settings, onChange, disabled = false, showAccess = true }: { settings: AgentSettings; onChange: (s: AgentSettings) => void; disabled?: boolean; showAccess?: boolean }) {
  return <div className="agent-controls">
    <ModelBar settings={settings} onChange={onChange} disabled={disabled} />
    <div className="agent-control-options">
    {showAccess && <Menu label="Access mode" className="control-btn" menuClassName="access-menu" disabled={disabled}
      icon={<>{settings.access === 'full' ? <LockOpen size={13} /> : settings.access === 'edits' ? <Pencil size={13} /> : settings.access === 'auto' ? <Sparkles size={13} /> : <Lock size={13} />}{accessName(settings.access)}<ChevronDown size={12} /></>}
      items={accessModes.map(({ key, label, description, Icon }) => ({
        key, selected: settings.access === key,
        label: <span className="access-option"><span className="access-option-title"><Icon size={16} />{label}</span><span className="muted block">{description}</span></span>,
        onSelect: () => onChange({ ...settings, access: key }),
      }))} />}
    </div>
  </div>
}
