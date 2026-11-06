import type { InteractiveReference, InteractiveState, JsonValue } from './interactive'

/** A field type in a page's record schema; a trailing `?` makes the field optional. */
export type PageFieldType = 'string' | 'number' | 'boolean' | 'date' | 'file' | 'json'
export type PageField = PageFieldType | `${PageFieldType}?`

/** One named collection of records a page keeps on the host. */
export interface PageCollection {
  fields: Record<string, PageField>
  /** How records written by an earlier version fill fields this version adds or renames. */
  migrate?: Record<string, { from?: string; default?: JsonValue }>
}

/** A flow the page offers as a toolbar button, schedules can run and agents can start with page_run. */
export interface PageRunDeclaration {
  label: string
  prompt: string
}

export interface PageSchedule {
  /** A declared run, started on the host without the page being open. */
  run: string
  every: 'hourly' | 'daily' | 'weekly'
  /** Local time for daily and weekly runs, HH:MM. */
  at?: string
}

export interface PageTrigger {
  collection: string
  when: { field: string; op: '>' | '>=' | '<' | '<=' | '=' | '!='; value: string | number | boolean }
  /** A declared run to start, a notification to send, or both. */
  run?: string
  notify?: string
}

export interface PageWidget {
  title: string
  collection: string
  kind: 'number' | 'list'
  /** For number: the field to add up (count when absent) over the current month. */
  sum?: string
  /** For list: the field shown for the newest records. */
  label?: string
}

/** What a page declares it uses, in ramu.json or a `<meta name="ramu-capabilities">` tag. */
export interface PageCapabilities {
  records?: Record<string, PageCollection>
  ai?: {
    /** Why the page uses a model, in the person's words: shown in the grant sheet. */
    purpose: string
    quality?: 'fast' | 'smart'
    /** Requests a day; at most 500. */
    daily?: number
    /** Lets page runs search the web. */
    web?: boolean
    /** Shared MCP servers runs may use, each granted by the person. */
    mcp?: string[]
  }
  camera?: { purpose: string }
  notify?: { purpose: string; daily?: number }
  runs?: Record<string, PageRunDeclaration>
  schedules?: PageSchedule[]
  triggers?: PageTrigger[]
  widget?: PageWidget
  /** Records a webhook may add from outside, checked against the schema. */
  webhook?: { collection: string }
  /** One project folder the page may read, never write. */
  folder?: { path: string }
}

export type PageCapability = 'records' | 'ai' | 'camera' | 'notify' | 'schedules' | 'triggers' | 'webhook' | 'folder'

/** What the person allowed. A capability the page declares and is not granted fails with a clear error. */
export interface PageGrants {
  records?: boolean
  ai?: { model: 'fast' | 'smart'; daily: number; web?: boolean; mcp?: string[] }
  camera?: boolean
  notify?: boolean
  schedules?: boolean
  triggers?: boolean
  webhook?: { token: string } | false
  folder?: boolean
}

export interface PageError {
  message: string
  version: number
  at: number
  device?: string
  /** Steps before the error, as the frame reported them. */
  steps?: string[]
  state?: InteractiveState | null
}

export interface PagePublication {
  target: string
  url: string
  version: number
  at: number
}

export interface PageInfo {
  id: string
  title: string
  /** One emoji. */
  icon: string
  projectId: string | null
  pinned: boolean
  version: number
  createdAt: number
  changedAt: number
  /** The thread that published the current version. */
  sessionId: string
  capabilities: PageCapabilities
  grants: PageGrants
  /** Capabilities the current version declares that the person has not answered yet. */
  pendingGrants: PageCapability[]
  lastError?: PageError
  /** The project this page grew into, through Make it a project. */
  grewInto?: { projectId: string; taskId?: string }
  published?: PagePublication
  /** Page this one was duplicated from. */
  duplicatedFrom?: string
}

export interface PageVersion {
  reference: InteractiveReference
  /** Phone screenshot from its checks. */
  preview: string | null
}

export interface PageRecord {
  id: string
  collection: string
  data: Record<string, JsonValue>
  createdAt: number
  updatedAt: number
}

export interface PageRecordQuery {
  where?: { field: string; op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'contains'; value: JsonValue }[]
  sort?: { field: string; direction?: 'asc' | 'desc' }
  limit?: number
  /** Records created or dated in this range, by `field` (createdAt when absent). */
  range?: { field?: string; from?: string | number; to?: string | number }
}

export interface PageRunStep {
  at: number
  text: string
}

export interface PageRun {
  id: string
  pageId: string
  name: string | null
  task: string
  status: 'running' | 'done' | 'failed' | 'stopped' | 'undone'
  steps: PageRunStep[]
  answer?: JsonValue
  error?: string
  /** Record changes it made, so Undo run puts them back together. */
  changes: number
  startedAt: number
  finishedAt?: number
  source: 'page' | 'schedule' | 'trigger' | 'agent' | 'question'
  /** A page function the open page should run now, answered with pages.runReply. */
  call?: { id: string; name: string; input: Record<string, JsonValue> }
  /** Something only the person may allow, asked in the page's toolbar and answered with pages.runConfirm. */
  confirm?: { id: string; text: string }
}

export interface PageUsage {
  day: string
  ai: number
  notify: number
}

export interface PageShare {
  token: string
  pageId: string
  canAdd: boolean
  createdAt: number
  expiresAt: number
}

export const PAGE_LIMITS = {
  records: 10_000,
  bytes: 20_000_000,
  file: 2_000_000,
  state: 32_768,
  aiDaily: 500,
  notifyDaily: 5,
  runSteps: 12,
  runWrites: 200,
} as const

/** The capability names a declaration uses, in the order the grant sheet lists them. */
export function declaredCapabilities(capabilities: PageCapabilities): PageCapability[] {
  const list: PageCapability[] = []
  if (capabilities.records && Object.keys(capabilities.records).length) list.push('records')
  if (capabilities.ai) list.push('ai')
  if (capabilities.camera) list.push('camera')
  if (capabilities.notify) list.push('notify')
  if (capabilities.schedules?.length) list.push('schedules')
  if (capabilities.triggers?.length) list.push('triggers')
  if (capabilities.webhook) list.push('webhook')
  if (capabilities.folder) list.push('folder')
  return list
}

/** Declared capabilities the grants do not answer yet: shown in the grant sheet the next time the page opens. */
export function pendingGrants(capabilities: PageCapabilities, grants: PageGrants): PageCapability[] {
  return declaredCapabilities(capabilities).filter((name) => grants[name] === undefined)
}

/** Checks a record against its collection's fields; returns the first problem, or null. */
export function recordProblem(collection: PageCollection, data: Record<string, unknown>): string | null {
  for (const [name, declared] of Object.entries(collection.fields)) {
    const optional = declared.endsWith('?')
    const type = declared.replace('?', '') as PageFieldType
    const value = data[name]
    if (value === undefined || value === null) {
      if (!optional) return `${name} is required`
      continue
    }
    if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return `${name} must be a number`
    if (type === 'boolean' && typeof value !== 'boolean') return `${name} must be true or false`
    if ((type === 'string' || type === 'file') && typeof value !== 'string') return `${name} must be text`
    if (type === 'date' && (typeof value !== 'string' || Number.isNaN(Date.parse(value))))
      return `${name} must be a date such as 2026-11-06`
  }
  for (const name of Object.keys(data))
    if (!(name in collection.fields)) return `${name} is not a field of this collection`
  return null
}

/** Records that do not fit a new version's schema after its migration, by first problem. */
export function migrateRecord(
  collection: PageCollection,
  data: Record<string, JsonValue>,
): { data: Record<string, JsonValue>; problem: string | null } {
  const next: Record<string, JsonValue> = {}
  for (const name of Object.keys(collection.fields)) {
    const rule = collection.migrate?.[name]
    const value = data[name] ?? (rule?.from !== undefined ? data[rule.from] : undefined) ?? rule?.default
    if (value !== undefined) next[name] = value
  }
  return { data: next, problem: recordProblem(collection, next) }
}

/** The page's shared state and the revision a write must name, so two devices never overwrite each other blindly. */
export interface PageState {
  state: InteractiveState | null
  revision: number
}
