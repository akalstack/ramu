import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { bundledRipgrep } from '../src/workspace/ripgrep'

it('searches with the ripgrep inside the bundled Claude binary when none is installed', () => {
  const rg = bundledRipgrep()
  expect(rg?.argv0).toBe('rg')
  const dir = mkdtempSync(join(tmpdir(), 'ramu rg '))
  try {
    writeFileSync(join(dir, 'note.txt'), 'find the needle here\n')
    // spawn passes argv0 through; execFile does not.
    const { stdout } = spawnSync(rg!.file, ['--json', '--fixed-strings', '--', 'needle', '.'], {
      cwd: dir,
      argv0: rg!.argv0,
      encoding: 'utf8',
    })
    expect(stdout).toContain('"type":"match"')
    expect(stdout).toContain('note.txt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
