// The settings menu's sections: the desktop draws them in this order and these groups; the phone shows the same
// sections under the same groups and names, with its own pages first (apps/mobile/src/runtime/settingsModel.ts).
// Labels are English copy keys, translated where they are drawn.

/** Each group is named for what the person is doing there: their own setup, the agents, the agents' tools, the host. */
export const SETTINGS_MENU_GROUPS = ['Personal', 'Agents', 'Agent tools', 'Access & host'] as const
export type SettingsMenuGroup = (typeof SETTINGS_MENU_GROUPS)[number]

/**
 * `phone: false` marks a section whose settings only matter at the host's own keyboard and screen (its editor, its
 * shortcuts); the phone leaves it out of its menu and says so once, rather than showing a page it cannot use.
 */
export const SETTINGS_MENU = [
  { id: 'appearance', label: 'Appearance', group: 'Personal', phone: true },
  { id: 'chats', label: 'Threads', group: 'Personal', phone: true },
  { id: 'editor', label: 'Editor & Terminal', group: 'Personal', phone: false },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Personal', phone: false },
  { id: 'providers', label: 'Providers', group: 'Agents', phone: true },
  { id: 'models', label: 'Models', group: 'Agents', phone: true },
  { id: 'agent-setup', label: 'Agent setup', group: 'Agents', phone: true },
  { id: 'plugins', label: 'Plugins', group: 'Agents', phone: true },
  { id: 'workflows', label: 'Goals & delegation', group: 'Agents', phone: true },
  { id: 'memory', label: 'Memory & learning', group: 'Agents', phone: true },
  { id: 'browser', label: 'Browser', group: 'Agent tools', phone: true },
  { id: 'computer', label: 'Computer', group: 'Agent tools', phone: true },
  { id: 'devices', label: 'Test devices', group: 'Agent tools', phone: true },
  { id: 'git', label: 'Git', group: 'Agent tools', phone: true },
  { id: 'access', label: 'Permissions', group: 'Access & host', phone: true },
  { id: 'identities', label: 'Identities', group: 'Access & host', phone: true },
  { id: 'remote', label: 'Devices & access', group: 'Access & host', phone: true },
  { id: 'account', label: 'Account', group: 'Access & host', phone: true },
  { id: 'system', label: 'Background', group: 'Access & host', phone: true },
  // The phone has its own About page, about the phone, so the host's never shows there.
  { id: 'about', label: 'About', group: 'Access & host', phone: true },
] as const satisfies readonly { id: string; label: string; group: SettingsMenuGroup; phone: boolean }[]

export type SettingsMenuId = (typeof SETTINGS_MENU)[number]['id']
export type PhoneSettingsMenuId = Extract<(typeof SETTINGS_MENU)[number], { phone: true }>['id']

/** The sections the phone leaves to the host, in menu order, for the one line that says where they are. */
export const HOST_ONLY_SECTIONS = SETTINGS_MENU.filter((entry) => !entry.phone).map((entry) => entry.label)
