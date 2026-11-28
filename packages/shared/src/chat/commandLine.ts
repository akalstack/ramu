/**
 * A command as a note names it: its first line, cut with an ellipsis, so a script spanning many lines (a `python3 -c`
 * program, a heredoc) reads as one line in the chat instead of filling the screen. The tool row keeps the whole command.
 */
export function commandLine(command: string, max = 80): string {
  const lines = command
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const first = lines[0] ?? ''
  const cut = first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
  return lines.length > 1 && !cut.endsWith('…') ? `${cut} …` : cut
}
