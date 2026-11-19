// Which code blocks in a reply can be run in a terminal, and the text to type. Desktop and phone both show Run on these.

/** Fence languages that hold shell commands. */
const SHELL = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'console',
  'shellsession',
  'terminal',
  'powershell',
  'pwsh',
  'ps1',
  'cmd',
  'bat',
])
/** Fences that show a session: commands after a prompt, with their output between. */
const SESSION = new Set(['console', 'shellsession', 'terminal'])

/**
 * The command to type for a code block, or null when it is not a shell block. A session block keeps only the lines after
 * a `$ ` prompt, so its printed output is not run.
 */
export function runnableCommand(source: string, hint: string | undefined): string | null {
  const language = hint?.trim().toLowerCase()
  if (!language || !SHELL.has(language)) return null
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const kept = SESSION.has(language)
    ? lines.flatMap((line) => {
        const match = /^\s*\$\s+(.*)$/.exec(line)
        return match ? [match[1]!] : []
      })
    : lines
  const text = kept.join('\n').trim()
  return text ? text : null
}
