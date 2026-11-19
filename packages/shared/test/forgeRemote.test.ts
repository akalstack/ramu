import { describe, expect, it } from 'vitest'
import { githubApiBase, normalizeOrigin, parseForgeRemote, redactSecrets } from '../src/forgeRemote'

describe('parseForgeRemote', () => {
  it('reads HTTPS, SSH and scp-style remotes to the same repository identity', () => {
    const expected = { origin: 'github.com', owner: 'o', repo: 'r' }
    expect(parseForgeRemote('https://github.com/o/r.git')).toMatchObject({ ...expected, protocol: 'https' })
    expect(parseForgeRemote('git@github.com:o/r.git')).toMatchObject({ ...expected, protocol: 'ssh' })
    expect(parseForgeRemote('ssh://git@github.com:22/o/r')).toMatchObject({ ...expected, protocol: 'ssh' })
    expect(parseForgeRemote('git://GitHub.com/o/r/')).toMatchObject({ ...expected, protocol: 'git' })
  })

  it('keeps an HTTPS port in the origin but ignores the SSH port, which is not the API port', () => {
    expect(parseForgeRemote('https://ghe.example.com:8443/team/app.git')?.origin).toBe('ghe.example.com:8443')
    expect(parseForgeRemote('ssh://git@ghe.example.com:2222/team/app.git')?.origin).toBe('ghe.example.com')
  })

  it('rejects embedded passwords, local paths and malformed values', () => {
    expect(parseForgeRemote('https://user:ghp_secret@github.com/o/r.git')).toBeNull()
    expect(parseForgeRemote('/Users/me/code/repo')).toBeNull()
    expect(parseForgeRemote('C:\\code\\repo')).toBeNull()
    expect(parseForgeRemote('')).toBeNull()
    expect(parseForgeRemote('https://github.com/only-owner')).toBeNull()
    expect(parseForgeRemote('file:///tmp/x/y')).toBeNull()
  })

  it('does not collide hosts that differ only by a port, and ignores case', () => {
    expect(parseForgeRemote('https://Git.Example.com/a/b')?.origin).toBe('git.example.com')
    expect(parseForgeRemote('https://git.example.com:9443/a/b')?.origin).not.toBe(
      parseForgeRemote('https://git.example.com/a/b')?.origin,
    )
  })
})

describe('origins', () => {
  it('accepts only a plain host or host:port', () => {
    expect(normalizeOrigin(' GHE.Example.com:8443 ')).toBe('ghe.example.com:8443')
    for (const bad of [
      'https://github.com',
      'github.com/path',
      'a b',
      'user@github.com',
      'host:0',
      'host:70000',
      '-bad.com',
    ])
      expect(normalizeOrigin(bad)).toBeNull()
  })
  it('maps github.com and Enterprise servers to their API bases', () => {
    expect(githubApiBase('github.com')).toBe('https://api.github.com')
    expect(githubApiBase('ghe.example.com:8443')).toBe('https://ghe.example.com:8443/api/v3')
  })
})

it('redacts tokens and credential-bearing URLs from provider text', () => {
  const text = 'fatal: https://me:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r failed; Bearer abcdefghijklmnop1234'
  const clean = redactSecrets(text)
  expect(clean).not.toContain('ghp_')
  expect(clean).not.toContain('abcdefghijklmnop1234')
  expect(redactSecrets('github_pat_11AAAAAAA0abcdefghijklmnop')).toBe('[redacted]')
})
