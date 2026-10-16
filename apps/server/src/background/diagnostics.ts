import type { Workspace } from '../workspace/workspace'
import type { AppPreferences } from '@ramu/shared/types'
export interface DiagnosticEntry {
  at: number
  kind: 'service-error' | 'service-crash' | 'renderer-crash' | 'desktop-crash'
  errorType: string
  code?: string
}
const TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'AggregateError',
])
const CODES = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'ENOMEM',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
])
/** Allowlisted metadata only: never messages, stacks, paths, prompts, source code or arbitrary error properties. */
export class LocalDiagnostics {
  constructor(private workspace: Workspace) {}
  enabled() {
    return this.workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).localCrashReports === true
  }
  list(): DiagnosticEntry[] {
    return this.workspace.getAppState<DiagnosticEntry[]>('local-diagnostics', [])
  }
  record(kind: DiagnosticEntry['kind'], error?: unknown) {
    if (!this.enabled()) return
    try {
      const name = error instanceof Error ? error.name : 'Error'
      const rawCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const entry: DiagnosticEntry = {
        at: Date.now(),
        kind,
        errorType: TYPES.has(name) ? name : 'Error',
        ...(CODES.has(rawCode) ? { code: rawCode } : {}),
      }
      this.workspace.setAppState('local-diagnostics', [
        ...this.list()
          .filter((entry) => entry.at > Date.now() - 30 * 86_400_000)
          .slice(-99),
        entry,
      ])
    } catch {
      /* Diagnostics must never turn a handled error into a crash. */
    }
  }
  clear() {
    this.workspace.setAppState('local-diagnostics', [])
  }
  export() {
    return JSON.stringify({ format: 1, platform: process.platform, arch: process.arch, reports: this.list() }, null, 2)
  }
}
