// Agents sign their work: a Co-authored-by trailer for the agent's address and a "Generated with …" footer. Ramu takes
// them out of the commit messages, pull requests and drafts it writes, and asks agents not to add them, so the history
// reads as the person's. People's own co-author trailers are kept, and nothing inside code is touched.

/** Addresses only coding agents commit as. GitHub's generic noreply address is also used by people: see below. */
const AGENT_EMAILS = new Set([
  'noreply@anthropic.com',
  'claude@anthropic.com',
  'noreply@openai.com',
  'codex@openai.com',
  'cursoragent@cursor.com',
  'copilot@github.com',
  'noreply@github.com',
  'antigravity@google.com',
  'noreply@opencode.ai',
])

const AGENT_NAMES =
  'claude(?: code)?|codex|cursor(?: agent)?|github copilot|copilot|opencode|grok|antigravity|gemini(?: cli)?|ramu'

const AGENT_NAME = new RegExp(`^(?:${AGENT_NAMES})(?:\\s+[\\w.-]+)*$`, 'i')
const AGENT_DOMAIN = /@(?:[\w-]+\.)*(?:anthropic\.com|openai\.com|cursor\.com|google\.com|opencode\.ai|x\.ai)$/i

const GENERATED_BY_AGENT = new RegExp(
  `^(?:🤖\\s*)?(?:generated|written|created) (?:with|by|using)\\s+(?:${AGENT_NAMES})[.!]?$`,
  'i',
)

/** Links in a footer, reduced to their words, so "[Claude Code](https://claude.com/…)" reads as "Claude Code". */
const AGENT_LINK =
  /\[([^\]]+)\]\(https:\/\/(?:claude\.ai|claude\.com|www\.anthropic\.com|chatgpt\.com|openai\.com|cursor\.com|github\.com|opencode\.ai|x\.ai|antigravity\.google|ramu\.dev|getramu\.dev)(?:\/[^\s)]*)?\)/gi

/**
 * The message without agent credits: agent co-author trailers and "Generated with <agent>" footers. Fenced and indented
 * code is kept as written; the message is returned unchanged when there was nothing to remove, and trailing blank
 * lines left behind are trimmed.
 */
export function removeAgentCredits(message: string): string {
  let fence: string | undefined
  let removed = false
  const newline = message.includes('\r\n') ? '\r\n' : '\n'
  const kept = message.split(/\r?\n/).map((line) => {
    if (/^(?: {4}|\t)/.test(line)) return line
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const marker = delimiter?.[1]
    const remainder = delimiter?.[2] ?? ''
    if (marker !== undefined) {
      if (fence === undefined) {
        if (marker[0] === '~' || !remainder.includes('`')) fence = marker
      } else if (marker[0] === fence[0] && marker.length >= fence.length && /^[ \t]*$/.test(remainder))
        fence = undefined
      return line
    }
    if (fence !== undefined) return line
    const text = line.trim().replace(/^(?:[-*]\s+)/, '')
    const author = /^co-authored-by:\s*(.*?)\s*<([^<>]+)>\s*$/i.exec(text)
    const email = author?.[2]?.toLowerCase()
    const name = author?.[1] ?? ''
    const agentAuthor =
      email !== undefined &&
      ((AGENT_EMAILS.has(email) && (email !== 'noreply@github.com' || /^(?:github )?copilot$/i.test(name))) ||
        // An agent by name on another address of its maker ("Claude Opus 5.5 <claude-code@anthropic.com>"); the
        // domain check keeps a person who happens to be called Claude.
        (AGENT_DOMAIN.test(email) && AGENT_NAME.test(name.replace(/\s*\(.*\)$/, ''))))
    const footer = text.replace(AGENT_LINK, '$1')
    if (!agentAuthor && !GENERATED_BY_AGENT.test(footer)) return line
    removed = true
    return null
  })
  if (!removed) return message
  // A blank line on each side of a removed credit becomes one, so the paragraphs around it stay as they were.
  const lines: string[] = []
  let gap = false
  for (const line of kept) {
    if (line === null) {
      gap = true
      continue
    }
    const blank = !line.trim()
    if (!(gap && blank && lines.length && !lines[lines.length - 1]!.trim())) lines.push(line)
    if (!blank) gap = false
  }
  return lines.join(newline).replace(/(?:\r?\n[ \t]*)+$/, '')
}

/** What agents are asked, so credits are not written in the first place. */
export const NO_AGENT_CREDITS_GUIDANCE =
  'When you write a git commit message, pull request or similar record, do not add Co-authored-by trailers for yourself or any AI, and no "Generated with" or similar AI attribution lines. The person is the author.'
