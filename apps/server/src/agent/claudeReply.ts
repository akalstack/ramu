import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { classifyLimit } from '../providers/limitClassifier'

/**
 * Reads a one-shot Claude query to the end and returns its text; a failed result throws, as `usage_limit_reached` when it is
 * confidently a limit. A low-confidence match throws the raw result, so a generic phrase never starts a limit wait here.
 */
export async function claudeReplyText(query: Query): Promise<string> {
  let text = ''
  for await (const m of query) {
    if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'text') text += b.text
    if (m.type === 'result' && m.is_error)
      throw new Error(
        classifyLimit(m, { provider: 'claude-code', channel: 'error' })?.confidence === 'high'
          ? 'usage_limit_reached'
          : JSON.stringify(m),
      )
  }
  return text
}
