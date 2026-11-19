import { expect, it } from 'vitest'
import {
  baseName,
  freeName,
  isValidEntryName,
  isWithin,
  joinPath,
  nestedRoots,
  parentOf,
} from '../src/sidebar/explorer/paths'

it('splits and joins repository paths', () => {
  expect(baseName('a/b/c.ts')).toBe('c.ts')
  expect(baseName('c.ts')).toBe('c.ts')
  expect(parentOf('a/b/c.ts')).toBe('a/b')
  expect(parentOf('c.ts')).toBe('')
  expect(joinPath('', 'c.ts')).toBe('c.ts')
  expect(joinPath('a/b', 'c.ts')).toBe('a/b/c.ts')
})

it('picks the first free copy name', () => {
  expect(freeName('a.txt', new Set())).toBe('a.txt')
  expect(freeName('a.txt', new Set(['a.txt']))).toBe('a copy.txt')
  expect(freeName('a.txt', new Set(['a.txt', 'a copy.txt']))).toBe('a copy 2.txt')
  expect(freeName('Makefile', new Set(['Makefile']))).toBe('Makefile copy')
  // A leading dot is part of the name, not an extension.
  expect(freeName('.env', new Set(['.env']))).toBe('.env copy')
})

it('rejects names that are empty, dotted or contain a slash', () => {
  for (const name of ['', '  ', '.', '..', 'a/b', 'a\\b']) expect(isValidEntryName(name)).toBe(false)
  expect(isValidEntryName('.gitignore')).toBe(true)
  expect(isValidEntryName('a b.txt')).toBe(true)
})

it('treats a path as within its parent only at a folder boundary', () => {
  expect(isWithin('src', 'src')).toBe(true)
  expect(isWithin('src/a.ts', 'src')).toBe(true)
  expect(isWithin('src2/a.ts', 'src')).toBe(false)
})

it('names the folders that another tree shows as its own root', () => {
  const roots = ['/p/albea-hr', '/p/albea-hr/backend', '/p/albea-hr/frontend', '/p/other']
  expect([...nestedRoots('/p/albea-hr', roots)]).toEqual(['backend', 'frontend'])
  expect(nestedRoots('/p/albea-hr/backend', roots).size).toBe(0)
  expect(nestedRoots('/p/albea', ['/p/albea-hr']).size).toBe(0)
})
