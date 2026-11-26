import { randomBytes } from 'node:crypto'

/**
 * The bearer token that binds a thread's Ramu MCP calls to that thread. A thread keeps one token: a long-lived runner
 * (Codex, OpenCode, Cursor, Antigravity) holds the token it was launched with across turns, and building the thread's
 * tool connection again (to compare its servers before the next message) must not retire the token that runner holds.
 */
export class ToolTokens {
  private readonly bySession = new Map<string, string>()

  issue(sessionId: string): string {
    const existing = this.bySession.get(sessionId)
    if (existing) return existing
    const token = randomBytes(32).toString('hex')
    this.bySession.set(sessionId, token)
    return token
  }

  /** Whether `token` is the one this thread's tools answer to. */
  active(sessionId: string, token: string | undefined): boolean {
    return token !== undefined && this.bySession.get(sessionId) === token
  }
}
