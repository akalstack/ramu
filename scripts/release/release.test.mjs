import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { collectAssets, compareVersions, releaseBody, run, versionOf, withCredits } from './release.mjs'
import { importedPackages, npmManifest } from './npm-package.mjs'

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
    const linux = join(root, 'linux-make'),
      linuxRelease = join(root, 'linux-release'),
      installers = {
        'deb/arm64/ramu_0.1.0_arm64.deb': 'deb',
        'rpm/arm64/ramu-0.1.0-1.aarch64.rpm': 'rpm',
        'AppImage/arm64/Ramu-0.1.0-arm64.AppImage': 'appimage',
        'zip/linux/arm64/Ramu-linux-arm64-0.1.0.zip': 'zip',
      }
    for (const [path, contents] of Object.entries(installers)) {
      mkdirSync(join(linux, path, '..'), { recursive: true })
      writeFileSync(join(linux, path), contents)
    }
    collectAssets(linux, linuxRelease, 'linux', 'arm64')
    const sums = readFileSync(join(linuxRelease, 'SHA256SUMS-linux-arm64.txt'), 'utf8').trim().split('\n')
    assert.deepEqual(
      sums.sort(),
      Object.entries(installers)
        .map(
          ([path, contents]) =>
            `${createHash('sha256').update(contents).digest('hex')}  linux-arm64-${path.split('/').at(-1)}`,
        )
        .sort(),
    )
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

test('credits pull request authors from GitHub and commit authors it left out, without bots', () => {
  const generated =
    "## What's Changed\n* Fix pairing by @alice in https://github.com/o/r/pull/7\n\n## New Contributors\n* @alice made their first contribution in https://github.com/o/r/pull/7\n\n**Full Changelog**: https://github.com/o/r/compare/v1...v2\n"
  const notes = withCredits('# Ramu v2\n\n## Added\n\n- A thing.\n', generated, [
    'maintainer',
    'alice',
    'dependabot[bot]',
    '',
    'bob',
    'maintainer',
  ])
  assert.ok(notes.startsWith('# Ramu v2\n\n## Added\n\n- A thing.\n\n## Contributors\n\n@bob, @maintainer\n\n## What'))
  assert.match(notes, /by @alice in https:\/\/github.com\/o\/r\/pull\/7/)
  assert.match(notes, /\*\*Full Changelog\*\*: https:\/\/github.com\/o\/r\/compare\/v1...v2\n$/)
  assert.equal(withCredits('# Ramu v2\n', '', ['github-actions[bot]']), '# Ramu v2\n')
})

test('orders versions so the previous release is found by version, not creation date', () => {
  const tags = ['v0.1.0-alpha.8', 'v0.1.0', 'v0.1.0-alpha.10', 'v0.1.0-beta.1', 'v0.1.0-alpha.9']
  assert.deepEqual(tags.sort(compareVersions), [
    'v0.1.0-alpha.8',
    'v0.1.0-alpha.9',
    'v0.1.0-alpha.10',
    'v0.1.0-beta.1',
    'v0.1.0',
  ])
  assert.ok(compareVersions('0.2.0', '0.10.0') < 0)
  assert.ok(compareVersions('1.0.0-rc', '1.0.0-rc.1') < 0)
})
test('lists the packages a server bundle imports by name, not builtins, relative files or text in strings', () => {
  const bundle = [
    'import { z } from "zod";\nimport * as pty from "node-pty";\nimport { join } from "node:path";',
    'import "yjs";\nexport { a } from "@noble/curves/ed25519.js";\nconst m = await import("ws");\nimport x from "./chunk.js";',
    'const swift = `\nimport AppKit\nimport Foundation from "Foundation"`;\nimport fs from "fs";',
  ]
  assert.deepEqual(importedPackages(bundle), ['@noble/curves', 'node-pty', 'ws', 'yjs', 'zod'])
})
test('publishes the server with every dependency the bundle needs, versioned, and refuses an undeclared one', () => {
  const server = {
    description: 'd',
    license: 'MIT',
    bin: { ramu: 'dist/cli.js' },
    engines: { node: '>=26' },
    dependencies: { zod: 'catalog:', ws: '8.0.0', 'chart.js': '4.0.0' },
  }
  const inlined = [{ name: '@ramu/shared', dependencies: { yjs: '13.0.0', '@ramu/contracts': 'workspace:*' } }]
  const manifest = npmManifest(server, {
    catalog: { zod: '4.0.0' },
    version: '1.2.3',
    imported: ['@ramu/contracts', 'ws', 'yjs', 'zod'],
    inlined,
  })
  assert.equal(manifest.name, '@akalstack/ramu')
  assert.equal(manifest.version, '1.2.3')
  assert.deepEqual(manifest.bin, { ramu: 'dist/cli.js' })
  assert.deepEqual(manifest.dependencies, { 'chart.js': '4.0.0', ws: '8.0.0', yjs: '13.0.0', zod: '4.0.0' })
  assert.throws(
    () => npmManifest(server, { catalog: { zod: '4.0.0' }, version: '1.2.3', imported: ['left-pad'], inlined }),
    /imports left-pad/,
  )
  assert.throws(() => npmManifest(server, { catalog: {}, version: '1.2.3', imported: [], inlined }), /catalog/)
})

test('the release body leaves out the title GitHub already shows as the release name', () => {
  assert.equal(releaseBody('# Ramu v2\n\n## Changed\n\n- A thing.\n'), '## Changed\n\n- A thing.\n')
  assert.equal(releaseBody('## Changed\n'), '## Changed\n')
})
