import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { claudeCodeRipgrep } from '../src/workspace/ripgrep'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu rg '))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('runs a native Claude Code binary as ripgrep', () => {
  expect(claudeCodeRipgrep(process.execPath)).toEqual({ file: process.execPath, argv0: 'rg' })
})

it('skips a Claude Code launcher script, which would ignore the ripgrep name', () => {
  const script = join(dir, 'claude')
  writeFileSync(script, '#!/bin/sh\nexec node cli.js "$@"\n')
  chmodSync(script, 0o755)
  expect(claudeCodeRipgrep(script)).toBeNull()
})

it('finds nothing when Claude Code is not installed', () => {
  expect(claudeCodeRipgrep(join(dir, 'missing'))).toBeNull()
})
