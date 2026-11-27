// Moving settings between hosts: **Copy settings from…** a paired host, and **Export settings** / **Import settings**
// as a file for a machine with no paired host. Only portable groups move; executable paths, credentials, account
// tokens, workspace state and device permissions never do. Every import is reviewed value by value first. Plugins,
// skills and MCP servers move as their setup and wait on the receiving host for their own install review.
import { z } from 'zod'
import { identitySchema, type IdentitySettings } from './identities'
import {
  portableToolSchema,
  skippedToolSchema,
  toolState,
  type PortableTool,
  type ToolKind,
  type ToolsHere,
} from './toolSync'
import type { AppPreferences, ModelPreferences } from './types'

export const TRANSFER_GROUPS = [
  {
    id: 'appearance',
    label: 'Appearance',
    keys: [
      'language',
      'accent',
      'fontFamily',
      'fontSize',
      'fontSmoothing',
      'reduceMotion',
      'defaultMarkdownView',
      'editorFontSize',
      'terminalFontSize',
      'previewTabs',
      'terminalTabPosition',
      'defaultTerminalDock',
      'sidebarWidth',
      'recentChatMode',
      'threadRowBranches',
      'showUsageLimits',
    ],
  },
  {
    id: 'models',
    label: 'Models and abilities',
    keys: [
      'favoriteModels',
      'visibleModels',
      'fallback',
      'subagents',
      'abilities',
      'advisor',
      'modelCatalogLookups',
      'newModelNotices',
    ],
  },
  {
    id: 'agents',
    label: 'Agent defaults',
    keys: [
      'defaultAccess',
      'defaultAutoFallback',
      'busyMessageAction',
      'includeTabContext',
      'warnModelChange',
      'autoProjectSelection',
      'agentThreads',
      'asyncQuestions',
      'suggestNextMessage',
      'suggestTools',
      'autoBackgroundSeconds',
      'goals',
      'intelligence',
      'memory',
      'resumeChatsOnRestart',
    ],
  },
  {
    id: 'git',
    label: 'Git and commit style',
    keys: [
      'pullMode',
      'autoPull',
      'removeAgentCredits',
      'autoWatchPullRequests',
      'commitStyle',
      'commitInstructions',
      'defaultCommitAction',
      'defaultCommitBranch',
      'commitModel',
      'asideModel',
    ],
  },
  { id: 'notifications', label: 'Notifications', keys: ['notifyAgentDone'] },
  { id: 'rules', label: 'Rules', keys: [] },
  { id: 'identities', label: 'Identities', keys: [] },
  { id: 'memories', label: 'Everywhere notes', keys: [] },
  { id: 'plugins', label: 'Plugins', keys: [] },
  { id: 'skills', label: 'Skills', keys: [] },
  { id: 'mcp', label: 'MCP servers', keys: [] },
] as const
export type TransferGroup = (typeof TRANSFER_GROUPS)[number]['id']
export const TRANSFER_GROUP_IDS = TRANSFER_GROUPS.map((group) => group.id) as TransferGroup[]

const TOOL_LABEL: Record<ToolKind, string> = { plugin: 'Plugin', skill: 'Skill', mcp: 'MCP server' }

/** The group each kind of tool travels in. */
export const TOOL_GROUP: Record<ToolKind, TransferGroup> = { plugin: 'plugins', skill: 'skills', mcp: 'mcp' }

/** Groups checked by default; identities only when the source has more than its default, and notes never. */
export function defaultGroups(file: Pick<SettingsExport, 'identities'>): TransferGroup[] {
  return TRANSFER_GROUP_IDS.filter(
    (group) => group !== 'memories' && (group !== 'identities' || (file.identities?.identities.length ?? 0) >= 2),
  )
}

const rule = z.object({
  name: z.string().max(240),
  body: z.string().max(16_000),
  activation: z.enum(['always', 'manual', 'paths']),
  paths: z.array(z.string().max(400)).max(40),
  providers: z.array(z.string().max(40)).max(10),
  enabled: z.boolean(),
  /** An identity's id for a rule limited to one; projects never move between hosts. */
  identityId: z.string().max(100).nullable(),
})
const note = z.object({
  kind: z.enum(['user', 'feedback']),
  title: z.string().max(200),
  content: z.string().max(8000),
  tags: z.array(z.string().max(60)).max(20),
  importance: z.number().int().min(1).max(5),
})
/** An identity's account, by what it means on any host: its kind and sign-in email, never an id or a token. */
const portableAccount = z.object({
  kind: z.string().max(40),
  label: z.string().max(200),
  email: z.string().max(200).nullable(),
  identities: z.array(z.string().max(100)).max(12),
})

export const settingsExportSchema = z.object({
  format: z.literal('ramu-settings'),
  version: z.literal(2),
  exportedAt: z.number().int(),
  host: z.string().max(200),
  groups: z.array(z.enum(TRANSFER_GROUP_IDS as [TransferGroup, ...TransferGroup[]])).max(TRANSFER_GROUPS.length),
  preferences: z.record(z.string().max(60), z.unknown()),
  models: z.unknown().optional(),
  rules: z.array(rule).max(500).optional(),
  identities: z
    .object({
      identities: z.array(identitySchema).max(12),
      accounts: z.array(portableAccount).max(200),
    })
    .optional(),
  memories: z.array(note).max(2000).optional(),
  /** Plugins, skills and MCP servers as their setup, never a key or a path; each is reviewed again where it lands. */
  tools: z.array(portableToolSchema).max(300).optional(),
  /** Tools that stay on the source host, so the review says so. */
  skippedTools: z.array(skippedToolSchema).max(300).optional(),
})
export type SettingsExport = z.infer<typeof settingsExportSchema>
export type PortableRule = z.infer<typeof rule>
export type PortableNote = z.infer<typeof note>
export type PortableAccount = z.infer<typeof portableAccount>

/** The preferences a set of groups covers, and nothing else. */
export function portablePreferences(
  preferences: AppPreferences,
  groups: readonly TransferGroup[],
): Record<string, unknown> {
  const keys = new Set<string>(
    TRANSFER_GROUPS.filter((group) => groups.includes(group.id)).flatMap((group) => [...group.keys]),
  )
  return Object.fromEntries(Object.entries(preferences).filter(([key]) => keys.has(key)))
}

export interface TransferChange {
  group: TransferGroup
  /** A setting's path, `Rule: <name>`, `Identity: <name>`, `Note: <title>`, or a plugin, skill or server's name. */
  label: string
  before: string | null
  after: string
}

const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 200)

/** Leaf values of an object as dotted paths, so a review names `fallback.switchAt` rather than all of `fallback`. */
function leaves(value: unknown, prefix: string, out: Map<string, unknown>) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) leaves(entry, prefix ? `${prefix}.${key}` : key, out)
  } else out.set(prefix, value)
  return out
}

/** Every value an import would change on this host, for the review list before **Copy** or **Import**. */
export function transferChanges(
  current: {
    preferences: AppPreferences
    models: ModelPreferences | null
    rules: { name: string; body: string }[]
    identities: IdentitySettings
    notes: { title: string }[]
    tools?: ToolsHere
  },
  file: SettingsExport,
  groups: readonly TransferGroup[],
): TransferChange[] {
  const changes: TransferChange[] = []
  const groupOf = (key: string) => TRANSFER_GROUPS.find((group) => (group.keys as readonly string[]).includes(key))?.id
  const before = leaves(portablePreferences(current.preferences, groups), '', new Map())
  const after = leaves(
    Object.fromEntries(Object.entries(file.preferences).filter(([key]) => groups.includes(groupOf(key)!))),
    '',
    new Map(),
  )
  for (const [path, value] of after) {
    const group = groupOf(path.split('.')[0]!)
    if (!group || JSON.stringify(before.get(path)) === JSON.stringify(value)) continue
    changes.push({ group, label: path, before: before.has(path) ? shown(before.get(path)) : null, after: shown(value) })
  }
  if (
    groups.includes('models') &&
    file.models !== undefined &&
    JSON.stringify(file.models) !== JSON.stringify(current.models)
  )
    changes.push({
      group: 'models',
      label: 'Model sets',
      before: current.models ? 'This host’s sets' : null,
      after: 'The source’s sets',
    })
  if (groups.includes('rules'))
    for (const entry of file.rules ?? [])
      if (!current.rules.some((existing) => existing.name === entry.name && existing.body === entry.body))
        changes.push({
          group: 'rules',
          label: `Rule: ${entry.name}`,
          before: current.rules.some((existing) => existing.name === entry.name) ? 'Different text' : null,
          after: shown(entry.body),
        })
  if (groups.includes('identities'))
    for (const identity of file.identities?.identities ?? []) {
      const existing = current.identities.identities.find((entry) => entry.id === identity.id)
      const value = `${identity.gitAuthor.name} <${identity.gitAuthor.email}>, ${identity.rules.length} rules`
      if (!existing)
        changes.push({ group: 'identities', label: `Identity: ${identity.name}`, before: null, after: value })
      else if (
        JSON.stringify({ ...existing, createdAt: 0, isDefault: false }) !==
        JSON.stringify({ ...identity, createdAt: 0, isDefault: false })
      )
        changes.push({
          group: 'identities',
          label: `Identity: ${identity.name}`,
          before: `${existing.gitAuthor.name} <${existing.gitAuthor.email}>, ${existing.rules.length} rules`,
          after: value,
        })
    }
  if (groups.includes('memories'))
    for (const entry of file.memories ?? [])
      if (!current.notes.some((existing) => existing.title === entry.title))
        changes.push({ group: 'memories', label: `Note: ${entry.title}`, before: null, after: shown(entry.content) })
  if (current.tools) changes.push(...toolChanges(file.tools ?? [], current.tools, groups))
  return changes
}

/** What each tool from the file would become here: new, an update, or one to connect on this host first. */
export function toolChanges(tools: PortableTool[], here: ToolsHere, groups: readonly TransferGroup[]) {
  const changes: TransferChange[] = []
  for (const tool of tools) {
    const group = TOOL_GROUP[tool.kind]
    if (!groups.includes(group)) continue
    const state = toolState(tool, here)
    if (state === 'same') continue
    changes.push({
      group,
      label: `${TOOL_LABEL[tool.kind]}: ${tool.name}`,
      before: state === 'new' ? null : state === 'update' ? 'Another version' : 'Not set up here',
      after:
        state === 'connect-here' && tool.kind === 'mcp' && tool.transport.type === 'stdio'
          ? `Waits for review; needs ${tool.transport.command} on this host`
          : 'Waits for review here',
    })
  }
  return changes
}
