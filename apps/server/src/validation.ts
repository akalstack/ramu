// Turns a failed schema parse into one sentence a person can act on, instead of Zod's JSON issue list.
interface Issue {
  code: string
  path: PropertyKey[]
  message: string
  origin?: string
  maximum?: number | bigint
  minimum?: number | bigint
  expected?: string
  format?: string
}

const count = (n: number | bigint) => Number(n).toLocaleString('en-US')

/** `maxTurns` → "Max turns". Positional-only paths (tuple arguments) have no name to show. */
function fieldName(path: PropertyKey[], origin?: string): string {
  const name = [...path].reverse().find((part): part is string => typeof part === 'string')
  if (!name) return origin === 'string' ? 'This text' : origin === 'number' ? 'This number' : 'This value'
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function describeIssue(issue: Issue): string {
  const field = fieldName(issue.path, issue.origin)
  const unit = issue.origin === 'string' ? ' characters' : ''
  if (issue.code === 'too_big' && issue.maximum !== undefined) {
    if (issue.origin === 'string') return `${field} is too long (${count(issue.maximum)} characters at most).`
    if (issue.origin === 'array' || issue.origin === 'set')
      return `${field} has too many items (${count(issue.maximum)} at most).`
    return `${field} must be ${count(issue.maximum)} or less.`
  }
  if (issue.code === 'too_small' && issue.minimum !== undefined) {
    const min = Number(issue.minimum)
    if (issue.origin === 'string')
      return min <= 1 ? `${field} can't be empty.` : `${field} must be at least ${count(min)}${unit}.`
    if (issue.origin === 'array' || issue.origin === 'set')
      return min <= 1 ? `${field} needs at least one item.` : `${field} needs at least ${count(min)} items.`
    return `${field} must be ${count(min)} or more.`
  }
  if (issue.code === 'invalid_type') {
    if (issue.expected === 'int' || issue.expected === 'integer') return `${field} must be a whole number.`
    if (issue.expected === 'number') return `${field} must be a number.`
    return `${field} is missing or not valid.`
  }
  if (issue.code === 'invalid_format') return `${field} is not in a valid format.`
  if (issue.code === 'invalid_value') return `${field} is not one of the allowed options.`
  if (issue.code === 'custom' && issue.message) return issue.message
  return `${field}: ${issue.message}`
}

export function describeValidationError(error: { issues: Issue[] }): string {
  const [first] = error.issues
  return first ? describeIssue(first) : 'The request was not valid.'
}
