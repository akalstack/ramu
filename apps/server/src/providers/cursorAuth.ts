import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Cursor's SDK login is a file, never the Keychain: `~/.cursor/sdk/auth.json` for the default login, and
 * `<account folder>/sdk/auth.json` for a login added in Ramu, whose folder `RAMU_CURSOR_SDK_DIR` names.
 */
export const cursorSdkAuthFile = (env: NodeJS.ProcessEnv) =>
  env.RAMU_CURSOR_SDK_DIR ? join(env.RAMU_CURSOR_SDK_DIR, 'auth.json') : join(homedir(), '.cursor', 'sdk', 'auth.json')

/** The unexpired API key a login saved, or undefined. Read only from that file. */
export function storedCursorKey(env: NodeJS.ProcessEnv, now = Date.now()): string | undefined {
  try {
    const saved = JSON.parse(readFileSync(cursorSdkAuthFile(env), 'utf8')) as Record<string, unknown>
    const expires = typeof saved.apiKeyExpiresAtMs === 'number' ? saved.apiKeyExpiresAtMs : Infinity
    return saved.version === 1 && typeof saved.apiKey === 'string' && saved.apiKey && expires > now
      ? saved.apiKey
      : undefined
  } catch {
    return undefined
  }
}
