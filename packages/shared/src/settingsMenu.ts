// The settings menu's sections: the desktop draws them in this order and these groups; the phone shows the same
// sections under the same names, arranged for a phone (apps/mobile/src/runtime/settingsModel.ts). Labels are English
// copy keys, translated where they are drawn.

export const SETTINGS_MENU_GROUPS = ['Workspace', 'Agents', 'System'] as const
export type SettingsMenuGroup = (typeof SETTINGS_MENU_GROUPS)[number]

/**
 * `phone: false` marks a section whose settings only matter at the host's own keyboard and screen (its editor, its
 * shortcuts) or hold its secrets; the phone leaves it out of its menu and says so once, rather than showing a page it
 * cannot use.
 */
export const SETTINGS_MENU = [
  { id: 'appearance', label: 'Appearance', group: 'Workspace', phone: true },
  { id: 'editor', label: 'Editor & Terminal', group: 'Workspace', phone: false },
  { id: 'git', label: 'Git', group: 'Workspace', phone: true },
  { id: 'deploy', label: 'Deploy', group: 'Workspace', phone: true },
  { id: 'browser', label: 'Browser', group: 'Workspace', phone: true },
  { id: 'computer', label: 'Computer use', group: 'Workspace', phone: true },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Workspace', phone: false },
  { id: 'archived', label: 'Archived threads', group: 'Workspace', phone: true },
  { id: 'chats', label: 'Threads', group: 'Agents', phone: true },
  { id: 'providers', label: 'Providers', group: 'Agents', phone: true },
  { id: 'models', label: 'Models', group: 'Agents', phone: true },
  { id: 'environment', label: 'Environment variables', group: 'Agents', phone: false },
  { id: 'agent-setup', label: 'Agent setup', group: 'Agents', phone: true },
  { id: 'plugins', label: 'Plugins', group: 'Agents', phone: true },
  { id: 'identities', label: 'Identities', group: 'Agents', phone: true },
  { id: 'access', label: 'Permissions', group: 'Agents', phone: true },
  { id: 'workflows', label: 'Goals & delegation', group: 'Agents', phone: true },
  { id: 'memory', label: 'Memory & skills', group: 'Agents', phone: true },
  { id: 'system', label: 'Background & updates', group: 'System', phone: true },
  { id: 'remote', label: 'Remote access', group: 'System', phone: true },
  { id: 'account', label: 'Account', group: 'System', phone: true },
] as const satisfies readonly { id: string; label: string; group: SettingsMenuGroup; phone: boolean }[]

export type SettingsMenuId = (typeof SETTINGS_MENU)[number]['id']
export type PhoneSettingsMenuId = Extract<(typeof SETTINGS_MENU)[number], { phone: true }>['id']

/** The sections the phone leaves to the host, in menu order, for the one line that says where they are. */
export const HOST_ONLY_SECTIONS = SETTINGS_MENU.filter((entry) => !entry.phone).map((entry) => entry.label)
