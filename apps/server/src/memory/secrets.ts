/**
 * Credential detection for text that is about to be stored in memory or a skill, or sent to a model.
 * Everything every provider reads later would carry a leaked key into every thread, so this errs towards refusing.
 */

/** Token shapes that are credentials by themselves. Each is anchored on a vendor prefix, so a match is rarely an accident. */
const KNOWN_FORMATS: { kind: string; pattern: string }[] = [
  { kind: 'Anthropic or OpenAI key', pattern: 'sk-[A-Za-z0-9_-]{20,}' },
  { kind: 'GitHub token', pattern: 'gh[pousr]_[A-Za-z0-9]{30,}' },
  { kind: 'GitHub token', pattern: 'github_pat_[A-Za-z0-9_]{22,}' },
  { kind: 'GitLab token', pattern: 'glpat-[A-Za-z0-9_-]{20,}' },
  { kind: 'Slack token', pattern: 'xox[abprs]-[A-Za-z0-9-]{10,}' },
  { kind: 'AWS access key', pattern: '(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}' },
  { kind: 'Google API key', pattern: 'AIza[0-9A-Za-z_-]{35}' },
  { kind: 'Stripe key', pattern: '(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}' },
  { kind: 'npm token', pattern: 'npm_[A-Za-z0-9]{36}' },
  { kind: 'SendGrid key', pattern: 'SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}' },
  { kind: 'JSON web token', pattern: 'eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}' },
  { kind: 'private key', pattern: '-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----' },
  { kind: 'Bearer token', pattern: '\\b[Bb]earer\\s+[A-Za-z0-9._~+/=-]{24,}' },
  // https://user:password@host: a password embedded in a connection string or remote URL.
  { kind: 'URL with credentials', pattern: '[a-z][a-z0-9+.-]*://[^\\s/:@]+:(?![$<{%])[^\\s/@]{3,}@' },
]
// Not inside a longer word: `task-based-…` contains `sk-`.
const KNOWN = new RegExp(`(?<![A-Za-z0-9])(?:${KNOWN_FORMATS.map((f) => f.pattern).join('|')})`)
const KNOWN_GLOBAL = new RegExp(KNOWN.source, 'g')

const NAME = '(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|token)'
/** `password: hunter2hunter2`, `GITHUB_TOKEN=...`, `"apiKey": "..."`. The name may carry a prefix such as `AWS_SECRET_`. */
const ASSIGNMENT = new RegExp(
  `(?:^|[^A-Za-z0-9])[A-Za-z0-9_.-]{0,40}${NAME}["']?\\s*[:=]\\s*["']?([^\\s"',}\\\\]{8,})`,
  'gi',
)
/** A value that only names where the secret lives, not the secret itself. */
const PLACEHOLDER = /^(?:\$|<|\{|\[|%|process\.env|os\.environ|env\(|import\.meta|your[_-]|xxx|\*{3}|\.{3}|redacted)/i

/** Longest run of characters a secret can be made of; `/` is left out so a path is not one token. */
const TOKEN = /[A-Za-z0-9_+=-]{32,}/g
const HEX_ONLY = /^[0-9a-f]+$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function entropy(text: string): number {
  const counts = new Map<string, number>()
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) bits -= (count / text.length) * Math.log2(count / text.length)
  return bits
}

/**
 * A long random-looking token with no vendor prefix. Pure hex (commit SHAs, digests), UUIDs and identifiers made of words
 * (camelCase, kebab-case) are left alone: a credential has digits, mixed case and no repeating structure.
 */
function highEntropy(token: string): boolean {
  if (HEX_ONLY.test(token) || UUID.test(token)) return false
  if (!/[0-9]/.test(token) || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false
  return entropy(token) >= 4.2
}

function* assignedSecrets(text: string): Generator<{ index: number; value: string }> {
  for (const match of text.matchAll(ASSIGNMENT)) {
    const value = match[1]!
    if (!PLACEHOLDER.test(value)) yield { index: match.index! + match[0].length - value.length, value }
  }
}

function* entropyTokens(text: string): Generator<{ index: number; value: string }> {
  for (const match of text.matchAll(TOKEN)) if (highEntropy(match[0])) yield { index: match.index!, value: match[0] }
}

/** What kind of credential the text appears to contain, or null. */
export function findSecret(text: string): string | null {
  const known = KNOWN.exec(text)
  if (known) return KNOWN_FORMATS.find((f) => new RegExp(f.pattern).test(known[0]))?.kind ?? 'credential'
  if (assignedSecrets(text).next().value) return 'credential assignment'
  if (entropyTokens(text).next().value) return 'high-entropy token'
  return null
}

export const containsSecret = (text: string): boolean => findSecret(text) !== null

/** The text with each credential replaced by `[redacted]`, for text that is sent to a model. */
export function redactSecrets(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g,
      '[redacted]',
    )
    .replace(KNOWN_GLOBAL, '[redacted]')
    .replace(ASSIGNMENT, (whole, value: string) =>
      PLACEHOLDER.test(value) ? whole : `${whole.slice(0, whole.length - value.length)}[redacted]`,
    )
    .replace(TOKEN, (token) => (highEntropy(token) ? '[redacted]' : token))
}
