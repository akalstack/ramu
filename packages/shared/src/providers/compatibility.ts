import type { AgentProvider } from '../types'
import { newerVersion } from '../version'

// Bundled, versioned compatibility policy for the runtime Ramu actually launches. A missing rule means Unverified:
// never invent a version range to fill a matrix. A Supported or Limited rule covers one release line: from a tested
// release up to the next major version, which is where providers make breaking changes, so the weekly patch and minor
// releases in between stay covered while a new major waits for its own probe. Date-numbered releases have no major and
// may stay open-ended. The evaluator is separate from installed/enabled, sign-in and
// update-available state, and it never grants a capability; negotiated capabilities stay authoritative.

export type CompatibilityStatus = 'supported' | 'limited' | 'incompatible' | 'unverified'
export type RuntimeKind = 'cli' | 'sdk' | 'app-server' | 'acp' | 'http'

export type CompatibilityReason =
  | 'in-range'
  | 'limited-range'
  | 'incompatible-range'
  | 'no-rule'
  | 'newer-than-tested'
  | 'version-unknown'
  | 'version-unparsed'

export interface CompatibilityRule {
  id: string
  provider: AgentProvider
  runtime: RuntimeKind
  /** Inclusive lower bound. */
  min?: string
  /** Exclusive upper bound. */
  below?: string
  status: Exclude<CompatibilityStatus, 'unverified'>
  /** Operations or features this rule affects, shown beside the status. */
  affects?: string[]
  /** A version or range worth moving to; it must itself fall in a supported rule of the same policy. */
  recommend?: string
  /** The newest release actually probed in this range; required for Supported and Limited rules. */
  tested?: string
  evidence: string
}

export interface CompatibilityPolicy {
  revision: number
  rules: CompatibilityRule[]
}

export interface CompatibilityResult {
  status: CompatibilityStatus
  reason: CompatibilityReason
  runtime: RuntimeKind
  observedVersion: string | null
  policyRevision: number
  ruleId?: string
  affects?: string[]
  recommend?: string
  evidence?: string
  /**
   * The newest release probed: in a matching rule, that rule's; outside every rule, the newest supported one when the
   * observed release is newer. Providers update faster than Ramu can test them.
   */
  testedVersion?: string
  /** When the runtime was observed, so a stale result stays visibly stale. */
  checkedAt?: string
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/
const DATE = /^\d{4}\.\d{2}\.\d{2}-/

/** Both operands must be the same style of version; anything else cannot be ordered. */
function order(a: string, b: string): number | null {
  if (a === b) return 0
  const sameKind =
    (DATE.test(a) && DATE.test(b)) || (!DATE.test(a) && !DATE.test(b) && SEMVER.test(a) && SEMVER.test(b))
  if (!sameKind) return null
  if (newerVersion(a, b)) return 1
  if (newerVersion(b, a)) return -1
  return 0
}

function inRange(version: string, rule: CompatibilityRule): boolean | null {
  if (rule.min) {
    const o = order(version, rule.min)
    if (o === null) return null
    if (o < 0) return false
  }
  if (rule.below) {
    const o = order(version, rule.below)
    if (o === null) return null
    if (o >= 0) return false
  }
  return true
}

export function evaluateCompatibility(
  policy: CompatibilityPolicy,
  provider: AgentProvider,
  runtime: RuntimeKind,
  version: string | null,
): CompatibilityResult {
  const base = { runtime, observedVersion: version, policyRevision: policy.revision }
  const rules = policy.rules.filter((rule) => rule.provider === provider && rule.runtime === runtime)
  if (!rules.length) return { ...base, status: 'unverified', reason: 'no-rule' }
  if (!version) return { ...base, status: 'unverified', reason: 'version-unknown' }
  let unordered = false
  for (const rule of rules) {
    const hit = inRange(version, rule)
    if (hit === null) unordered = true
    if (!hit) continue
    return {
      ...base,
      status: rule.status,
      reason:
        rule.status === 'supported' ? 'in-range' : rule.status === 'limited' ? 'limited-range' : 'incompatible-range',
      ruleId: rule.id,
      ...(rule.affects ? { affects: rule.affects } : {}),
      ...(rule.recommend ? { recommend: rule.recommend } : {}),
      ...(rule.tested ? { testedVersion: rule.tested } : {}),
      evidence: rule.evidence,
    }
  }
  // Outside every rule, or a version style the rules cannot order: advisory only, normal protocol validation applies.
  if (unordered) return { ...base, status: 'unverified', reason: 'version-unparsed' }
  const tested = newestSupported(rules)
  return tested && order(version, tested) === 1
    ? { ...base, status: 'unverified', reason: 'newer-than-tested', testedVersion: tested }
    : { ...base, status: 'unverified', reason: 'no-rule' }
}

function newestSupported(rules: CompatibilityRule[]): string | undefined {
  let newest: string | undefined
  for (const rule of rules) {
    const tested = rule.tested ?? rule.min
    if (rule.status === 'supported' && tested && (!newest || order(tested, newest) === 1)) newest = tested
  }
  return newest
}

/** The first release of the next major line, for a semver version; null for date-numbered releases. */
export function nextMajor(version: string): string | null {
  if (DATE.test(version)) return null
  const major = SEMVER.exec(version)?.[1]
  return major === undefined ? null : `${Number(major) + 1}.0.0`
}

/** Problems that make a policy unsafe to ship: bad ranges, overlapping rules, and recommendations it would itself reject. */
export function validatePolicy(policy: CompatibilityPolicy): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const rule of policy.rules) {
    if (ids.has(rule.id)) problems.push(`${rule.id}: duplicate id`)
    ids.add(rule.id)
    if (!rule.evidence.trim()) problems.push(`${rule.id}: evidence is required`)
    for (const bound of [rule.min, rule.below])
      if (bound && !SEMVER.test(bound) && !DATE.test(bound)) problems.push(`${rule.id}: unreadable version ${bound}`)
    if (rule.min && rule.below) {
      const o = order(rule.min, rule.below)
      if (o === null) problems.push(`${rule.id}: min and below use different version styles`)
      else if (o >= 0) problems.push(`${rule.id}: empty range`)
    }
    if (rule.status === 'incompatible') continue
    if (!rule.tested) problems.push(`${rule.id}: a ${rule.status} rule names the release it was tested on`)
    else if (inRange(rule.tested, rule) !== true)
      problems.push(`${rule.id}: tested ${rule.tested} is outside its range`)
    // Claiming a release line nobody probed is guessing: a working rule ends at the next major at the latest.
    const floor = rule.min ?? rule.tested
    const ceiling = floor ? nextMajor(floor) : null
    if (ceiling && (!rule.below || (order(rule.below, ceiling) ?? 1) > 0))
      problems.push(`${rule.id}: a ${rule.status} range ends by ${ceiling}, the next major release`)
  }
  const same = (a: CompatibilityRule, b: CompatibilityRule) => a.provider === b.provider && a.runtime === b.runtime
  for (const [i, a] of policy.rules.entries())
    for (const b of policy.rules.slice(i + 1)) {
      if (!same(a, b) || a.status === b.status) continue
      if (overlaps(a, b)) problems.push(`${a.id} and ${b.id}: overlapping ranges with different statuses`)
    }
  for (const rule of policy.rules) {
    if (!rule.recommend) continue
    const target = evaluateCompatibility(policy, rule.provider, rule.runtime, rule.recommend)
    if (target.status !== 'supported')
      problems.push(`${rule.id}: recommendation ${rule.recommend} is not supported by this policy`)
  }
  return problems
}

function overlaps(a: CompatibilityRule, b: CompatibilityRule): boolean {
  // Open ends overlap anything on that side; incomparable styles are reported separately by the range checks.
  const lowBelowHigh = (low: string | undefined, high: string | undefined) => {
    if (!low || !high) return true
    const o = order(low, high)
    return o === null ? false : o < 0
  }
  return lowBelowHigh(a.min, b.below) && lowBelowHigh(b.min, a.below)
}

/**
 * Whether an automatic update may install a release: never one proven incompatible, and never one past every tested
 * release line, such as a new major. Pressing Update still installs the latter; automatic updates wait for a probe.
 */
export function automaticallyInstallable(target: CompatibilityResult | null | undefined): boolean {
  return target?.status !== 'incompatible' && target?.reason !== 'newer-than-tested'
}
