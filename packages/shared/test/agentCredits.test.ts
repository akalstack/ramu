import { describe, expect, it } from 'vitest'
import { removeAgentCredits } from '../src/workspace/agentCredits'

describe('removeAgentCredits', () => {
  it('removes agent co-author trailers and generated footers, keeping people', () => {
    const message = [
      'feat: add search',
      '',
      'Body text.',
      '',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      '',
      'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
      'Co-authored-by: Ada Lovelace <ada@example.com>',
      'Co-authored-by: Codex <codex@openai.com>',
    ].join('\n')
    expect(removeAgentCredits(message)).toBe(
      ['feat: add search', '', 'Body text.', '', 'Co-authored-by: Ada Lovelace <ada@example.com>'].join('\n'),
    )
  })

  it('trims what the removed credits leave at the end', () => {
    expect(removeAgentCredits('fix: typo\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')).toBe('fix: typo')
  })

  it('returns the message unchanged when there is nothing to remove', () => {
    const message = 'chore: bump\n\nCo-authored-by: Claude Monet <claude@monet.fr>\n'
    expect(removeAgentCredits(message)).toBe(message)
  })

  it('knows agents by name on their makers’ other addresses, and Copilot only by name on GitHub noreply', () => {
    expect(removeAgentCredits('x\n\nCo-authored-by: Claude Code <claude-code@anthropic.com>')).toBe('x')
    expect(removeAgentCredits('x\n\nCo-authored-by: Copilot <noreply@github.com>')).toBe('x')
    const person = 'x\n\nCo-authored-by: Sam <noreply@github.com>'
    expect(removeAgentCredits(person)).toBe(person)
  })

  it('leaves fenced and indented code alone', () => {
    const message = [
      'docs: show the trailer',
      '',
      '```',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      '```',
      '    Generated with Codex',
    ].join('\n')
    expect(removeAgentCredits(message)).toBe(message)
  })

  it('keeps CRLF line endings', () => {
    expect(removeAgentCredits('a\r\nb\r\n\r\nGenerated with Cursor\r\n')).toBe('a\r\nb')
  })
})
