import type { AgentProvider } from '../types'
import { AGENT_PROVIDERS } from './providers'

/** `global` reaches every provider; a provider's own variables win over global ones with the same name. */
export type EnvironmentScope = 'global' | AgentProvider
export const ENVIRONMENT_SCOPES: readonly EnvironmentScope[] = ['global', ...AGENT_PROVIDERS]

export interface EnvironmentVariable {
  key: string
  value: string
}
export type ProviderEnvironmentValues = Partial<Record<EnvironmentScope, EnvironmentVariable[]>>

export interface ProviderEnvironmentStatus {
  /** `unavailable` means values are configured but the host credential store could not be read. */
  state: 'empty' | 'available' | 'unavailable'
  /** Variable names per scope. Names are never secret, so every client may read them. */
  keys: Partial<Record<EnvironmentScope, string[]>>
  /** Values, only for clients that may administer this host. */
  values?: ProviderEnvironmentValues
  canAdminister: boolean
}

export const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
export const MAX_ENVIRONMENT_VARIABLES = 200
/** Ramu's own control variables configure the runtime itself, not the provider. */
export const reservedEnvironmentKey = (key: string) => /^RAMU_/i.test(key)

/** Problems that block saving, as user-facing messages keyed by the variable name. */
export function environmentProblem(variable: EnvironmentVariable, others: EnvironmentVariable[]): string | null {
  if (!variable.key) return 'Enter a name'
  if (!ENVIRONMENT_KEY_PATTERN.test(variable.key))
    return 'Use letters, digits and underscores, not starting with a digit'
  if (reservedEnvironmentKey(variable.key)) return 'RAMU_ variables are reserved'
  if (others.filter((other) => other.key === variable.key).length > 1) return 'This name is used twice'
  if (variable.value.includes('\0')) return 'Values cannot contain null characters'
  return null
}

const unescape = (value: string) =>
  value.replace(/\\([nrt"\\$])/g, (_, char: string) => ({ n: '\n', r: '\r', t: '\t' })[char] ?? char)

/** Parses `.env` text: `KEY=value`, optional `export`, `#` comments, single, double and multi-line quoted values.
 * Lines that are not assignments are ignored, so pasting a whole file or a shell snippet both work. */
export function parseDotEnv(text: string): EnvironmentVariable[] {
  const result = new Map<string, string>()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/.exec(lines[index]!)
    if (!match) continue
    const key = match[1]!
    const rest = match[2]!.trimStart()
    const quote = rest[0]
    let value: string
    if (quote === '"' || quote === "'" || quote === '`') {
      // A quoted value may span lines until its closing quote.
      let body = rest.slice(1)
      let end = closing(body, quote)
      while (end < 0 && index + 1 < lines.length) {
        body += '\n' + lines[++index]
        end = closing(body, quote)
      }
      value = end < 0 ? body : body.slice(0, end)
      if (quote === '"') value = unescape(value)
    } else {
      // Unquoted: a `#` after whitespace starts a comment.
      value = rest.replace(/\s+#.*$/, '').trim()
    }
    result.delete(key)
    result.set(key, value)
  }
  return [...result].map(([key, value]) => ({ key, value }))
}

function closing(body: string, quote: string) {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === '\\') i++
    else if (body[i] === quote) return i
  }
  return -1
}

/** Formats variables as `.env` text that `parseDotEnv` and common dotenv loaders read back unchanged. */
export function formatDotEnv(variables: EnvironmentVariable[]): string {
  return variables
    .filter((variable) => variable.key)
    .map(({ key, value }) => {
      if (/^[\w./:@%+,?=&~-]*$/.test(value)) return `${key}=${value}`
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
      return `${key}="${escaped}"`
    })
    .join('\n')
}

/** Global variables, then the provider's own, so the provider's win. */
export function scopedEnvironment(values: ProviderEnvironmentValues, provider: AgentProvider): Record<string, string> {
  return Object.fromEntries([...(values.global ?? []), ...(values[provider] ?? [])].map((v) => [v.key, v.value]))
}

/** Pasting `.env` text into row `at` fills that row with the first variable; the rest update rows with the same
 * name or are appended. Returns null when the text holds no assignment, so the paste stays ordinary text. */
export function pasteDotEnv(rows: EnvironmentVariable[], at: number, text: string): EnvironmentVariable[] | null {
  if (!text.includes('=')) return null
  const incoming = parseDotEnv(text)
  if (!incoming.length) return null
  const next = rows.map((row) => ({ ...row }))
  const [first, ...rest] = incoming
  const target = next[at]
  const existing = next.findIndex((row, index) => index !== at && row.key === first!.key)
  if (target && !target.key && !target.value && existing < 0) next[at] = first!
  else rest.unshift(first!)
  for (const variable of rest) {
    const index = next.findIndex((row) => row.key === variable.key)
    if (index >= 0) next[index] = variable
    else next.push(variable)
  }
  return next
}

export const sameEnvironment = (a: ProviderEnvironmentValues, b: ProviderEnvironmentValues) =>
  ENVIRONMENT_SCOPES.every((scope) => {
    const left = (a[scope] ?? []).filter((v) => v.key || v.value),
      right = (b[scope] ?? []).filter((v) => v.key || v.value)
    return left.length === right.length && left.every((v, i) => v.key === right[i]!.key && v.value === right[i]!.value)
  })
