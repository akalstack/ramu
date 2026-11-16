import { expect, it } from 'vitest'
import { fileListEntry, pathsFromUriList } from '../src/main/fileClipboard'

it('reads copied files and ignores web links and relative entries', () => {
  expect(
    pathsFromUriList('file:///Users/me/a%20b.txt\r\nhttps://example.com/x\r\n# comment\nfile:///Users/me/a%20b.txt\n'),
  ).toEqual(['/Users/me/a b.txt'])
})

it('writes files a file manager can paste and paths as text', () => {
  const entry = fileListEntry(['/Users/me/a b.txt', '/tmp/c#1.md'])
  expect(entry['text/uri-list']).toBe('file:///Users/me/a%20b.txt\r\nfile:///tmp/c%231.md')
  expect(entry['text/plain']).toBe('/Users/me/a b.txt\n/tmp/c#1.md')
  expect(pathsFromUriList(entry['text/uri-list']!)).toEqual(['/Users/me/a b.txt', '/tmp/c#1.md'])
})
