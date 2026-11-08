import { describe, expect, it } from 'vitest'
import { changedAt, headingAt } from '../src/editingPart'

describe('the part a person is editing', () => {
  it('names the heading above where they last typed', () => {
    const before = '# Plan\n\n## Goals\n\nShip sync.\n\n## Owner\n\nAyu\n'
    const after = before.replace('Ayu', 'Ayu and Bo')
    expect(headingAt(after, changedAt(before, after)!)).toBe('Owner')
    expect(headingAt('Intro\n\n## Goals\n', 2)).toBeNull()
    expect(changedAt(before, before)).toBeNull()
  })
})
