import type { ForgeCliAccount } from './types/forge'

/**
 * Reads the text of `gh auth status`. Only host, login, protocol, scopes and whether each sign-in works are kept; the
 * token line is skipped on purpose so a secret can never reach a summary, a log or a client.
 */
export function parseGhAuthStatus(text: string): ForgeCliAccount[] {
  const accounts: ForgeCliAccount[] = []
  let host = ''
  let account: ForgeCliAccount | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (!/^[✓X✗-]/.test(line) && !raw.startsWith(' ') && /^[a-z0-9.-]+(?::\d+)?$/i.test(line)) {
      host = line
      account = null
      continue
    }
    const signedIn = /^✓\s+Logged in to (\S+) account (\S+)/.exec(line)
    const failed = /^[X✗]\s+Failed to log in to (\S+) account (\S+)/.exec(line)
    if (signedIn || failed) {
      const match = (signedIn ?? failed)!
      account = {
        host: match[1] ?? host,
        login: match[2]!,
        active: false,
        state: signedIn ? 'ok' : 'invalid',
        protocol: null,
        scopes: [],
      }
      accounts.push(account)
      continue
    }
    if (!account) continue
    const active = /^-\s+Active account:\s+(true|false)/i.exec(line)
    if (active) account.active = active[1]!.toLowerCase() === 'true'
    const protocol = /^-\s+Git operations protocol:\s+(\S+)/i.exec(line)
    if (protocol) account.protocol = protocol[1]!
    const scopes = /^-\s+Token scopes:\s+(.*)$/i.exec(line)
    if (scopes) account.scopes = [...scopes[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  }
  return accounts
}
