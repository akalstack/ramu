import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureNodeOnPath } from '../src/providers/providerBinaries'

describe.skipIf(process.platform === 'win32')('ensureNodeOnPath', () => {
  let dir = ''
  const saved = { PATH: process.env.PATH, FNM_DIR: process.env.FNM_DIR }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ramu-node-path-'))
  })
  afterEach(() => {
    process.env.PATH = saved.PATH
    if (saved.FNM_DIR === undefined) delete process.env.FNM_DIR
    else process.env.FNM_DIR = saved.FNM_DIR
    rmSync(dir, { recursive: true, force: true })
  })
  const fnmNode = () => {
    const bin = join(dir, 'fnm/aliases/default/bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'node'), '#!/bin/sh\n')
    chmodSync(join(bin, 'node'), 0o755)
    process.env.FNM_DIR = join(dir, 'fnm')
    return bin
  }

  it("adds a version manager's Node last, so tools that start with env node run from a service", () => {
    const bin = fnmNode()
    const system = join(dir, 'system')
    mkdirSync(system)
    process.env.PATH = system
    ensureNodeOnPath()
    expect(process.env.PATH).toBe([system, bin].join(delimiter))
    // Asking again changes nothing.
    ensureNodeOnPath()
    expect(process.env.PATH).toBe([system, bin].join(delimiter))
  })

  it('leaves PATH alone when a node is already on it', () => {
    fnmNode()
    const system = join(dir, 'system')
    mkdirSync(system)
    writeFileSync(join(system, 'node'), '#!/bin/sh\n')
    chmodSync(join(system, 'node'), 0o755)
    process.env.PATH = system
    ensureNodeOnPath()
    expect(process.env.PATH).toBe(system)
  })
})
