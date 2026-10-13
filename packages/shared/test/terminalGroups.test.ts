import { describe, expect, it } from 'vitest'
import { splitTerminal, terminalFocusAfterClose, terminalGroups, unsplitTerminal } from '../src/terminalGroups'
import type { TaskUiState } from '../src/types'

const state: TaskUiState = { views: [{ kind: 'terminal', id: 'first', repoId: 'repo' }, { kind: 'terminal', id: 'other' }], activeViewId: null, activeTerminalId: 'first' }

describe('terminal groups', () => {
  it('splits the active group and leaves unrelated terminals alone', () => {
    const next = splitTerminal(state, 'horizontal', 'split')
    expect(next.terminalGroups?.map((group) => group.terminalIds)).toEqual([['first', 'split'], ['other']])
    expect(next.views.at(-1)).toEqual({ kind: 'terminal', id: 'split', repoId: 'repo' })
    expect(next.activeTerminalId).toBe('split')
    expect(next.terminalOpen).toBe(true)
    const again = splitTerminal(next, 'vertical', 'third')
    expect(again.terminalGroups?.[0]).toEqual({ id: 'first', terminalIds: ['first', 'split', 'third'], layout: 'vertical' })
    expect(again.terminalGroups?.[1]?.terminalIds).toEqual(['other'])
  })
  it('unsplits a pane without replacing its shell or changing the other groups', () => {
    const split = splitTerminal(state, 'horizontal', 'split')
    const next = unsplitTerminal(split, 'first')
    expect(next.views).toEqual(split.views)
    expect(next.terminalGroups?.map((group) => group.terminalIds)).toEqual([['split'], ['first'], ['other']])
    expect(next.activeTerminalId).toBe('first')
    expect(terminalGroups(JSON.parse(JSON.stringify(next)))).toEqual(next.terminalGroups)
  })
  it('keeps focus on the surviving sibling and removes closed panes from a group', () => {
    const split = splitTerminal(state, 'horizontal', 'split')
    expect(terminalFocusAfterClose(split, new Set(['split']))).toBe('first')
    expect(terminalGroups({ ...split, views: split.views.filter((view) => view.id !== 'split') }).map((group) => group.terminalIds)).toEqual([['first'], ['other']])
    expect(terminalFocusAfterClose(split, new Set(['first', 'split']))).toBe('other')
    expect(terminalFocusAfterClose(split, new Set(['first', 'split', 'other']))).toBeNull()
  })
  it('restores a legacy split as one group and ignores stale or duplicated group entries', () => {
    expect(terminalGroups({ ...state, terminalLayout: 'vertical' })).toEqual([{ id: 'first', terminalIds: ['first', 'other'], layout: 'vertical' }])
    expect(terminalGroups({ ...state, terminalGroups: [{ id: 'group', terminalIds: ['gone', 'first', 'first'], layout: 'horizontal' }] }).map((group) => group.terminalIds)).toEqual([['first'], ['other']])
  })
})
