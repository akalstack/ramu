import { expect, it } from 'vitest'
import { forgeCommentMarkdown } from '../src/forgeMarkdown'

it('shows the emoji GitHub would, leaving code and unknown shortcodes as written', () => {
  expect(forgeCommentMarkdown('_:warning: Potential issue_\r\n')).toBe('_⚠️ Potential issue_\n')
  expect(forgeCommentMarkdown('Use `:warning:` or\n```\na:b:c\n```\n:not_an_emoji:')).toBe(
    'Use `:warning:` or\n```\na:b:c\n```\n:not_an_emoji:',
  )
})
