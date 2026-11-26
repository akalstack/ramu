import { describe, expect, it } from 'vitest'
import { summarizeTools, toolRowWords, type SummaryTool } from '../src/chat/toolSummary'

// Translation left out: the keys are the English copy, with their values filled in.
const say = (text: string, values: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key]))
const call = (name: string, extra: Partial<SummaryTool> = {}): SummaryTool => ({ name, running: false, ...extra })

describe('summarizeTools', () => {
  it('counts each tool in words, in the order it first appears', () => {
    expect(
      summarizeTools(
        [call('Bash'), call('Read'), call('Bash'), call('Read'), call('Read'), call('Edit'), call('WebSearch')],
        say,
      ),
    ).toBe('Ran 2 commands, Read 3 files, Edited 1 file, Searched the web')
  })

  it('reads a kind still running in the present', () => {
    expect(summarizeTools([call('Bash'), call('Bash', { running: true }), call('Grep')], say)).toBe(
      'Running 2 commands, Searched 1 pattern',
    )
  })

  it('names what a tool called once acted on, keeping counts for the rest', () => {
    expect(
      summarizeTools(
        [
          call('Bash', { subject: 'pnpm test\nsecond line' }),
          call('Read', { subject: 'a.ts' }),
          call('Read', { subject: 'b.ts' }),
        ],
        say,
      ),
    ).toBe('Ran pnpm test, Read 2 files')
    expect(summarizeTools([call('Bash', { running: true, subject: 'pnpm build' })], say)).toBe('Running pnpm build')
    expect(summarizeTools([call('Bash', { subject: `echo ${'word '.repeat(20)}` })], say)).toMatch(
      /^Ran echo word( word)*…$/,
    )
  })

  it('names a tool outside the table by its own words, or by what it does', () => {
    expect(summarizeTools([call('mcp__jira__addWorklog'), call('mcp__jira__addWorklog')], say)).toBe(
      'Used AddWorklog ×2',
    )
    expect(summarizeTools([call('fs_remove', { kind: 'delete', title: 'old.log' })], say)).toBe('Deleted old.log')
  })

  it('puts Ramu’s own tools and viewed images in their own words', () => {
    const goal = { key: 'set_goal', done: 'Set a goal', running: 'Setting a goal', subject: 'Ship it' }
    expect(summarizeTools([call('mcp__ramu__set_goal', { ramu: goal })], say)).toBe('Set a goal Ship it')
    expect(
      summarizeTools([call('mcp__ramu__set_goal', { ramu: goal }), call('mcp__ramu__set_goal', { ramu: goal })], say),
    ).toBe('Set a goal ×2')
    expect(summarizeTools([call('view_image', { image: { name: 'shot.png' } })], say)).toBe('Viewed shot.png')
    expect(summarizeTools([call('view_image', { image: {} }), call('view_image', { image: {} })], say)).toBe(
      'Viewed 2 images',
    )
  })
})

describe('toolRowWords', () => {
  const words = (tool: { name: string; title?: string; summary: string }, running = false) =>
    toolRowWords(tool, 'other', running, say)

  it('lets the provider’s own title stand alone', () => {
    expect(words({ name: 'Bash', title: ' Find the callers ', summary: 'grep -rn renew src' })).toEqual({
      verb: '',
      subject: 'Find the callers',
    })
  })

  it('reads an untitled call as a verb and what it acted on, in the present while it runs', () => {
    expect(words({ name: 'Bash', summary: 'pnpm test' })).toEqual({ verb: 'Ran', subject: 'pnpm test' })
    expect(words({ name: 'Bash', summary: 'pnpm test' }, true)).toEqual({ verb: 'Running', subject: 'pnpm test' })
    expect(words({ name: 'Grep', summary: 'renew(' })).toEqual({ verb: 'Searched', subject: 'renew(' })
    expect(toolRowWords({ name: 'fs_remove', summary: 'old.log' }, 'delete', false, say)).toEqual({
      verb: 'Deleted',
      subject: 'old.log',
    })
  })

  it('says what a tool search looked for, and names a tool whose summary is only its input', () => {
    expect(words({ name: 'ToolSearch', summary: 'query: "select:mcp__jira__addWorklog,Read"' })).toEqual({
      verb: 'Loaded',
      subject: 'AddWorklog, Read',
    })
    expect(words({ name: 'ToolSearch', summary: 'query: "browser"' }, true)).toEqual({
      verb: 'Searching tools',
      subject: '“browser”',
    })
    expect(words({ name: 'mcp__jira__addWorklog', summary: '{"issue":"A-1"}' })).toEqual({
      verb: 'Used',
      subject: 'AddWorklog',
    })
  })
})
