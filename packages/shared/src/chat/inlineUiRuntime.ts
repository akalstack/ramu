import {
  INLINE_UI_LIMITS,
  pointerTokens,
  readPointer,
  writePointer,
  type InlineSurface,
  type InlineUiActionEvent,
  type InlineUiComponent,
} from './inlineUi'

/**
 * Evaluation shared by the desktop and phone renderers, so a card reads, validates and reports the same on both.
 * Everything here is pure: the renderers keep the person's data model and pass it in.
 */
export interface InlineUiScope {
  model: Record<string, unknown>
  /** Pointer tokens of the template item a relative path starts from. */
  base: readonly string[]
  /** The template item's position, for `@index`. */
  index?: number
  locale: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isBinding = (value: unknown): value is { '@path': string } =>
  isObject(value) && typeof value['@path'] === 'string'
const isCall = (value: unknown): value is { '@call': string; args?: Record<string, unknown> } =>
  isObject(value) && typeof value['@call'] === 'string'
const isValidation = (value: unknown): value is { valid: boolean; message?: string } =>
  isObject(value) && typeof value.valid === 'boolean'

/** The absolute pointer tokens a binding writes to from this scope. */
export const bindingTokens = (value: unknown, scope: InlineUiScope): string[] | null =>
  isBinding(value) ? pointerTokens(value['@path'], scope.base) : null

/** A2UI's string conversion: null and undefined are empty, objects are JSON. */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
/** A2UI's boolean coercion, including validation results. */
export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (isValidation(value)) return value.valid
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  if (typeof value === 'number') return value !== 0
  return false
}
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
export function asTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asText)
  if (typeof value === 'string' && value) return [value]
  return []
}

const valid = (ok: boolean, message?: string) => ({ valid: ok, ...(ok || !message ? {} : { message }) })

/** Resolves a literal, binding or function call. Nested objects and arrays are resolved too, as action context is. */
export function evaluate(value: unknown, scope: InlineUiScope, depth = 0): unknown {
  if (depth > 32) return undefined
  if (isBinding(value)) return readPointer(scope.model, pointerTokens(value['@path'], scope.base))
  if (isCall(value)) return callFunction(value['@call'], isObject(value.args) ? value.args : {}, scope, depth + 1)
  if (Array.isArray(value)) return value.map((item) => evaluate(item, scope, depth + 1))
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.startsWith('@@') ? key.slice(1) : key,
        evaluate(item, scope, depth + 1),
      ]),
    )
  return value
}

function callFunction(name: string, args: Record<string, unknown>, scope: InlineUiScope, depth: number): unknown {
  const arg = (key: string) => evaluate(args[key], scope, depth)
  switch (name) {
    case '@index':
      return (scope.index ?? 0) + (asNumber(arg('offset')) ?? 0)
    case 'required': {
      const value = arg('value')
      return valid(!(value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)))
    }
    case 'length': {
      const length = asText(arg('value')).length
      const min = asNumber(arg('min'))
      const max = asNumber(arg('max'))
      return valid((min === undefined || length >= min) && (max === undefined || length <= max))
    }
    case 'numeric': {
      const value = asNumber(arg('value'))
      const min = asNumber(arg('min'))
      const max = asNumber(arg('max'))
      return valid(value !== undefined && (min === undefined || value >= min) && (max === undefined || value <= max))
    }
    case 'email':
      return valid(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asText(arg('value'))))
    case 'and':
      return Array.isArray(args.values) && args.values.every((item) => asBoolean(evaluate(item, scope, depth)))
    case 'or':
      return Array.isArray(args.values) && args.values.some((item) => asBoolean(evaluate(item, scope, depth)))
    case 'not':
      return !asBoolean(arg('value'))
    case 'sum': {
      const list = arg('values')
      const field = asText(arg('field'))
      if (!Array.isArray(list)) return 0
      return list.reduce<number>(
        (total, item) => total + (asNumber(field && isObject(item) ? item[field] : item) ?? 0),
        0,
      )
    }
    case 'count': {
      const list = arg('values')
      return Array.isArray(list) ? list.length : 0
    }
    case 'formatString':
      return formatString(asText(arg('value')), scope)
    case 'formatNumber':
    case 'formatCurrency': {
      const value = asNumber(arg('value'))
      if (value === undefined) return ''
      const decimals = asNumber(arg('decimals'))
      const grouping = args.grouping === undefined ? true : asBoolean(arg('grouping'))
      const currency = asText(arg('currency'))
      try {
        return new Intl.NumberFormat(scope.locale, {
          ...(name === 'formatCurrency' ? { style: 'currency' as const, currency } : {}),
          ...(decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
          useGrouping: grouping,
        }).format(value)
      } catch {
        return String(value)
      }
    }
    case 'formatDate':
      return formatDate(arg('value'), asText(arg('format')), scope.locale)
    case 'pluralize': {
      const count = asNumber(arg('value')) ?? 0
      const category =
        count === 0 && args.zero !== undefined ? 'zero' : new Intl.PluralRules(scope.locale).select(count)
      return asText(args[category] === undefined ? arg('other') : arg(category))
    }
    // Only an action runs these; anywhere else they are inert.
    case 'openUrl':
    case 'addRecord':
    case 'deleteRecord':
      return undefined
    default:
      return undefined
  }
}

/** `${/path}` and `${relative}` interpolation; `\${` stays literal. Function expressions are not evaluated. */
export function formatString(template: string, scope: InlineUiScope): string {
  return template.replace(/\\\$\{|\$\{([^}]*)\}/g, (match, expression: string | undefined) =>
    expression === undefined ? '${' : asText(readPointer(scope.model, pointerTokens(expression.trim(), scope.base))),
  )
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0')
/** The TR35 date tokens A2UI's basic catalog documents, with month and day names in the reader's language. */
export function formatDate(value: unknown, format: string, locale: string): string {
  const date =
    value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const name = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date)
  const hours = date.getHours()
  const tokens: Record<string, () => string> = {
    yyyy: () => String(date.getFullYear()),
    yy: () => pad(date.getFullYear() % 100),
    MMMM: () => name({ month: 'long' }),
    MMM: () => name({ month: 'short' }),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    dd: () => pad(date.getDate()),
    d: () => String(date.getDate()),
    EEEE: () => name({ weekday: 'long' }),
    E: () => name({ weekday: 'short' }),
    HH: () => pad(hours),
    H: () => String(hours),
    hh: () => pad(hours % 12 || 12),
    h: () => String(hours % 12 || 12),
    mm: () => pad(date.getMinutes()),
    ss: () => pad(date.getSeconds()),
    a: () => (hours < 12 ? 'AM' : 'PM'),
  }
  return format.replace(
    /'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|E|HH|H|hh|h|mm|ss|a/g,
    (token, quoted: string | undefined) =>
      quoted !== undefined ? quoted : (tokens[token === 'EEE' ? 'E' : token]?.() ?? token),
  )
}

interface InlineUiCheck {
  valid: boolean
  message?: string
}
/** The first failing check of a component, or a passing result. */
export function checkComponent(component: InlineUiComponent, scope: InlineUiScope): InlineUiCheck {
  const checks = '@checks' in component ? (component['@checks'] ?? []) : []
  for (const check of checks) {
    const result = evaluate(check.condition, scope)
    if (isValidation(result) ? !result.valid : !asBoolean(result))
      return { valid: false, message: (isValidation(result) && result.message) || check.message }
  }
  return { valid: true }
}

interface InlineUiChild {
  id: string
  /** A stable React key: the template item's position joins the id. */
  key: string
  base: readonly string[]
  index?: number
}
/** A container's children, expanding a template over its data model list. */
export function childrenOf(
  children: string[] | { componentId: string; path: string },
  scope: InlineUiScope,
): InlineUiChild[] {
  if (Array.isArray(children)) return children.map((id) => ({ id, key: id, base: scope.base, index: scope.index }))
  const base = pointerTokens(children.path, scope.base)
  const list = readPointer(scope.model, base)
  const items = Array.isArray(list) ? list : isObject(list) ? Object.keys(list) : []
  return items.slice(0, INLINE_UI_LIMITS.templateItems).map((item, index) => {
    const token = Array.isArray(list) ? String(index) : String(item)
    return { id: children.componentId, key: `${children.componentId}:${token}`, base: [...base, token], index }
  })
}

/** Only web addresses open from a card; anything else (javascript:, file:, app links) is refused. */
function openableUrl(value: unknown): string | null {
  try {
    const url = new URL(asText(value))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

export type InlineUiOutcome =
  | { kind: 'event'; action: InlineUiActionEvent }
  | { kind: 'open'; url: string }
  | { kind: 'add'; collection: string; values: Record<string, unknown> }
  | { kind: 'delete'; collection: string; id: string }
  | { kind: 'none' }

/** What pressing a button does: an action for the agent with its context resolved, or a link to open. */
export function pressButton(
  surface: InlineSurface,
  component: Extract<InlineUiComponent, { component: 'Button' }>,
  scope: InlineUiScope,
  now = new Date(),
): InlineUiOutcome {
  if (!checkComponent(component, scope).valid) return { kind: 'none' }
  const { action } = component
  if ('functionCall' in action) {
    const args = action.functionCall.args ?? {}
    const collection = typeof args.collection === 'string' ? args.collection : ''
    if (action.functionCall['@call'] === 'addRecord') {
      const values = evaluate(args.values, scope)
      return isObject(values) && collection ? { kind: 'add', collection, values } : { kind: 'none' }
    }
    if (action.functionCall['@call'] === 'deleteRecord') {
      const id = asText(evaluate(args.id, scope))
      return id && collection ? { kind: 'delete', collection, id } : { kind: 'none' }
    }
    if (action.functionCall['@call'] !== 'openUrl') {
      evaluate(action.functionCall, scope)
      return { kind: 'none' }
    }
    const url = openableUrl(evaluate(action.functionCall.args?.url, scope))
    return url ? { kind: 'open', url } : { kind: 'none' }
  }
  const { name, userMessage, context } = action.event
  const message = userMessage === undefined ? '' : asText(evaluate(userMessage, scope)).trim()
  return {
    kind: 'event',
    action: {
      name,
      surfaceId: surface.surfaceId,
      sourceComponentId: component.id,
      timestamp: now.toISOString(),
      context: context ? (evaluate(context, scope) as Record<string, unknown>) : {},
      ...(message ? { userMessage: message.slice(0, 500) } : {}),
      ...(surface.sendDataModel ? { dataModel: scope.model } : {}),
    },
  }
}

/** What the person typed or picked, by the pointer it was written to; it stays on their device until a button sends it. */
export type InlineUiEdits = ReadonlyMap<string, { tokens: readonly string[]; value: unknown }>

export function withEdits(model: Record<string, unknown>, edits: InlineUiEdits): Record<string, unknown> {
  let next = model
  for (const { tokens, value } of edits.values()) next = writePointer(next, tokens, value)
  return next
}
export function editKey(tokens: readonly string[]): string {
  return JSON.stringify(tokens)
}
/** After the agent changes a card, keep the person's input except where the agent changed that same value. */
export function keepEdits(
  edits: InlineUiEdits,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Map<string, { tokens: readonly string[]; value: unknown }> {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  return new Map(
    [...edits].filter(([, edit]) => same(readPointer(previous, edit.tokens), readPointer(next, edit.tokens))),
  )
}
