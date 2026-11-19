/**
 * Ramu's own Auto for providers without an automatic reviewer (Antigravity today; any ACP-style provider that asks
 * for every command can use it).
 *
 * Claude Code, Codex and Cursor each put a reviewer in front of the actions that would otherwise ask. They trust the
 * workspace (reads, edits, tests, local Git), and stop on the same families of risk: destroying work that existed
 * before the session, sending data or credentials out, downloading and running code, weakening the machine's
 * security, publishing or deploying, and running something the reviewer cannot read. This file mimics that with
 * predefined, deterministic rules instead of a model:
 *
 *  - `parseCommand` accepts only plain command lines: words, quotes, `&&` `||` `;` `|` and redirects to /dev/null.
 *    Substitution, expansion, other redirects, subshells, background jobs and wrappers are not understood, so they ask.
 *  - Each segment is classified. Any segment in a risk family makes the whole line "always ask", even above a broader
 *    saved allow rule. Otherwise the line runs when every segment is a recognised routine command.
 *  - Anything else is unknown, and unknown asks (approve once, or save your own rule).
 *
 * These are review rules, not execution denials. Edits are handled by the provider's own `auto_edit`.
 */

type Segment = string[]
const MAX_COMMAND = 2000
const MAX_SEGMENTS = 8

/** Splits a command line into segments of words, or null when it uses syntax this file does not understand. */
export function parseCommand(command: string): Segment[] | null {
  if (!command || command.length > MAX_COMMAND || /[\n\r\0]/.test(command)) return null
  const segments: Segment[] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (!words.length) return false
    segments.push(words)
    words = []
    return true
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (c === "'" || c === '"') {
      const end = command.indexOf(c, i + 1)
      if (end < 0) return null
      const body = command.slice(i + 1, end)
      if (/[`$\\\n\r]/.test(body)) return null
      word += body
      inWord = true
      i = end
    } else if (/\s/.test(c)) endWord()
    else if (c === '&' && command[i + 1] === '&') {
      if (!endSegment()) return null
      i++
    } else if (c === '|' && command[i + 1] === '|') {
      if (!endSegment()) return null
      i++
    } else if (c === ';' || c === '|') {
      if (!endSegment()) return null
    } else if (c === '>' || c === '<' || (c === '&' && command[i + 1] === '>')) {
      // Only redirects that discard output: `>/dev/null`, `2>/dev/null`, `&>/dev/null` and `2>&1`.
      const fd = c === '&' ? '&' : inWord ? word : ''
      if (inWord && c !== '&' && !/^[12]$/.test(word)) return null
      const rest = command.slice(c === '&' ? i + 1 : i)
      const redirect = /^>\s*\/dev\/null(?![\w./-])/.exec(rest) ?? (fd === '2' ? /^>&1(?![\w])/.exec(rest) : null)
      if (!redirect || c === '<') return null
      word = ''
      inWord = false
      i += (c === '&' ? 1 : 0) + redirect[0].length - 1
    } else if (/[`$\\(){}[\]#&!]/.test(c)) return null
    else {
      word += c
      inWord = true
    }
  }
  if (inWord || words.length) endSegment()
  if (!segments.length || segments.length > MAX_SEGMENTS) return null
  return segments
}

const SENSITIVE_PATH =
  /(?:^|\/)(?:\.env(?:\.(?!example$)[\w.-]+)?|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.kube|\.docker|\.config\/(?:gh|gcloud)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|[\w.-]*\.(?:pem|key|p12|pfx|jks|keystore)|credentials\.json|secrets?\.(?:json|ya?ml|toml|env|txt))(?:\/|$)/i

/** A word that names somewhere outside the working tree, or something the shell would expand. */
function outsidePath(word: string): boolean {
  const value = word.startsWith('-') && word.includes('=') ? word.slice(word.indexOf('=') + 1) : word
  if (word.startsWith('-') && !word.includes('=')) return false
  return /^(?:\/|~)/.test(value) || /(?:^|\/)\.\.(?:\/|$)/.test(value) || /^[A-Za-z]:[\\/]/.test(value)
}
const sensitive = (word: string) => SENSITIVE_PATH.test(word)
const safeWords = (words: string[]) => words.every((word) => !outsidePath(word))

const flagsOf = (words: string[]) => words.filter((word) => word.startsWith('-') && word !== '-')
const positional = (words: string[]) => words.filter((word) => !word.startsWith('-'))

/** Wrappers and launchers run something else, so what they run cannot be judged from here. */
const WRAPPERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'fish',
  'ksh',
  'csh',
  'tcsh',
  'env',
  'eval',
  'exec',
  'command',
  'builtin',
  'xargs',
  'nohup',
  'time',
  'timeout',
  'watch',
  'nice',
  'ionice',
  'script',
  'osascript',
  'source',
  '.',
  'python',
  'python3',
  'node',
  'deno',
  'bun',
  'ruby',
  'perl',
  'php',
  'lua',
  'tclsh',
  'awk',
  'gawk',
  'sed',
  'open',
])
// Interpreters (`python`, `node`, ...) appear above only for bare `-c`/`-e` style use; their test runners are allowed
// separately before this check, see `isWrapper`.
const INLINE_FLAG = /^-(?:c|e|r|p|x|exec|eval|-eval|-input-type=.*)$/

/** Risk families. Each is "always ask": a saved allow rule never lifts it. */
type Risk =
  | 'shell-review'
  | 'destructive-files'
  | 'destructive-git'
  | 'credentials'
  | 'privileged'
  | 'process'
  | 'tunnel'
  | 'unsafe-flags'
  | 'publish'
type Allow = 'read' | 'git-read' | 'git-local' | 'workspace-files' | 'project-checks' | 'version'

/** Options that make a read-looking command write, run another program, or change where Git looks. */
const DANGEROUS_OPTION =
  /^(?:--(?:output|ext-diff|textconv|exec|exec-path|open-files-in-pager|upload-pack|receive-pack|git-dir|work-tree|config-env|pager|paginate)(?:=.*)?|-O)$/

const UNSAFE_FLAGS = new Set([
  '--insecure',
  '--no-verify',
  '--no-sandbox',
  '--dangerously-skip-permissions',
  '--yes-always',
  '--no-check-certificate',
  '--trust-all',
  '--disable-web-security',
  '--no-preserve-root',
  '--allow-root',
  '--unsafe-perm',
  '--force-with-lease',
])
const PRIVILEGED = new Set([
  'sudo',
  'su',
  'doas',
  'pkexec',
  'chmod',
  'chown',
  'chgrp',
  'chflags',
  'setfacl',
  'xattr',
  'launchctl',
  'systemctl',
  'service',
  'crontab',
  'at',
  'defaults',
  'csrutil',
  'spctl',
  'iptables',
  'pfctl',
  'ufw',
  'networksetup',
  'scutil',
  'dscl',
  'sysctl',
  'mount',
  'umount',
  'diskutil',
  'visudo',
  'passwd',
  'useradd',
  'userdel',
  'usermod',
])
const DESTRUCTIVE = new Set([
  'rm',
  'rmdir',
  'shred',
  'unlink',
  'truncate',
  'dd',
  'srm',
  'mkfs',
  'fdisk',
  'parted',
  'wipefs',
])
const PROCESS = new Set(['kill', 'killall', 'pkill', 'shutdown', 'reboot', 'halt', 'poweroff'])
const TUNNEL = new Set([
  'ngrok',
  'cloudflared',
  'lt',
  'localtunnel',
  'bore',
  'frpc',
  'socat',
  'nc',
  'ncat',
  'netcat',
  'telnet',
])
const CREDENTIAL_TOOLS = new Set([
  'env',
  'printenv',
  'history',
  'security',
  'op',
  'pass',
  'gpg',
  'gpg2',
  'ssh-add',
  'ssh-keygen',
  'keychain',
])
const CLOUD = new Set([
  'aws',
  'gcloud',
  'az',
  'doctl',
  'gsutil',
  'bq',
  'eksctl',
  'oc',
  'kubectl',
  'helm',
  'terraform',
  'tofu',
  'pulumi',
  'cdk',
  'terragrunt',
  'ansible',
  'ansible-playbook',
  // Hosting and store CLIs always ask under Auto. A production deploy also asks at every other level, through the
  // shared deploy classifier, so it can never pass on a saved rule.
  'vercel',
  'netlify',
  'eas',
  'firebase',
  'wrangler',
  'flyctl',
  'fly',
  'heroku',
  'railway',
  'serverless',
  'sls',
  'amplify',
  'supabase',
])
const PUBLISH_VERBS = new Set([
  'publish',
  'unpublish',
  'deprecate',
  'dist-tag',
  'owner',
  'access',
  'yank',
  'push',
  'upload',
])

function packageManager(words: string[]): string | undefined {
  return ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'cargo', 'twine', 'docker', 'gem', 'pip', 'pip3', 'uv'].includes(
    words[0] ?? '',
  )
    ? words[0]
    : undefined
}

function riskOf(words: string[]): Risk[] {
  const [exe = '', ...rest] = words
  const risks = new Set<Risk>()
  const name = exe.replace(/^.*\//, '')
  if (exe.includes('/')) risks.add('shell-review')
  if (
    words.some(
      (word) => UNSAFE_FLAGS.has(word) || DANGEROUS_OPTION.test(word) || /^--(?:insecure|no-sandbox)=/.test(word),
    )
  )
    risks.add('unsafe-flags')
  if (
    /^(?:ba|z|da|k|c|tc|fi)?sh$|^(?:env|eval|exec|command|builtin|xargs|nohup|time|timeout|watch|nice|ionice|script|osascript|source)$|^\.$/.test(
      name,
    )
  )
    risks.add('shell-review')
  if (PRIVILEGED.has(name)) risks.add('privileged')
  if (DESTRUCTIVE.has(name) || /^mkfs\./.test(name)) risks.add('destructive-files')
  if (PROCESS.has(name)) risks.add('process')
  if (TUNNEL.has(name) || (name === 'ssh' && rest.some((word) => /^-[A-Za-z]*[RLD]/.test(word)))) risks.add('tunnel')
  if (CREDENTIAL_TOOLS.has(name)) risks.add('credentials')
  if (rest.some(sensitive)) risks.add('credentials')
  if (name === 'gh' && /^(?:auth|secret|ssh-key|gpg-key)$/.test(rest[0] ?? '')) risks.add('credentials')
  if (
    ['aws', 'gcloud', 'az'].includes(name) &&
    /^(?:configure|auth|login|sso|iam|kms|secretsmanager)$/.test(rest[0] ?? '')
  )
    risks.add('credentials')
  if (/^(?:login|logout|adduser|token)$/.test(rest.find((word) => !word.startsWith('-')) ?? '') && name !== 'gh')
    risks.add('credentials')
  if (name === 'kubectl' && rest[0] === 'config') risks.add('credentials')
  if (name === 'find' && rest.some((word) => /^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/.test(word)))
    risks.add('destructive-files')
  if (CLOUD.has(name)) risks.add('publish')
  if (name === 'git') {
    const git = [...rest]
    while (['--no-pager', '--no-optional-locks'].includes(git[0] ?? '')) git.shift()
    const verb = git[0] ?? ''
    const args = git.slice(1)
    if (verb.startsWith('-'))
      risks.add('destructive-git') // -c, -C, --git-dir, --work-tree, --exec-path
    else if (verb === 'push') risks.add('publish')
    else if (/^(?:reset|clean|rebase|filter-branch|filter-repo|prune|gc|update-ref|lfs)$/.test(verb))
      risks.add('destructive-git')
    else if (
      verb === 'restore' &&
      !(args.some((word) => /^(?:--staged|-S)$/.test(word)) && !args.some((word) => /^(?:--worktree|-W)$/.test(word)))
    )
      risks.add('destructive-git')
    else if (
      verb === 'checkout' &&
      args.some((word) => /^(?:--|\.|-f|--force|-B|--ours|--theirs|-p|--patch)$/.test(word))
    )
      risks.add('destructive-git')
    else if (verb === 'stash' && /^(?:drop|clear)$/.test(args[0] ?? '')) risks.add('destructive-git')
    else if (verb === 'branch' && args.some((word) => /^(?:-[dDmMcCf]+|--delete|--move|--copy|--force)$/.test(word)))
      risks.add('destructive-git')
    else if (verb === 'commit' && args.some((word) => /^(?:--amend|--no-gpg-sign|-n)$/.test(word)))
      risks.add('destructive-git')
    else if (verb === 'remote' && /^(?:add|set-url|remove|rm|rename|set-head|prune)$/.test(args[0] ?? ''))
      risks.add('destructive-git')
    else if (verb === 'config' && !args.some((word) => /^(?:--get|--get-all|--list|-l|--get-regexp)$/.test(word)))
      risks.add('destructive-git')
    else if (verb === 'reflog' && /^(?:expire|delete)$/.test(args[0] ?? '')) risks.add('destructive-git')
    else if (verb === 'worktree' && /^(?:remove|prune)$/.test(args[0] ?? '')) risks.add('destructive-git')
    else if (verb === 'tag' && args.some((word) => /^(?:-d|--delete|-f|--force)$/.test(word)))
      risks.add('destructive-git')
    else if (verb === 'fetch' && args.some((word) => /^--(?:upload-pack|receive-pack)/.test(word)))
      risks.add('destructive-git')
  }
  if (name === 'gh') {
    const [area = '', action = ''] = rest
    const read = /^(?:view|list|status|checks|diff|download-info)$/.test(action) && !rest.includes('--web')
    if (
      !(read && /^(?:pr|issue|run|repo|release|workflow|label|gist|search|cache)$/.test(area)) &&
      !/^(?:--version|version|help|auth|secret|ssh-key|gpg-key)$/.test(area) &&
      !(area === 'api' && !rest.some((word) => /^(?:-X|--method|-f|-F|--field|--raw-field|--input)/.test(word)))
    )
      risks.add('publish')
  }
  const manager = packageManager(words)
  const firstArg = rest.find((word) => !word.startsWith('-'))
  if (manager && manager !== 'pip' && manager !== 'pip3' && manager !== 'uv' && PUBLISH_VERBS.has(firstArg ?? ''))
    risks.add('publish')
  return [...risks]
}

const READ_COMMANDS = new Set([
  'pwd',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'echo',
  'date',
  'uname',
  'whoami',
  'id',
  'hostname',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'sort',
  'uniq',
  'cut',
  'tr',
  'diff',
  'cmp',
  'comm',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'fd',
  'jq',
  'column',
  'nl',
  'rev',
  'find',
  'which',
  'type',
  'cd',
  'true',
  'false',
  'test',
  'sleep',
  'sha256sum',
  'shasum',
  'md5sum',
  'md5',
  'cksum',
  'strings',
  'xxd',
  'od',
  'hexdump',
])
/** Options that make an otherwise read-only tool run something or write somewhere. */
const READ_DENIED: Record<string, RegExp> = {
  rg: /^--(?:pre|pre-glob|hostname-bin)(?:=|$)/,
  fd: /^(?:-x|-X|--exec|--exec-batch)$/,
  sort: /^(?:-o|--output)(?:=|$)/,
  date: /^(?:-s|--set)(?:=|$)/,
  jq: /^--(?:rawfile|slurpfile|from-file)$/,
}

/** `anywhere` also accepts paths outside the workspace, for sessions that may read but never write. */
function isRead(words: string[], anywhere = false): boolean {
  const [exe = '', ...rest] = words
  if (!READ_COMMANDS.has(exe)) return false
  if ((!anywhere && !safeWords(rest)) || rest.some(sensitive)) return false
  const denied = READ_DENIED[exe]
  if (denied && rest.some((word) => denied.test(word))) return false
  if (exe === 'uniq' && positional(rest).length > 1) return false
  if (exe === 'tree' && rest.includes('-o')) return false
  return true
}

const GIT_READ_FLAGS: Record<string, RegExp> = {
  diff: /^(?:--(?:stat|numstat|shortstat|name-only|name-status|summary|check|cached|staged|no-renames|binary|relative)|-U\d+|--unified=\d+)$/,
  status:
    /^(?:--(?:short|branch|porcelain(?:=v?[12])?|untracked-files(?:=(?:no|normal|all))?|ignored|no-renames)|-[sb]{1,2})$/,
  log: /^(?:--(?:oneline|stat|name-only|name-status|no-patch|patch|all|no-decorate|decorate|pretty=oneline|max-count=\d+|graph|abbrev-commit|first-parent|merges|no-merges)|-[pn]|-n\d+)$/,
  show: /^(?:--(?:oneline|stat|name-only|name-status|no-patch|patch|pretty=oneline)|-p)$/,
  blame: /^(?:-[Lwlsen]|-L\d+(?:,\d+)?|--(?:line-porcelain|porcelain|show-email|show-name))$/,
  grep: /^(?:-[nilwcvEFaHhq]+|-e|--(?:line-number|ignore-case|word-regexp|count|files-with-matches|fixed-strings|extended-regexp|no-color|heading|break))$/,
  describe: /^--(?:tags|always|abbrev=\d+|long|exact-match|dirty)$/,
  'rev-parse':
    /^--(?:short|abbrev-ref|show-toplevel|is-inside-work-tree|git-dir|verify|symbolic-full-name|show-prefix)(?:=\d+)?$/,
  'ls-files': /^--(?:cached|deleted|modified|others|ignored|exclude-standard|stage|full-name)$|^-[cdmosz]$/,
  'ls-tree': /^(?:-r|-d|-t|-l|--name-only|--name-status|--full-name|--long)$/,
  'cat-file': /^-[pts]$|^--(?:batch|batch-check)$/,
  shortlog: /^(?:-[sne]|--(?:summary|numbered|email))$/,
  'rev-list': /^--(?:count|max-count=\d+|oneline|all|first-parent|no-merges|merges|left-right)$|^-n\d*$/,
  'merge-base': /^--(?:is-ancestor|fork-point)$/,
  'show-ref': /^--(?:heads|tags|verify|hash|abbrev(?:=\d+)?)$/,
  'for-each-ref': /^--(?:format=[\w%()=:, .-]+|count=\d+|sort=[\w:-]+|merged|no-merged|contains)$/,
  'ls-remote': /^--(?:heads|tags|refs|get-url)$/,
}
const GIT_NO_ARG_FLAGS = new Set([
  '--no-pager',
  '--no-optional-locks',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--color=never',
])

function gitSplit(words: string[]) {
  const git = words.slice(1)
  while (['--no-pager', '--no-optional-locks'].includes(git[0] ?? '')) git.shift()
  return { verb: git[0] ?? '', args: git.slice(1) }
}

/** Remaining arguments after a verb: known flags, anything after `--`, and workspace-relative names. */
function gitArgsOk(verb: string, args: string[]): boolean {
  let paths = false
  const pattern = GIT_READ_FLAGS[verb]
  for (const word of args) {
    if (word === '--') {
      paths = true
      continue
    }
    if (!paths && word.startsWith('-')) {
      if (GIT_NO_ARG_FLAGS.has(word) || pattern?.test(word)) continue
      return false
    }
    if (outsidePath(word) || sensitive(word)) return false
  }
  return true
}

function isGitRead(words: string[]): boolean {
  if (words[0] !== 'git') return false
  const { verb, args } = gitSplit(words)
  if (GIT_READ_FLAGS[verb])
    return gitArgsOk(verb, args) && !(verb === 'grep' && args.some((word) => /^-O|--open-files-in-pager/.test(word)))
  if (verb === 'branch')
    return args.every((word) =>
      /^(?:-[alrvVq]+|--(?:list|all|remotes|show-current|verbose|merged|no-merged|contains|sort=[\w:-]+))$/.test(word),
    )
  if (verb === 'remote')
    return (
      args.length === 0 ||
      args.join(' ') === '-v' ||
      (args[0] === 'show' && safeWords(args)) ||
      args.join(' ') === 'get-url origin'
    )
  if (verb === 'config')
    return (
      args.some((word) => /^(?:--get|--get-all|--list|-l|--get-regexp)$/.test(word)) &&
      args.every((word) => !outsidePath(word))
    )
  if (verb === 'stash')
    return (
      /^(?:list|show)$/.test(args[0] ?? '') &&
      args.slice(1).every((word) => /^(?:-p|--stat|stash@\{\d+\})$/.test(word) || /^stash@/.test(word))
    )
  if (verb === 'tag')
    return (
      args.length === 0 || args.every((word) => /^(?:-l|--list|-n\d*|--sort=[\w:-]+|--contains|--merged)$/.test(word))
    )
  if (verb === 'worktree') return args[0] === 'list'
  if (verb === 'reflog') return args.length === 0 || (args[0] === 'show' && safeWords(args))
  if (verb === 'fetch')
    return args.every(
      (word) => /^(?:--all|--prune|--tags|-p|-q|--quiet|origin|[\w./-]+)$/.test(word) && !outsidePath(word),
    )
  return false
}

function isGitLocal(words: string[]): boolean {
  if (words[0] !== 'git') return false
  const { verb, args } = gitSplit(words)
  const names = (items: string[]) =>
    items.every((word) => word === '--' || word === '.' || (!outsidePath(word) && !sensitive(word)))
  if (verb === 'add')
    return args.every(
      (word) =>
        /^(?:-A|--all|-u|--update|-N|--intent-to-add|-v|--verbose|--)$/.test(word) ||
        (!word.startsWith('-') && names([word])),
    )
  if (verb === 'commit') {
    for (let i = 0; i < args.length; i++) {
      const word = args[i]!
      if (word === '-m' || word === '--message') {
        if (++i >= args.length) return false
      } else if (/^-[am]+$/.test(word) && word.includes('m')) {
        if (!word.endsWith('m') || ++i >= args.length) return false
      } else if (!/^(?:-a|--all|-s|--signoff|-q|--quiet|--allow-empty|--no-edit|-v|--verbose)$/.test(word)) return false
    }
    return args.length > 0
  }
  if (verb === 'switch')
    return (
      args.length > 0 &&
      args.every((word) => /^(?:-c|--create|--detach)$/.test(word) || (!word.startsWith('-') && names([word])))
    )
  if (verb === 'checkout')
    return args[0] === '-b' && args.length >= 2 && args.slice(1).every((word) => !word.startsWith('-') && names([word]))
  if (verb === 'stash')
    return (
      args.length === 0 ||
      (/^(?:push|save|pop|apply)$/.test(args[0] ?? '') &&
        args
          .slice(1)
          .every(
            (word) =>
              /^(?:-u|--include-untracked|-k|--keep-index|-m|--message|-q|--quiet|stash@\{\d+\})$/.test(word) ||
              !word.startsWith('-'),
          ))
    )
  if (verb === 'restore')
    return (
      args.some((word) => /^(?:--staged|-S)$/.test(word)) &&
      args.every((word) => /^(?:--staged|-S|--)$/.test(word) || names([word]))
    )
  return false
}

function isWorkspaceFiles(words: string[]): boolean {
  const [exe = '', ...rest] = words
  if (!['mkdir', 'touch', 'cp', 'mv'].includes(exe)) return false
  if (!safeWords(rest) || rest.some(sensitive)) return false
  const flags = flagsOf(rest)
  const names = positional(rest)
  if (exe === 'mkdir')
    return flags.every((flag) => /^-(?:p|v)+$|^--(?:parents|verbose)$/.test(flag)) && names.length > 0
  if (exe === 'touch') return flags.length === 0 && names.length > 0
  return (
    flags.every((flag) => /^-(?:r|R|a|p|n|v)+$|^--(?:recursive|preserve|no-clobber|verbose)$/.test(flag)) &&
    names.length >= 2
  )
}

const CHECK_SCRIPT =
  /^(?:test|tests|lint|typecheck|type-check|tsc|check|build|knip|verify|coverage|format:check|fmt:check|prettier:check)(?::[\w-]+)?$/
const FILTER_FLAGS = new Set([
  '-r',
  '--recursive',
  '--if-present',
  '--silent',
  '-s',
  '--no-color',
  '--frozen-lockfile',
  '--immutable',
])
/** Tools that only check, format or test the workspace. A few have subcommands that do more, so they are listed. */
const TOOL_ARGS: Record<string, (args: string[]) => boolean> = {
  vitest: () => true,
  jest: () => true,
  tsc: () => true,
  eslint: () => true,
  prettier: () => true,
  knip: () => true,
  biome: (args) => /^(?:check|lint|format|ci)$/.test(args[0] ?? ''),
  oxlint: () => true,
  stylelint: () => true,
  playwright: (args) => args[0] === 'test',
  turbo: (args) => args[0] === 'run' && CHECK_SCRIPT.test(args[1] ?? ''),
  nx: (args) =>
    /^(?:run-many|affected)$/.test(args[0] ?? '') &&
    args.some((word) => /^--target=(?:test|lint|build|typecheck)$/.test(word)),
  vite: (args) => args[0] === 'build',
  next: (args) => /^(?:build|lint)$/.test(args[0] ?? ''),
  ruff: (args) => /^(?:check|format)$/.test(args[0] ?? ''),
  mypy: () => true,
  pyright: () => true,
  pytest: () => true,
  black: () => true,
  flake8: () => true,
  rubocop: () => true,
  rspec: () => true,
  phpunit: () => true,
}
/** Arguments to a check are plain words: the parser already rules out expansion, so only paths and flags matter. */
const argsOk = (args: string[]) =>
  args.every((word) => !outsidePath(word) && !sensitive(word) && !UNSAFE_FLAGS.has(word))
const toolOk = (tool: string, args: string[]) => !!TOOL_ARGS[tool]?.(args) && argsOk(args)

function isProjectCheck(words: string[]): boolean {
  const [exe = '', ...rest] = words
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(exe)) {
    const args = [...rest]
    // pnpm -r / --filter <name> before the command.
    while (args.length) {
      const word = args[0]!
      if (FILTER_FLAGS.has(word)) args.shift()
      else if (
        (word === '--filter' || word === '-F' || word === '--workspace' || word === '-w') &&
        args[1] &&
        !args[1].startsWith('-')
      )
        args.splice(0, 2)
      else if (/^--(?:filter|workspace-concurrency)=/.test(word)) args.shift()
      else break
    }
    const verb = args.shift() ?? ''
    if (/^(?:install|i|ci)$/.test(verb))
      return args.every((word) =>
        /^--(?:frozen-lockfile|immutable|offline|prefer-offline|ignore-scripts|silent)$/.test(word),
      )
    if (verb === 'run' || verb === 'run-script') return CHECK_SCRIPT.test(args.shift() ?? '') && argsOk(args)
    if (CHECK_SCRIPT.test(verb)) return argsOk(args)
    if (verb === 'exec' || verb === 'x') return toolOk(args[0] ?? '', args.slice(1)) && !args.includes('--yes')
    return false
  }
  if (exe === 'npx' || exe === 'bunx') {
    const args = rest.filter((word) => word !== '--no-install' && word !== '--offline')
    return toolOk(args[0] ?? '', args.slice(1))
  }
  if (TOOL_ARGS[exe]) return toolOk(exe, rest)
  if (exe === 'python' || exe === 'python3')
    return (
      rest[0] === '-m' &&
      /^(?:pytest|unittest|mypy|ruff|black|flake8|compileall)$/.test(rest[1] ?? '') &&
      argsOk(rest.slice(2))
    )
  if (exe === 'cargo')
    return /^(?:test|check|build|clippy|fmt|doc|bench|metadata|tree)$/.test(rest[0] ?? '') && argsOk(rest.slice(1))
  if (exe === 'go')
    return /^(?:test|build|vet|fmt|list)$/.test(rest[0] ?? '') ||
      (rest[0] === 'mod' && /^(?:tidy|verify|graph|why)$/.test(rest[1] ?? ''))
      ? argsOk(rest.slice(1))
      : false
  if (exe === 'swift' || exe === 'dotnet') return /^(?:test|build)$/.test(rest[0] ?? '') && argsOk(rest.slice(1))
  if (exe === 'make') return /^(?:test|check|lint|build|all)$/.test(rest[0] ?? '') && argsOk(rest.slice(1))
  return false
}

function isVersion(words: string[]): boolean {
  return words.length === 2 && /^[a-z][\w.-]*$/.test(words[0]!) && /^(?:--version|-V|-v|version)$/.test(words[1]!)
}

function allowOf(words: string[]): Allow | undefined {
  if (isVersion(words)) return 'version'
  if (isRead(words)) return 'read'
  if (isGitRead(words)) return 'git-read'
  if (isGitLocal(words)) return 'git-local'
  if (isWorkspaceFiles(words)) return 'workspace-files'
  if (isProjectCheck(words)) return 'project-checks'
  return undefined
}

export type AutoVerdict = { risks: Risk[]; allow?: Allow }

/** What Auto makes of a command line: the risk families it touches, and the routine category if all of it is routine. */
export function judgeCommand(command: string): AutoVerdict {
  const segments = parseCommand(command.trim())
  if (!segments) return { risks: ['shell-review'] }
  const risks = new Set<Risk>()
  for (const words of segments) {
    for (const risk of riskOf(words)) risks.add(risk)
    // Inline interpreter code (`node -e`, `python -c`) cannot be read from here.
    if (
      WRAPPERS.has(words[0] ?? '') &&
      !isProjectCheck(words) &&
      !isVersion(words) &&
      !isRead(words) &&
      words.slice(1).some((word) => INLINE_FLAG.test(word))
    )
      risks.add('shell-review')
  }
  if (risks.size) return { risks: [...risks] }
  const allowed = segments.map(allowOf)
  return { risks: [], allow: allowed.every(Boolean) ? allowed[0] : undefined }
}

/** True for a plain, single, routine Git read such as `git diff --stat`; kept for callers that want only that. */
export function isRoutineGitRead(command: string): boolean {
  const segments = parseCommand(command.trim())
  return !!segments && segments.length === 1 && isGitRead(segments[0]!) && riskOf(segments[0]!).length === 0
}

/**
 * Whether a command line only reads, for a session that may never write (a Review teammate). Wider than Auto's
 * routine reads, since a refusal here cannot be approved: any path, and any Git read verb with options that cannot
 * write or run a program. Shell syntax this file cannot read, wrappers and risky options still count as writing.
 */
export function readsOnly(command: string): boolean {
  const segments = parseCommand(command.trim())
  return (
    !!segments &&
    segments.every((words) => {
      if (riskOf(words).length) return false
      if (isRead(words, true) || isVersion(words) || isGitRead(words)) return true
      if (words[0] !== 'git') return false
      const { verb, args } = gitSplit(words)
      return verb in GIT_READ_FLAGS && !args.some((word) => DANGEROUS_OPTION.test(word) || sensitive(word))
    })
  )
}

export function matchesAutoCommandRule(id: string, command: string): boolean {
  const verdict = judgeCommand(command)
  if (verdict.risks.length) return verdict.risks.includes(id as Risk)
  return verdict.allow === id
}

export const AUTO_COMMAND_DEFAULTS = [
  {
    id: 'read',
    label: 'Read-only commands in the workspace: ls, cat, grep, find, jq, pwd…',
    behavior: 'allow' as const,
  },
  {
    id: 'git-read',
    label: 'Git reads: status, diff, log, show, branch list, blame, fetch…',
    behavior: 'allow' as const,
  },
  {
    id: 'git-local',
    label: 'Local Git changes: add, commit, switch, stash, restore --staged',
    behavior: 'allow' as const,
  },
  { id: 'workspace-files', label: 'Create, copy and move files inside the workspace', behavior: 'allow' as const },
  {
    id: 'project-checks',
    label: 'Tests, linters, type checks, builds and lockfile installs',
    behavior: 'allow' as const,
  },
  { id: 'version', label: 'Version checks', behavior: 'allow' as const },
  {
    id: 'shell-review',
    label: 'Compound shell syntax, expansion, wrappers and inline scripts',
    behavior: 'ask' as const,
  },
  { id: 'destructive-files', label: 'Deleting or overwriting files (rm, find -delete, dd…)', behavior: 'ask' as const },
  {
    id: 'destructive-git',
    label: 'Git operations that discard work or rewrite history, and Git config changes',
    behavior: 'ask' as const,
  },
  { id: 'credentials', label: 'Credentials, secrets and key stores', behavior: 'ask' as const },
  {
    id: 'privileged',
    label: 'Privilege, permission and system changes (sudo, chmod, launchctl…)',
    behavior: 'ask' as const,
  },
  { id: 'process', label: 'Stopping processes or the machine', behavior: 'ask' as const },
  { id: 'tunnel', label: 'Tunnels, raw sockets and port forwarding', behavior: 'ask' as const },
  {
    id: 'unsafe-flags',
    label: 'Options that turn off a safety check or make a read command write (--insecure, --no-verify, --output…)',
    behavior: 'ask' as const,
  },
  {
    id: 'publish',
    label: 'Pushing, publishing, deploying and infrastructure or cloud changes',
    behavior: 'ask' as const,
  },
]
