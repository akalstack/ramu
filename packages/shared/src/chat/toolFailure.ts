const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, 'g')
const EXIT_LINE = /^\s*(?:Exit code|exit status|exited with code)[:\s]+(-?\d+)\s*$/i
const MAX_LINES = 3
const MAX_LINE = 240

export interface ToolFailure {
  /** The exit code the output names, when it names one. */
  exit?: string
  /** The last lines of the output, where a command almost always says what went wrong. */
  lines: string[]
}

/**
 * What a failed tool call said, short enough to show under its row without opening it: the exit code, then the last few
 * non-empty lines of its output with terminal colours removed. Empty output gives no lines.
 */
export function toolFailure(output: string | undefined): ToolFailure {
  let exit: string | undefined
  const lines: string[] = []
  for (const raw of (output ?? '').replace(ANSI, '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const code = EXIT_LINE.exec(line)
    if (code) {
      exit ??= code[1]
      continue
    }
    lines.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line)
  }
  return { ...(exit === undefined ? {} : { exit }), lines: lines.slice(-MAX_LINES) }
}
