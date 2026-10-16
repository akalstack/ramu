/** Only offer prefixes for a single simple command, never a shell program or compound expression. */
export function commandPatterns(command: unknown): string[] {
  if (typeof command !== 'string' || /[\n\r;&|`$<>()[\]{}\\#]/.test(command)) return []
  const words = command.trim().split(/\s+/)
  const executable = words[0] ?? ''
  if (
    !/^[a-zA-Z][\w.-]*$/.test(executable) ||
    /^(?:ba|z|da|fi|c|k)?sh$|^(?:env|sudo|doas|eval|exec|command|xargs)$/.test(executable)
  )
    return []
  const subcommand = words[1]
  return [
    ...(subcommand && /^[a-zA-Z][\w-]*$/.test(subcommand) ? [`${executable} ${subcommand} *`] : []),
    `${executable} *`,
  ]
}

export function matchesCommand(pattern: string, command?: string): boolean {
  if (!/^[a-zA-Z][\w.-]*(?: [a-zA-Z][\w-]*)* \*$/.test(pattern)) return false
  if (!command || !commandPatterns(command).length) return false
  const prefix = pattern.slice(0, -2)
  const normalized = command.trim().replace(/\s+/g, ' ')
  return normalized === prefix || normalized.startsWith(prefix + ' ')
}
