import { Platform, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Archive,
  Bell,
  Brain,
  CalendarClock,
  ChevronRight,
  Cpu,
  Globe,
  GitBranch,
  Info,
  Layers,
  MessageSquare,
  Monitor,
  MonitorCog,
  MonitorSmartphone,
  Palette,
  Plug,
  ShieldCheck,
  Target,
  type LucideIcon,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import type { SettingsSection } from '../runtime/settingsModel'
import type { useHostSettings } from '../runtime/useHostSettings'
import { Card, ConnectionDot, Row, T } from './ui'

// The desktop's icons for the same sections.
const icons: Record<SettingsSection, LucideIcon> = {
  appearance: Palette,
  git: GitBranch,
  browser: Globe,
  computer: MonitorCog,
  archived: Archive,
  chats: MessageSquare,
  providers: Cpu,
  models: Layers,
  'agent-setup': Plug,
  access: ShieldCheck,
  workflows: Target,
  memory: Brain,
  system: CalendarClock,
  remote: MonitorSmartphone,
  notifications: Bell,
  about: Info,
}

/** The tinted square a section wears in the menu, like the desktop's section icons. */
export function SectionIcon({ section }: { section: SettingsSection }) {
  const { c } = useTheme()
  const Icon = icons[section]
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

/** Which computer's settings the page edits, as the desktop's "Changes apply to the selected computer" bar. */
export function ComputerScope({ host }: { host: ReturnType<typeof useHostSettings> }) {
  const { c } = useTheme()
  const router = useRouter()
  const { computers, selected } = useStore()
  const pc = computers.find((computer) => computer.id === selected)
  if (!pc) return null
  return (
    <Card style={{ marginHorizontal: space.l }}>
      <Row accessibilityRole="button" onPress={() => router.push('/computers')} style={{ paddingVertical: space.m }}>
        <Monitor size={17} color={c.soft} />
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="500">{pc.name}</T>
          <T size={font.caption} tone="muted">
            {host.state.status === 'ready'
              ? 'Host settings apply here'
              : host.state.status === 'loading'
                ? 'Loading settings…'
                : host.state.status === 'offline'
                  ? 'Offline: host settings are unavailable'
                  : 'Could not load settings'}
          </T>
        </View>
        <ConnectionDot status={pc.status} />
        <ChevronRight size={16} color={c.muted} />
      </Row>
    </Card>
  )
}
