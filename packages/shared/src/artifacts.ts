import type { InteractiveReference, InteractiveState, JsonValue } from './interactive'

/** A field type in an artifact's record schema; a trailing `?` makes the field optional. */
export type ArtifactFieldType = 'string' | 'number' | 'boolean' | 'date' | 'file' | 'json'
export type ArtifactField = ArtifactFieldType | `${ArtifactFieldType}?`

/** One named collection of records an artifact keeps on the host. */
export interface ArtifactCollection {
  fields: Record<string, ArtifactField>
  /** How records written by an earlier version fill fields this version adds or renames. */
  migrate?: Record<string, { from?: string; default?: JsonValue }>
}

/** A flow the artifact offers as a toolbar button, schedules can run and agents can start with artifact_run. */
export interface ArtifactRunDeclaration {
  label: string
  prompt: string
}

export interface ArtifactSchedule {
  /** A declared run, started on the host without the artifact being open. */
  run: string
  every: 'hourly' | 'daily' | 'weekly'
  /** Local time for daily and weekly runs, HH:MM. */
  at?: string
}

export interface ArtifactTrigger {
  collection: string
  when: { field: string; op: '>' | '>=' | '<' | '<=' | '=' | '!='; value: string | number | boolean }
  /** A declared run to start, a notification to send, or both. */
  run?: string
  notify?: string
}

export interface ArtifactWidget {
  title: string
  collection: string
  kind: 'number' | 'list'
  /** For number: the field to add up (count when absent) over the current month. */
  sum?: string
  /** For list: the field shown for the newest records. */
  label?: string
}

/** What an artifact declares it uses, in ramu.json or a `<meta name="ramu-capabilities">` tag. */
export interface ArtifactCapabilities {
  records?: Record<string, ArtifactCollection>
  ai?: {
    /** Why the artifact uses a model, in the person's words: shown in the grant sheet. */
    purpose: string
    quality?: 'fast' | 'smart'
    /** Requests a day; at most 500. */
    daily?: number
    /** Lets artifact runs search the web. */
    web?: boolean
    /** Shared MCP servers runs may use, each granted by the person. */
    mcp?: string[]
  }
  camera?: { purpose: string }
  notify?: { purpose: string; daily?: number }
  runs?: Record<string, ArtifactRunDeclaration>
  schedules?: ArtifactSchedule[]
  triggers?: ArtifactTrigger[]
  widget?: ArtifactWidget
  /** Records a webhook may add from outside, checked against the schema. */
  webhook?: { collection: string }
  /** One project folder the artifact may read, never write. */
  folder?: { path: string }
  /** Figures the person already sees in Ramu, read-only, each source granted on its own. */
  ramu?: { purpose: string; sources: RamuDataSource[] }
}

/** Ramu's own figures an artifact may read: token activity by day, thread titles and states, and pull requests. */
export type RamuDataSource = 'activity' | 'threads' | 'pullRequests'

export type ArtifactCapability =
  'records' | 'ai' | 'camera' | 'notify' | 'schedules' | 'triggers' | 'webhook' | 'folder' | 'ramu'

/** What the person allowed. A capability the artifact declares and is not granted fails with a clear error. */
export interface ArtifactGrants {
  records?: boolean
  /** False when the person said no; absent until they answer. */
  ai?: { model: 'fast' | 'smart'; daily: number; web?: boolean; mcp?: string[] } | false
  camera?: boolean
  notify?: boolean
  schedules?: boolean
  triggers?: boolean
  webhook?: { token: string } | false
  folder?: boolean
  /** The Ramu data sources allowed, or false when the person said no. */
  ramu?: RamuDataSource[] | false
}

export interface ArtifactError {
  message: string
  version: number
  at: number
  device?: string
  /** Steps before the error, as the frame reported them. */
  steps?: string[]
  state?: InteractiveState | null
}

export interface ArtifactPublication {
  target: string
  url: string
  version: number
  at: number
  /** The platform's id for the site, so Update live site deploys to the same one. */
  siteId?: string
}

/**
 * What an artifact is: an App is interactive web content, a Doc is writing to keep, a Diagram is a drawing, Slides is a
 * deck.
 */
export const ARTIFACT_KINDS = ['app', 'doc', 'diagram', 'slides', 'dashboard', 'design', 'motion'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/** A stored or received kind; anything this build does not know opens as the web page every kind renders as. */
export function artifactKind(value: unknown): ArtifactKind {
  return (ARTIFACT_KINDS as readonly unknown[]).includes(value) ? (value as ArtifactKind) : 'app'
}

/** How a Diagram is written. */
export type DiagramFormat = 'mermaid' | 'svg'

/**
 * The files a Doc, Diagram or Slides version keeps as its source. A Mermaid diagram also keeps its drawing as SVG, and a
 * deck keeps its images beside its slide list.
 */
export const ARTIFACT_SOURCE_FILES = {
  doc: 'document.md',
  mermaid: 'diagram.mmd',
  svg: 'diagram.svg',
  slides: 'slides.json',
  dashboard: 'dashboard.json',
  design: 'design.json',
  motion: 'motion.json',
} as const

/**
 * The text a person edits in place for a doc (its Markdown) or a diagram written in Mermaid (its source, labels
 * included); null for kinds edited another way, or not at all.
 */
export function editableSource(document: {
  reference: { kind?: ArtifactKind }
  files?: { path: string; content: string }[]
}): string | null {
  const path =
    document.reference.kind === 'doc'
      ? ARTIFACT_SOURCE_FILES.doc
      : document.reference.kind === 'diagram'
        ? ARTIFACT_SOURCE_FILES.mermaid
        : null
  return (path && document.files?.find((file) => file.path === path)?.content) ?? null
}

export interface ArtifactInfo {
  id: string
  kind: ArtifactKind
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
  capabilities: ArtifactCapabilities
  grants: ArtifactGrants
  /** Capabilities the current version declares that the person has not answered yet. */
  pendingGrants: ArtifactCapability[]
  lastError?: ArtifactError
  /** The project this artifact grew into, through Make it a project. */
  grewInto?: { projectId: string; taskId?: string }
  published?: ArtifactPublication
  /** Artifact this one was duplicated from. */
  duplicatedFrom?: string
}

export interface ArtifactVersion {
  reference: InteractiveReference
  /** Phone screenshot from its checks. */
  preview: string | null
  /** Desktop screenshot from the same checks, when it was kept. */
  wide?: string | null
}

export interface ArtifactRecord {
  id: string
  collection: string
  data: Record<string, JsonValue>
  createdAt: number
  updatedAt: number
}

export interface ArtifactRecordQuery {
  where?: { field: string; op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'contains'; value: JsonValue }[]
  sort?: { field: string; direction?: 'asc' | 'desc' }
  limit?: number
  /** Records created or dated in this range, by `field` (createdAt when absent). */
  range?: { field?: string; from?: string | number; to?: string | number }
}

export interface ArtifactRunStep {
  at: number
  text: string
}

export interface ArtifactRun {
  id: string
  artifactId: string
  name: string | null
  task: string
  status: 'running' | 'done' | 'failed' | 'stopped' | 'undone'
  steps: ArtifactRunStep[]
  answer?: JsonValue
  error?: string
  /** Record changes it made, so Undo run puts them back together. */
  changes: number
  startedAt: number
  finishedAt?: number
  source: 'artifact' | 'schedule' | 'trigger' | 'agent' | 'question'
  /** An artifact function the open artifact should run now, answered with artifacts.runReply. */
  call?: { id: string; name: string; input: Record<string, JsonValue> }
  /** Something only the person may allow, asked in the artifact's toolbar and answered with artifacts.runConfirm. */
  confirm?: { id: string; text: string }
}

export interface ArtifactUsage {
  day: string
  ai: number
  notify: number
}

export interface ArtifactShare {
  token: string
  artifactId: string
  canAdd: boolean
  createdAt: number
  expiresAt: number
}

export const ARTIFACT_LIMITS = {
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
export function declaredCapabilities(capabilities: ArtifactCapabilities): ArtifactCapability[] {
  const list: ArtifactCapability[] = []
  if (capabilities.records && Object.keys(capabilities.records).length) list.push('records')
  if (capabilities.ai) list.push('ai')
  if (capabilities.camera) list.push('camera')
  if (capabilities.notify) list.push('notify')
  if (capabilities.schedules?.length) list.push('schedules')
  if (capabilities.triggers?.length) list.push('triggers')
  if (capabilities.webhook) list.push('webhook')
  if (capabilities.folder) list.push('folder')
  if (capabilities.ramu?.sources.length) list.push('ramu')
  return list
}

/** Declared capabilities the grants do not answer yet: shown in the grant sheet the next time the artifact opens. */
export function pendingGrants(capabilities: ArtifactCapabilities, grants: ArtifactGrants): ArtifactCapability[] {
  return declaredCapabilities(capabilities).filter((name) => grants[name] === undefined)
}

/** Checks a record against its collection's fields; returns the first problem, or null. */
export function recordProblem(collection: ArtifactCollection, data: Record<string, unknown>): string | null {
  for (const [name, declared] of Object.entries(collection.fields)) {
    const optional = declared.endsWith('?')
    const type = declared.replace('?', '') as ArtifactFieldType
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
  collection: ArtifactCollection,
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

/** The artifact's shared state and the revision a write must name, so two devices never overwrite each other blindly. */
export interface ArtifactState {
  state: InteractiveState | null
  revision: number
}

/** An artifact opened to people without Ramu: its own tunnel's state and address. */
export interface PublicArtifactStatus {
  state: 'off' | 'starting' | 'running' | 'missing' | 'failed'
  url: string | null
  error: string | null
  since: number | null
}

/** Where an artifact link points: a host, an artifact on it, and the token of a share link. */
export interface ArtifactLink {
  computerId: string
  artifactId: string
  share?: string
}

/** A `ramu://artifact/<host>/<id>` link (with `?share=` for a share link), as Share and Add to Home Screen copy. */
export function artifactLink(link: ArtifactLink): string {
  return `ramu://artifact/${encodeURIComponent(link.computerId)}/${encodeURIComponent(link.artifactId)}${link.share ? `?share=${encodeURIComponent(link.share)}` : ''}`
}

/** Reads a `ramu://artifact/<host>/<id>` link, with the share token when it has one. */
export function parseArtifactLink(url: string): ArtifactLink | null {
  const match = /^ramu:\/\/artifact\/([^/?#]{1,120})\/([\w-]{1,80})(?:\?share=([\w-]{8,80}))?$/.exec(url.trim())
  if (!match) return null
  try {
    return {
      computerId: decodeURIComponent(match[1]!),
      artifactId: match[2]!,
      ...(match[3] ? { share: match[3] } : {}),
    }
  } catch {
    // A malformed percent escape is not a link.
    return null
  }
}

/** A saved starting point: an artifact's drawn version without its records, values, grants or history. */
export interface ArtifactTemplate {
  /** A saved template's id, or `starter:…` for one Ramu ships. */
  id: string
  kind: ArtifactKind
  title: string
  icon: string
  createdAt: number
}

/** Where the host keeps which design artifact is its design system; a project's own adds `:<projectId>`. */
export const DESIGN_SYSTEM_KEY = 'design-system'
export const designSystemKey = (projectId: string | null) =>
  projectId ? `${DESIGN_SYSTEM_KEY}:${projectId}` : DESIGN_SYSTEM_KEY

/** The design system that applies to a project: its own, else the host's; null when neither is chosen. */
export function appliedDesignSystem(read: (key: string) => string | null, projectId: string | null): string | null {
  return (projectId ? read(designSystemKey(projectId)) : null) ?? read(DESIGN_SYSTEM_KEY)
}

/** A design version's tokens, when it sets them; only such a design can be the design system. */
export function designTokensOf(document: {
  reference: { kind?: ArtifactKind }
  files?: { path: string; content: string }[]
}): import('./artifactSource').DesignTokens | null {
  if (document.reference.kind !== 'design') return null
  const stored = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.design)?.content
  const tokens = stored
    ? (JSON.parse(stored) as { tokens?: import('./artifactSource').DesignTokens }).tokens
    : undefined
  return tokens ?? null
}
