import { z } from 'zod'

/**
 * Inline cards: small interactive UI an agent shows in a thread as A2UI v1.0 messages (https://a2ui.org). They carry
 * data, never code, so the desktop and the phone draw them with their own components. The catalog is a subset of A2UI's
 * basic catalog: media components that would load outside URLs, modals and regex checks are left out.
 */
const A2UI_VERSION = '1.0'
const INLINE_UI_CATALOG = 'getramu.dev:inline/v1'
/** Surfaces written against A2UI's basic catalog are accepted when they only use the parts Ramu draws. */
const A2UI_BASIC_CATALOG = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'
const CATALOGS = new Set([INLINE_UI_CATALOG, A2UI_BASIC_CATALOG])

export const INLINE_UI_LIMITS = {
  messages: 20,
  surfaces: 20,
  components: 200,
  depth: 16,
  children: 100,
  templateItems: 100,
  modelBytes: 64 * 1024,
  text: 10_000,
} as const

const INLINE_UI_ICONS = [
  'accountCircle',
  'add',
  'arrowBack',
  'arrowForward',
  'attachFile',
  'calendarToday',
  'call',
  'camera',
  'check',
  'close',
  'delete',
  'download',
  'edit',
  'event',
  'error',
  'favorite',
  'folder',
  'help',
  'home',
  'info',
  'locationOn',
  'lock',
  'lockOpen',
  'mail',
  'menu',
  'moreHoriz',
  'moreVert',
  'notifications',
  'pause',
  'payment',
  'person',
  'phone',
  'photo',
  'play',
  'print',
  'refresh',
  'search',
  'send',
  'settings',
  'share',
  'shoppingCart',
  'star',
  'stop',
  'upload',
  'visibility',
  'visibilityOff',
  'warning',
] as const
export type InlineUiIcon = (typeof INLINE_UI_ICONS)[number]

const INLINE_UI_FUNCTIONS = [
  'required',
  'length',
  'numeric',
  'email',
  'formatString',
  'formatNumber',
  'formatCurrency',
  'formatDate',
  'pluralize',
  'openUrl',
  'and',
  'or',
  'not',
  '@index',
] as const

const id = z.string().min(1).max(100)
const pointer = z.string().max(500)
interface InlineUiCall {
  '@call': string
  args?: Record<string, unknown>
  catalogId?: string
}
const binding = z.object({ '@path': pointer }).strict()
const call: z.ZodType<InlineUiCall> = z
  .object({
    '@call': z.enum(INLINE_UI_FUNCTIONS),
    args: z.record(z.string().max(100), z.unknown()).optional(),
    catalogId: z.string().max(200).optional(),
  })
  .strict()
const dynString = z.union([z.string().max(INLINE_UI_LIMITS.text), binding, call])
const dynNumber = z.union([z.number(), binding, call])
const dynBoolean = z.union([z.boolean(), binding, call])
const dynStringList = z.union([z.array(z.string().max(1000)).max(INLINE_UI_LIMITS.children), binding, call])
const childList = z.union([
  z.array(id).max(INLINE_UI_LIMITS.children),
  z.object({ componentId: id, path: pointer }).strict(),
])
const action = z.union([
  z
    .object({
      event: z
        .object({
          name: z.string().min(1).max(100),
          userMessage: dynString.optional(),
          context: z.record(z.string().max(100), z.unknown()).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ functionCall: call }).strict(),
])
const checks = z
  .array(z.object({ condition: z.union([binding, call]), message: z.string().max(500).optional() }).strict())
  .max(10)
  .optional()
const common = {
  id,
  '@catalogId': z.string().max(200).optional(),
  '@accessibility': z.object({ label: dynString.optional(), description: dynString.optional() }).strict().optional(),
  '@metadata': z
    .object({ extensions: z.record(z.string(), z.unknown()).optional() })
    .strict()
    .optional(),
  weight: z.number().min(0).max(100).optional(),
}
const align = z.enum(['start', 'center', 'end', 'stretch'])
const justify = z.enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'])

const component = z.discriminatedUnion('component', [
  z
    .object({
      ...common,
      component: z.literal('Text'),
      text: dynString,
      variant: z.enum(['caption', 'body']).optional(),
    })
    .strict(),
  z.object({ ...common, component: z.literal('Icon'), name: z.union([z.enum(INLINE_UI_ICONS), binding]) }).strict(),
  z
    .object({
      ...common,
      component: z.literal('Row'),
      children: childList,
      justify: justify.optional(),
      align: align.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('Column'),
      children: childList,
      justify: justify.optional(),
      align: align.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('List'),
      children: childList,
      direction: z.enum(['vertical', 'horizontal']).optional(),
      align: align.optional(),
    })
    .strict(),
  z.object({ ...common, component: z.literal('Card'), child: id }).strict(),
  z
    .object({
      ...common,
      component: z.literal('Tabs'),
      tabs: z
        .array(z.object({ title: dynString, child: id }).strict())
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({ ...common, component: z.literal('Divider'), axis: z.enum(['horizontal', 'vertical']).optional() })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('Button'),
      child: id,
      variant: z.enum(['default', 'primary', 'borderless']).optional(),
      action,
      '@checks': checks,
    })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('TextField'),
      label: dynString,
      value: dynString,
      placeholder: dynString.optional(),
      variant: z.enum(['longText', 'number', 'shortText', 'obscured']).optional(),
      '@checks': checks,
    })
    .strict(),
  z
    .object({ ...common, component: z.literal('CheckBox'), label: dynString, value: dynBoolean, '@checks': checks })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('ChoicePicker'),
      label: dynString.optional(),
      variant: z.enum(['multipleSelection', 'mutuallyExclusive']).optional(),
      options: z
        .array(z.object({ label: dynString, value: z.string().max(1000) }).strict())
        .min(1)
        .max(INLINE_UI_LIMITS.children),
      value: dynStringList,
      displayStyle: z.enum(['checkbox', 'chips']).optional(),
      filterable: z.boolean().optional(),
      '@checks': checks,
    })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('Slider'),
      label: dynString.optional(),
      min: z.number().optional(),
      max: z.number(),
      value: dynNumber,
      steps: z.number().int().min(1).max(10_000).optional(),
      '@checks': checks,
    })
    .strict(),
  z
    .object({
      ...common,
      component: z.literal('DateTimeInput'),
      value: dynString,
      enableDate: z.boolean().optional(),
      enableTime: z.boolean().optional(),
      min: dynString.optional(),
      max: dynString.optional(),
      label: dynString.optional(),
      '@checks': checks,
    })
    .strict(),
])
export type InlineUiComponent = z.infer<typeof component>

const dataModel = z.record(z.string().max(200), z.unknown())
const components = z.array(component).min(1).max(INLINE_UI_LIMITS.components)
const version = z.literal(A2UI_VERSION)
const inlineUiMessageSchema = z.union([
  z
    .object({
      version,
      createSurface: z
        .object({
          surfaceId: id,
          catalogId: z.string().max(200).optional(),
          sendDataModel: z.boolean().optional(),
          components: components.optional(),
          dataModel: dataModel.optional(),
          metadata: z
            .object({ extensions: z.record(z.string(), z.unknown()).optional() })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ version, updateComponents: z.object({ surfaceId: id, components }).strict() }).strict(),
  z
    .object({
      version,
      updateDataModel: z.object({ surfaceId: id, path: pointer.optional(), value: z.unknown() }).strict(),
    })
    .strict(),
  z.object({ version, deleteSurface: z.object({ surfaceId: id }).strict() }).strict(),
])
const inlineUiMessagesSchema = z.array(inlineUiMessageSchema).min(1).max(INLINE_UI_LIMITS.messages)

/** One card's whole state after the agent's messages: what a thread event records and every device draws. */
export interface InlineSurface {
  surfaceId: string
  catalogId: string
  sendDataModel: boolean
  components: InlineUiComponent[]
  dataModel: Record<string, unknown>
  /** Counts the agent's changes, so a device keeps what the person typed until the agent changes the card again. */
  revision: number
  deleted?: true
}

/** The newest state of each card in a thread, in the order cards were first shown. */
export function latestSurfaces(
  events: readonly { kind: string; surface?: InlineSurface }[],
): Map<string, InlineSurface> {
  const surfaces = new Map<string, InlineSurface>()
  for (const event of events)
    if (event.kind === 'inline-ui' && event.surface) surfaces.set(event.surface.surfaceId, event.surface)
  return surfaces
}

/** JSON Pointer tokens (RFC 6901). A pointer without a leading slash is relative to `base`. */
export function pointerTokens(path: string, base: readonly string[] = []): string[] {
  if (path === '' || path === '/') return path === '/' ? [] : [...base]
  const relative = !path.startsWith('/')
  const tokens = (relative ? path : path.slice(1))
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
  return relative ? [...base, ...tokens] : tokens
}

const unsafeKey = (key: string) => key === '__proto__' || key === 'constructor' || key === 'prototype'

export function readPointer(model: unknown, tokens: readonly string[]): unknown {
  let value = model
  for (const token of tokens) {
    if (unsafeKey(token)) return undefined
    if (Array.isArray(value)) value = /^\d+$/.test(token) ? value[Number(token)] : undefined
    else if (value && typeof value === 'object')
      value = Object.hasOwn(value, token) ? (value as Record<string, unknown>)[token] : undefined
    else return undefined
  }
  return value
}

/** Returns a copy with `value` at `tokens`, creating missing objects; `null` deletes the key. */
export function writePointer(
  model: Record<string, unknown>,
  tokens: readonly string[],
  value: unknown,
): Record<string, unknown> {
  if (!tokens.length)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const put = (node: unknown, index: number): unknown => {
    const token = tokens[index]!
    if (unsafeKey(token)) return node
    const last = index === tokens.length - 1
    if (Array.isArray(node) && /^\d+$/.test(token)) {
      const copy = [...node]
      const at = Number(token)
      if (last) {
        if (value === null) copy.splice(at, 1)
        else copy[at] = value
      } else copy[at] = put(copy[at], index + 1)
      return copy
    }
    const copy: Record<string, unknown> =
      node && typeof node === 'object' && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {}
    if (last) {
      if (value === null) delete copy[token]
      else copy[token] = value
    } else copy[token] = put(copy[token], index + 1)
    return copy
  }
  return put(model, 0) as Record<string, unknown>
}

export type InlineUiResult = { ok: true; surfaces: InlineSurface[] } | { ok: false; error: string }

const childIds = (c: InlineUiComponent): string[] => {
  if ('children' in c) return Array.isArray(c.children) ? c.children : [c.children.componentId]
  if (c.component === 'Tabs') return c.tabs.map((tab) => tab.child)
  if ('child' in c) return [c.child]
  return []
}

function problem(surface: InlineSurface): string | null {
  if (!CATALOGS.has(surface.catalogId))
    return `Surface ${surface.surfaceId}: catalogId must be "${INLINE_UI_CATALOG}" (or A2UI's basic catalog).`
  const byId = new Map(surface.components.map((c) => [c.id, c]))
  if (!byId.has('root')) return `Surface ${surface.surfaceId}: one component needs id "root".`
  if (byId.size > INLINE_UI_LIMITS.components)
    return `Surface ${surface.surfaceId}: at most ${INLINE_UI_LIMITS.components} components.`
  for (const c of surface.components) {
    if (c['@catalogId'] && !CATALOGS.has(c['@catalogId'])) return `Component ${c.id}: unsupported @catalogId.`
    for (const child of childIds(c))
      if (!byId.has(child))
        return `Component ${c.id} refers to "${child}", which is not in surface ${surface.surfaceId}.`
  }
  // Depth-first from root rejects cycles and trees too deep to draw.
  const visit = (key: string, path: Set<string>): string | null => {
    if (path.has(key)) return `Component ${key} contains itself.`
    if (path.size >= INLINE_UI_LIMITS.depth)
      return `Surface ${surface.surfaceId} nests deeper than ${INLINE_UI_LIMITS.depth} levels.`
    const next = new Set(path).add(key)
    for (const child of childIds(byId.get(key)!)) {
      const found = visit(child, next)
      if (found) return found
    }
    return null
  }
  const cycle = visit('root', new Set())
  if (cycle) return cycle
  if (JSON.stringify(surface.dataModel).length > INLINE_UI_LIMITS.modelBytes)
    return `Surface ${surface.surfaceId}: the data model is larger than ${INLINE_UI_LIMITS.modelBytes / 1024} KB.`
  return null
}

/**
 * Applies the agent's messages to the thread's cards, all or nothing. Only changed cards are returned. Messages are
 * checked against the whole batch, so a card may be created and filled in the same call but never shown half-built.
 */
export function applyInlineUi(current: ReadonlyMap<string, InlineSurface>, input: unknown): InlineUiResult {
  const parsed = inlineUiMessagesSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || 'messages'}: ${issue.message}`)
        .join('; '),
    }
  const next = new Map(current)
  const changed = new Set<string>()
  for (const message of parsed.data) {
    if ('createSurface' in message) {
      const create = message.createSurface
      if (next.has(create.surfaceId))
        return {
          ok: false,
          error: `Surface ${create.surfaceId} already exists. Send updateComponents or updateDataModel to change it, or use a new surfaceId.`,
        }
      if ([...next.values()].filter((s) => !s.deleted).length >= INLINE_UI_LIMITS.surfaces)
        return { ok: false, error: `A thread shows at most ${INLINE_UI_LIMITS.surfaces} cards. Delete one first.` }
      next.set(create.surfaceId, {
        surfaceId: create.surfaceId,
        catalogId: create.catalogId ?? INLINE_UI_CATALOG,
        sendDataModel: create.sendDataModel ?? false,
        components: create.components ?? [],
        dataModel: create.dataModel ?? {},
        revision: 1,
      })
      changed.add(create.surfaceId)
      continue
    }
    const surfaceId =
      'updateComponents' in message
        ? message.updateComponents.surfaceId
        : 'updateDataModel' in message
          ? message.updateDataModel.surfaceId
          : message.deleteSurface.surfaceId
    const surface = next.get(surfaceId)
    if (!surface || surface.deleted)
      return { ok: false, error: `Surface ${surfaceId} does not exist. Send createSurface first.` }
    if ('updateComponents' in message) {
      const merged = new Map(surface.components.map((c) => [c.id, c]))
      for (const c of message.updateComponents.components) merged.set(c.id, c)
      next.set(surfaceId, { ...surface, components: [...merged.values()] })
    } else if ('updateDataModel' in message) {
      const { path, value } = message.updateDataModel
      next.set(surfaceId, { ...surface, dataModel: writePointer(surface.dataModel, pointerTokens(path ?? '/'), value) })
    } else next.set(surfaceId, { ...surface, components: [], dataModel: {}, deleted: true })
    changed.add(surfaceId)
  }
  for (const key of changed) {
    const surface = { ...next.get(key)!, revision: (current.get(key)?.revision ?? 0) + 1 }
    next.set(key, surface)
    if (surface.deleted) continue
    const found = problem(surface)
    if (found) return { ok: false, error: found }
  }
  return { ok: true, surfaces: [...changed].map((key) => next.get(key)!) }
}

/** The A2UI action a card sends back, carried to the agent as a message in the thread. */
export interface InlineUiActionEvent {
  name: string
  surfaceId: string
  sourceComponentId: string
  timestamp: string
  context: Record<string, unknown>
  userMessage?: string
  dataModel?: Record<string, unknown>
}

const ACTION = /^Action from inline card ([\w.:-]+): ([^\n]*)\n\n```json\n([\s\S]*)\n```$/
export function inlineUiActionMessage(action: InlineUiActionEvent): string {
  const { dataModel, ...rest } = action
  const payload = { version: A2UI_VERSION, action: rest, ...(dataModel ? { metadata: { dataModel } } : {}) }
  return `Action from inline card ${action.surfaceId}: ${action.userMessage ?? action.name}\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
}
/** The chat shows a card action as what the person did, not the payload sent to the agent. */
export function parseInlineUiActionMessage(text: string): { surfaceId: string; summary: string } | null {
  const match = ACTION.exec(text)
  return match ? { surfaceId: match[1]!, summary: match[2]! } : null
}

export const INLINE_UI_GUIDANCE = `Show a small interactive card in the thread with show_ui when a form, choice, confirmation, status or summary is clearer than prose: picking options, filling a few fields, reviewing values before acting. It is drawn natively on the desktop and the phone with no code, so it appears instantly. Use artifacts instead for anything the person keeps, shares or opens later, for charts, documents, decks and full apps.

Send A2UI v1.0 messages (https://a2ui.org): {"version":"1.0","createSurface":{"surfaceId":"…","catalogId":"${INLINE_UI_CATALOG}","components":[…],"dataModel":{…}}}, then updateComponents, updateDataModel ({"surfaceId","path","value"}) or deleteSurface to change it. Components are a flat list; the one with id "root" is drawn, and others are referred to by id ("child" or "children"). A template child list {"componentId","path"} repeats a component for each item of a data model array, with relative paths inside it.

Components: Text {text (**bold**, *italic* and \`code\` allowed), variant: caption|body}; Icon {name}; Row/Column {children, justify, align}; List {children, direction}; Card {child}; Tabs {tabs:[{title, child}]}; Divider; Button {child: a Text id, variant: default|primary|borderless, action}; TextField {label, value, placeholder, variant: shortText|longText|number|obscured}; CheckBox {label, value}; ChoicePicker {label, options:[{label, value}], value: string list, variant: mutuallyExclusive|multipleSelection, displayStyle: checkbox|chips}; Slider {label, min, max, value, steps}; DateTimeInput {label, value, enableDate, enableTime, min, max}. Bind inputs to the data model with {"@path":"/form/email"}; the person's input stays on their device until they press a button.

A button action {"event":{"name","userMessage","context":{"email":{"@path":"/form/email"}}}} reaches you as a user message starting "Action from inline card <surfaceId>" with the A2UI action JSON, the context resolved. Add "@checks":[{"condition":{"@call":"required","args":{"value":{"@path":"/form/email"}}},"message":"…"}] to disable a button or flag a field until it is valid. Functions: required, length, numeric, email, and, or, not, formatString ("\${/path}"), formatNumber, formatCurrency, formatDate, pluralize, openUrl (https, in an action), @index. After an action, update the same card (for example to show it was done) instead of creating a new one.`
