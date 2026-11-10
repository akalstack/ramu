import { useState, type ComponentProps } from 'react'
import { Platform, View } from 'react-native'
import {
  Bell,
  Brain,
  CalendarClock,
  Cpu,
  Globe,
  GitBranch,
  Info,
  Layers,
  MessageSquare,
  MonitorCog,
  MonitorSmartphone,
  Palette,
  Plug,
  Puzzle,
  UsersRound,
  CircleUserRound,
  ShieldCheck,
  Smartphone,
  Target,
  type LucideIcon,
} from 'lucide-react-native'
import { radius, useTheme } from '../theme'
import { Header } from './Screen'
import { HostChipButton, HostSheet } from './HostChip'
import type { SettingsSection } from '../runtime/settingsModel'

// The desktop's icons for the same sections.
const icons: Record<SettingsSection, LucideIcon> = {
  appearance: Palette,
  git: GitBranch,
  browser: Globe,
  computer: MonitorCog,
  devices: Smartphone,
  chats: MessageSquare,
  providers: Cpu,
  models: Layers,
  'agent-setup': Plug,
  plugins: Puzzle,
  identities: UsersRound,
  account: CircleUserRound,
  access: ShieldCheck,
  workflows: Target,
  memory: Brain,
  system: CalendarClock,
  remote: MonitorSmartphone,
  notifications: Bell,
  about: Info,
}

/** The tinted square a section (or a view search finds, by its own icon) wears in the menu, as on the desktop. */
export function SectionIcon(props: { section: SettingsSection } | { icon: LucideIcon }) {
  const { c } = useTheme()
  const Icon = 'icon' in props ? props.icon : icons[props.section]
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: radius.s,
        backgroundColor: Platform.OS === 'android' ? 'transparent' : c.fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={16} color={c.soft} strokeWidth={1.8} />
    </View>
  )
}

/**
 * A settings screen's bar. With `host`, the host its pages edit stays named at the trailing edge, wherever the page is
 * scrolled, and switches from there.
 */
export function SettingsHeader({ host, ...props }: Omit<ComponentProps<typeof Header>, 'right'> & { host?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Header {...props} right={host ? <HostChipButton compact onOpen={() => setOpen(true)} /> : undefined} />
      {host ? <HostSheet open={open} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
