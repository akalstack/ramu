import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexHookTrust } from '../src/codex'

// Against the real Codex CLI, in a throwaway CODEX_HOME so the user's own config is never touched:
//   RAMU_REAL_CODEX=1 pnpm vitest run test/codexHook.live.test.ts
describe.runIf(process.env.RAMU_REAL_CODEX === '1')('Codex hook trust (real)', () => {
  it('starts untrusted, and one write through the app-server makes the hook trusted', { timeout: 60_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'ramu-codex-hook-'))
    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    try {
      expect(await codexHookTrust(false)).toEqual({ trusted: false })
      expect(await codexHookTrust(true)).toEqual({ trusted: true })
      expect(await codexHookTrust(false)).toEqual({ trusted: true })
      expect(readFileSync(join(home, 'config.toml'), 'utf8')).toMatch(/trusted_hash = "sha256:[a-f0-9]{64}"/)
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })
})
