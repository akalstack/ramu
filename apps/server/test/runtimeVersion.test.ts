import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runtimeVersion } from '../src/build'

it('reads the version of the package the CLI belongs to, also through the link npm puts in its bin folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-version-'))
  try {
    const pkg = join(root, 'lib', 'node_modules', '@akalstack', 'ramu')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    mkdirSync(join(root, 'bin'))
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    writeFileSync(join(pkg, 'dist', 'cli.js'), '')
    symlinkSync(join(pkg, 'dist', 'cli.js'), join(root, 'bin', 'ramu'))
    expect(runtimeVersion(join(pkg, 'dist', 'cli.js'))).toBe('1.2.3')
    expect(runtimeVersion(join(root, 'bin', 'ramu'))).toBe('1.2.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
