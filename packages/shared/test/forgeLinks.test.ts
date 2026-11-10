import { describe, expect, it } from 'vitest'
import { diffAnchorFile, forgeRepoOf, parseForgeLink, sameForgeRepo } from '../src/forgeLinks'
import { sha256Hex } from '../src/sha256'

const base = { url: 'https://github.com/Acme/app/pull/12', ref: 'feature' }

describe('links in a pull request', () => {
  it('reads pull requests, their changed files and issues', () => {
    expect(parseForgeLink('https://github.com/acme/app/pull/12/files', base)).toEqual({
      kind: 'pull',
      repo: 'acme/app',
      number: 12,
      files: true,
    })
    expect(parseForgeLink('https://github.com/acme/app/pull/12/files#diff-abc', base)).toMatchObject({
      anchor: 'diff-abc',
    })
    expect(parseForgeLink('https://github.com/acme/other/pull/3', base)).toMatchObject({ kind: 'pull', number: 3 })
    expect(parseForgeLink('https://github.com/acme/app/issues/7', base)).toEqual({
      kind: 'issue',
      repo: 'acme/app',
      number: 7,
    })
  })

  it('reads files and folders with their line, on GitHub, GitLab and Bitbucket', () => {
    expect(parseForgeLink('https://github.com/acme/app/blob/main/src/a.ts#L10-L20', base)).toEqual({
      kind: 'file',
      repo: 'acme/app',
      ref: 'main',
      path: 'src/a.ts',
      line: 10,
    })
    expect(parseForgeLink('https://github.com/acme/app/tree/main/docs', base)).toEqual({
      kind: 'folder',
      repo: 'acme/app',
      ref: 'main',
      path: 'docs',
    })
    expect(parseForgeLink('https://gitlab.com/g/sub/app/-/merge_requests/4/diffs', base)).toMatchObject({
      kind: 'pull',
      repo: 'g/sub/app',
      number: 4,
      files: true,
    })
    expect(parseForgeLink('https://bitbucket.org/team/app/src/main/a.ts#lines-5', base)).toMatchObject({
      kind: 'file',
      path: 'a.ts',
      line: 5,
    })
  })

  it('resolves a relative link to a file in the pull request’s repository at its branch', () => {
    expect(parseForgeLink('./docs/setup.md#L3', base)).toEqual({
      kind: 'file',
      repo: 'Acme/app',
      ref: 'feature',
      path: 'docs/setup.md',
      line: 3,
    })
    expect(parseForgeLink('a/../b.md', base)).toMatchObject({ path: 'b.md' })
  })

  it('leaves other sites, anchors and mail to the browser', () => {
    expect(parseForgeLink('https://example.com/acme/app/pull/1', base)).toBeNull()
    expect(parseForgeLink('#section', base)).toBeNull()
    expect(parseForgeLink('mailto:a@b.c', base)).toBeNull()
  })

  it('names the repository case-insensitively, and finds the file a diff anchor names', () => {
    expect(forgeRepoOf(base.url)).toEqual({ host: 'github.com', repo: 'Acme/app' })
    expect(sameForgeRepo('Acme/app', 'acme/APP')).toBe(true)
    const hash = sha256Hex(new TextEncoder().encode('src/b.ts'))
    expect(diffAnchorFile(`diff-${hash}R14`, ['src/a.ts', 'src/b.ts'])).toEqual({
      path: 'src/b.ts',
      line: 14,
      side: 'new',
    })
    expect(diffAnchorFile(`diff-${hash}`, ['src/a.ts'])).toBeNull()
  })
})
