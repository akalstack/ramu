import { expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { discardPreview } from '../src/discardPreview'
it('discard previews change when the same file gets new bytes and identify permanent deletion', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-discard-')))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args])
  try {
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.test')
    writeFileSync(join(dir, 'tracked.txt'), 'before')
    git('add', '.')
    git('commit', '-qm', 'initial')
    writeFileSync(join(dir, 'tracked.txt'), 'after')
    writeFileSync(join(dir, 'new.txt'), 'new')
    const preview = await discardPreview(dir, ['tracked.txt', 'new.txt'])
    expect(preview.files.find((f) => f.path === 'new.txt')?.untracked).toBe(true)
    writeFileSync(join(dir, 'tracked.txt'), 'concurrent edit')
    expect((await discardPreview(dir, ['tracked.txt', 'new.txt'])).fingerprint).not.toBe(preview.fingerprint)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
