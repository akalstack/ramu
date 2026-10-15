import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { collectAssets, run, versionOf } from './release.mjs'

test('rejects malformed versions and tag/path injection', () => {
  for (const value of ['../x', '1.2', '01.2.3', '1.2.3;bad', '1.2.3-01', '1.2.3+build'])
    assert.throws(() => versionOf(value))
  assert.equal(versionOf('v1.2.3-beta.1'), '1.2.3-beta.1')
})
test('collects nested installers with platform names and verifiable checksums', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-assets-'))
  try {
    const source = join(root, 'make'),
      destination = join(root, 'release')
    mkdirSync(join(source, 'nested'), { recursive: true })
    writeFileSync(join(source, 'nested', 'Ramu.zip'), 'installer')
    writeFileSync(join(source, 'ignored.log'), 'noise')
    collectAssets(source, destination, 'darwin', 'arm64')
    assert.equal(readFileSync(join(destination, 'darwin-arm64-Ramu.zip'), 'utf8'), 'installer')
    assert.equal(
      readFileSync(join(destination, 'SHA256SUMS-darwin-arm64.txt'), 'utf8'),
      `${createHash('sha256').update('installer').digest('hex')}  darwin-arm64-Ramu.zip\n`,
    )
    assert.throws(() => collectAssets(source, destination, 'darwin', 'arm64'), /Duplicate/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('prepares notes without committing, refuses overwrites, and verifies version agreement', () => {
  const cwd = process.cwd(),
    root = mkdtempSync(join(tmpdir(), 'ramu-release-'))
  try {
    process.chdir(root)
    const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    writeFileSync('package.json', '{"name":"ramu","version":"0.0.1"}\n')
    git('add', '.')
    git('commit', '-qm', 'Initial workspace')
    run(['prepare', '0.1.0', '--dry-run'])
    assert.equal(JSON.parse(readFileSync('package.json')).version, '0.0.1')
    run(['prepare', '0.1.0'])
    assert.match(readFileSync('releases/v0.1.0.md', 'utf8'), /Initial workspace/)
    run(['verify', 'v0.1.0'])
    assert.throws(() => run(['verify', 'v0.2.0']), /does not match/)
    assert.throws(() => run(['prepare', '0.1.0']), /already exists/)
    assert.throws(() => run(['draft', '0.1.0']), /working-tree/)
    git('add', '.')
    git('commit', '-qm', 'Prepare release')
    git('tag', '-a', 'v0.1.0', '-m', 'Ramu v0.1.0')
    const remote = join(root, '.git', 'remote.git')
    git('init', '--bare', '-q', remote)
    git('remote', 'add', 'origin', remote)
    assert.throws(() => run(['draft', 'v0.1.0', '--dry-run']), /Push v0.1.0/)
    git('push', 'origin', 'v0.1.0')
    run(['draft', 'v0.1.0', '--dry-run'])
    writeFileSync('later.txt', 'later')
    git('add', 'later.txt')
    git('commit', '-qm', 'Later change')
    assert.throws(() => run(['draft', 'v0.1.0', '--dry-run']), /Check out the release tag/)
  } finally {
    process.chdir(cwd)
    rmSync(root, { recursive: true, force: true })
  }
})
