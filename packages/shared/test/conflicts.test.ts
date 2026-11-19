import { describe, expect, it } from 'vitest'
import { parseConflicts, resolveConflicts } from '../src/conflicts'

const file = [
  'keep 1',
  '<<<<<<< HEAD',
  'mine A',
  '=======',
  'theirs A',
  '>>>>>>> feature',
  'keep 2',
  '<<<<<<< HEAD',
  'mine B',
  '||||||| base',
  'original B',
  '=======',
  'theirs B',
  'theirs B2',
  '>>>>>>> feature',
  'keep 3',
  '',
].join('\n')

describe('conflict markers', () => {
  it('reads each conflict with its sides, base and labels', () => {
    const hunks = parseConflicts(file)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ index: 0, line: 1, current: ['mine A'], base: null, incoming: ['theirs A'] })
    expect(hunks[0]).toMatchObject({ currentLabel: 'HEAD', incomingLabel: 'feature' })
    expect(hunks[1]).toMatchObject({ current: ['mine B'], base: ['original B'], incoming: ['theirs B', 'theirs B2'] })
  })

  it('keeps one side of one conflict, or of all, and leaves the rest of the file as it was', () => {
    const one = resolveConflicts(file, new Map([[1, 'incoming']]))
    expect(one).toContain('<<<<<<< HEAD\nmine A')
    expect(one).toContain('keep 2\ntheirs B\ntheirs B2\nkeep 3\n')
    expect(parseConflicts(one)).toHaveLength(1)
    expect(resolveConflicts(file, 'current')).toBe('keep 1\nmine A\nkeep 2\nmine B\nkeep 3\n')
    expect(resolveConflicts(file, 'both')).toBe(
      'keep 1\nmine A\ntheirs A\nkeep 2\nmine B\ntheirs B\ntheirs B2\nkeep 3\n',
    )
  })

  it('keeps Windows line endings and ignores unfinished markers', () => {
    const crlf = file.replace(/\n/g, '\r\n')
    expect(resolveConflicts(crlf, 'current')).toBe('keep 1\r\nmine A\r\nkeep 2\r\nmine B\r\nkeep 3\r\n')
    expect(parseConflicts('<<<<<<< HEAD\nonly one side\n')).toEqual([])
    expect(parseConflicts('a\n=======\nb')).toEqual([])
  })
})
