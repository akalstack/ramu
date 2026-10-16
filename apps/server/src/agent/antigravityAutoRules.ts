import { commandPatterns, matchesCommand } from './permissionCommands'

const readCommands = ['diff', 'status', 'log', 'show']
const commonFlags = new Set([
  '--no-pager',
  '--no-optional-locks',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--color=never',
])
const flags: Record<string, RegExp> = {
  diff: /^(?:--(?:stat|numstat|shortstat|name-only|name-status|summary|check|cached|staged|no-renames|binary|relative)|-U\d+|--unified=\d+)$/,
  status:
    /^(?:--(?:short|branch|porcelain(?:=v?[12])?|untracked-files(?:=(?:no|normal|all))?|ignored|no-renames)|-[sb]{1,2})$/,
  log: /^(?:--(?:oneline|stat|name-only|name-status|no-patch|patch|all|no-decorate|decorate|pretty=oneline|max-count=\d+)|-[pn]|-n\d+)$/,
  show: /^(?:--(?:oneline|stat|name-only|name-status|no-patch|patch|pretty=oneline)|-p)$/,
}

/** A deliberately small allowlist: unrecognized syntax and options require review. */
export function isRoutineGitRead(command: string): boolean {
  if (!matchesCommand('git *', command)) return false
  const words = command.trim().split(/\s+/)
  if (words.some((word) => !/^[\w./:@%+=,~^-]+$/.test(word))) return false
  words.shift()
  while (commonFlags.has(words[0] ?? '')) words.shift()
  const verb = words.shift() ?? ''
  if (!readCommands.includes(verb)) return false
  let paths = false
  return words.every((word) => {
    if (word === '--') {
      paths = true
      return true
    }
    return paths || !word.startsWith('-') || commonFlags.has(word) || flags[verb]!.test(word)
  })
}

export function matchesAntigravityDefault(id: string, command: string): boolean {
  if (id === 'shell-review') return commandPatterns(command).length === 0
  if (id === 'pwd') return /^pwd(?:\s+-[LP])?$/.test(command.trim())
  if (id.startsWith('git-read:')) return isRoutineGitRead(command) && matchesCommand(`git ${id.slice(9)} *`, command)
  if (id === 'git-review') {
    if (!matchesCommand('git *', command)) return false
    const words = command.trim().split(/\s+/).slice(1)
    while (['--no-pager', '--no-optional-locks'].includes(words[0] ?? '')) words.shift()
    const verb = words[0] ?? ''
    return (
      verb.startsWith('-') ||
      ['reset', 'clean', 'restore', 'checkout', 'push'].includes(verb) ||
      (readCommands.includes(verb) && !isRoutineGitRead(command))
    )
  }
  return matchesCommand(`${id} *`, command)
}

export const ANTIGRAVITY_AUTO_DEFAULTS = [
  ...readCommands.map((verb) => ({
    id: `git-read:${verb}`,
    pattern: `git ${verb} *`,
    label: `git ${verb} * · read options only`,
    behavior: 'allow' as const,
  })),
  { id: 'pwd', pattern: 'pwd *', label: 'pwd', behavior: 'allow' as const },
  { id: 'shell-review', label: 'Compound commands, shell expansion and wrappers', behavior: 'ask' as const },
  {
    id: 'git-review',
    pattern: 'git *',
    label: 'Git destructive operations, global overrides and unsafe read flags',
    behavior: 'ask' as const,
  },
  ...['rm', 'rmdir', 'chmod', 'chown', 'kill', 'killall', 'pkill', 'mkfs', 'dd'].map((command) => ({
    id: command,
    pattern: `${command} *`,
    label: `${command} *`,
    behavior: 'ask' as const,
  })),
]
