// Recognises a deploy from the action itself, however an agent performs it: a command line in its shell, the argument
// list of a CLI Ramu runs, or an MCP tool call. Ramu applies one rule to every path: a preview runs like any other
// command, while production asks each time (or once per thread) and the project's migrations run first. The parse is
// loose on purpose; a false alarm costs one approval, a miss lets production change without one.

export type DeployKind = 'preview' | 'production'

const SHELL = /^(?:ba|z|da|k|c|tc|fi)?sh$/
const WRAPPERS = new Set([
  'env',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'nice',
  'caffeinate',
  'timeout',
  'sudo',
])
const RUNNERS = new Set(['npx', 'bunx', 'pnpx'])
const PACKAGE_MANAGERS = new Set(['pnpm', 'yarn', 'npm', 'bun'])
/** Package-manager options that take a value, so the value is not mistaken for the command. */
const MANAGER_VALUES = new Set(['-C', '--dir', '--filter', '-F', '--cwd', '-w', '--workspace', '-p', '--package'])
/** Published package names that install a CLI under another name. */
const PACKAGES: Record<string, string> = {
  'netlify-cli': 'netlify',
  ntl: 'netlify',
  '@railway/cli': 'railway',
  flyctl: 'fly',
  'firebase-tools': 'firebase',
}

/** Splits a shell line into the words of each command, looking through quotes, chains, pipes and subshells. */
function segments(line: string): string[][] {
  const out: string[][] = []
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
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1)
      word += end < 0 ? line.slice(i + 1) : line.slice(i + 1, end)
      inWord = true
      i = end < 0 ? line.length : end
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i]
      inWord = true
    } else if (c === '>' || c === '<') {
      // A redirect: its file descriptor and its target are not arguments of the command.
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else endWord()
      let next = i + 1
      if (line[next] === '>' || line[next] === '&') next++
      while (/\s/.test(line[next] ?? '')) next++
      while (next < line.length && !/[\s;&|()<>`]/.test(line[next]!)) next++
      i = next - 1
    } else if (/[;&|\n\r()`]/.test(c)) endSegment()
    else if (/\s/.test(c)) endWord()
    else {
      word += c
      inWord = true
    }
  }
  endSegment()
  return out
}

const baseName = (word: string) => word.slice(word.lastIndexOf('/') + 1)
/** The CLI a word runs: `/usr/local/bin/vercel`, `wrangler@4` and `@railway/cli@latest` lose their path and version. */
const cliName = (word: string) =>
  word.startsWith('@') ? word.replace(/(?<=.)@[^/]*$/, '') : baseName(word).replace(/(?<=.)@.*$/, '')
const isFlag = (word: string) => word.startsWith('-')

/** The CLI and its arguments once environment assignments, wrappers and package runners are set aside. */
function unwrap(words: readonly string[]): string[] | null {
  let rest = [...words]
  for (let guard = 0; guard < 8 && rest.length; guard++) {
    const head = rest[0]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head) || WRAPPERS.has(baseName(head))) {
      rest = rest.slice(1)
      // Options, assignments and a duration (`timeout 60`) come before the command a wrapper runs.
      while (rest[0] && (isFlag(rest[0]) || /^[A-Za-z_][A-Za-z0-9_]*=|^\d+[smhd]?$/.test(rest[0]))) rest = rest.slice(1)
      continue
    }
    if (RUNNERS.has(baseName(head))) {
      rest = skipOptions(rest.slice(1))
      continue
    }
    if (PACKAGE_MANAGERS.has(baseName(head))) {
      rest = skipOptions(rest.slice(1))
      if (rest[0] && ['dlx', 'exec', 'x'].includes(rest[0])) rest = skipOptions(rest.slice(1))
      continue
    }
    return rest
  }
  return rest.length ? rest : null
}

function skipOptions(words: string[]): string[] {
  let index = 0
  while (index < words.length && isFlag(words[index]!)) {
    const flag = words[index]!
    index += MANAGER_VALUES.has(flag) && !flag.includes('=') ? 2 : 1
    if (flag === '--') break
  }
  return words.slice(index)
}

/** Positional words, skipping the values of the options listed. */
function positionals(args: readonly string[], valued: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!isFlag(arg)) out.push(arg)
    else if (valued.has(arg)) index++
  }
  return out
}

/** The value of `--name value` or `--name=value`, or true for a bare `--name`. */
function option(args: readonly string[], ...names: string[]): string | true | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    for (const name of names) {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
      if (arg === name) {
        const next = args[index + 1]
        return next !== undefined && !isFlag(next) ? next : true
      }
    }
  }
  return null
}

const VERCEL_VALUES = new Set([
  '--scope',
  '-S',
  '--token',
  '-t',
  '--cwd',
  '--team',
  '-T',
  '--local-config',
  '-A',
  '--global-config',
  '-Q',
  '--target',
  '--env',
  '-e',
  '--build-env',
  '-b',
  '--meta',
  '-m',
  '--regions',
  '--archive',
])

function vercel(args: readonly string[]): DeployKind | null {
  const [command] = positionals(args, VERCEL_VALUES)
  if (command === 'promote' || command === 'rollback') return 'production'
  const target = option(args, '--target')
  const production = args.some((arg) => arg === '--prod' || arg === '--prod=true') || target === 'production'
  if (command === 'redeploy') return target && target !== 'production' ? 'preview' : 'production'
  // A bare `vercel`, or `vercel <folder>`, deploys like `vercel deploy`.
  const deploys = command === undefined || command === 'deploy' || /^[.~/]|\//.test(command)
  return deploys ? (production ? 'production' : 'preview') : null
}

function netlify(args: readonly string[]): DeployKind | null {
  const [command, operation] = positionals(args)
  if (command === 'api' && /^(?:restoreSiteDeploy|rollbackSiteDeploy|unlockDeploy)$/.test(operation ?? ''))
    return 'production'
  if (command !== 'deploy') return null
  const production = args.some((arg) => /^--(?:prod|prodIfUnlocked|prod-if-unlocked)(?:=true)?$/.test(arg))
  return production ? 'production' : 'preview'
}

function wrangler(args: readonly string[]): DeployKind | null {
  const [command, sub] = positionals(args, new Set(['--config', '-c', '--env', '-e', '--name', '--branch']))
  if (command === 'deploy' || command === 'publish' || command === 'rollback') return 'production'
  if (command === 'triggers' && sub === 'deploy') return 'production'
  if (command === 'versions') return sub === 'deploy' ? 'production' : sub === 'upload' ? 'preview' : null
  if (command === 'pages' && (sub === 'deploy' || sub === 'publish'))
    return option(args, '--branch') ? 'preview' : 'production'
  return null
}

function railway(args: readonly string[]): DeployKind | null {
  const [command] = positionals(args, new Set(['--service', '-s', '--environment', '-e']))
  return command && ['up', 'redeploy', 'down', 'deploy'].includes(command) ? 'production' : null
}

function fly(args: readonly string[]): DeployKind | null {
  const [command, sub] = positionals(args, new Set(['--app', '-a', '--config', '-c']))
  if (command === 'deploy') return 'production'
  return (command === 'releases' || command === 'apps') && sub === 'rollback' ? 'production' : null
}

function supabase(args: readonly string[]): DeployKind | null {
  const [command, sub] = positionals(args, new Set(['--project-ref', '--workdir', '--db-url']))
  return (command === 'functions' && sub === 'deploy') || (command === 'db' && sub === 'push') ? 'production' : null
}

function firebase(args: readonly string[]): DeployKind | null {
  const [command] = positionals(args, new Set(['--project', '-P', '--only', '--config', '-c']))
  if (command === 'hosting:channel:deploy') return 'preview'
  return command === 'deploy' || command === 'hosting:clone' ? 'production' : null
}

function gcloud(args: readonly string[]): DeployKind | null {
  const words = positionals(args, new Set(['--project', '--region', '--account', '--configuration'])).filter(
    (word) => word !== 'beta' && word !== 'alpha',
  )
  const [group, command] = words
  return (group === 'run' || group === 'app' || group === 'functions') && command === 'deploy' ? 'production' : null
}

const CLIS: Record<string, (args: readonly string[]) => DeployKind | null> = {
  vercel,
  netlify,
  wrangler,
  railway,
  fly,
  supabase,
  firebase,
  gcloud,
}

const stronger = (a: DeployKind | null, b: DeployKind | null): DeployKind | null =>
  a === 'production' || b === 'production' ? 'production' : (a ?? b)

function argvKind(argv: readonly string[], depth: number): DeployKind | null {
  const words = unwrap(argv)
  if (!words?.length) return null
  const [head, ...args] = words
  const name = cliName(head!)
  // `bash -c 'vercel --prod'` runs the line it is given.
  if (SHELL.test(name) && depth < 3) {
    const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    const line = script >= 0 ? args[script + 1] : undefined
    return line ? lineKind(line, depth + 1) : null
  }
  const cli = CLIS[PACKAGES[name] ?? name]
  if (!cli || args.some((arg) => /^(?:--help|-h|--version|-v|-V)$/.test(arg))) return null
  return cli(args)
}

function lineKind(line: string, depth: number): DeployKind | null {
  if (typeof line !== 'string' || !line.trim() || line.length > 20_000) return null
  return segments(line).reduce<DeployKind | null>((kind, words) => stronger(kind, argvKind(words, depth)), null)
}

/** Whether a CLI's argument list deploys, such as `['vercel', 'deploy', '--prod']`. */
export const argvDeploy = (argv: readonly string[]): DeployKind | null => argvKind(argv, 0)

/** Whether a shell command line deploys; any production command in a chain makes the whole line production. */
export const commandDeploy = (line: string): DeployKind | null => lineKind(line, 0)

const DEPLOY_VERBS = new Set(['deploy', 'redeploy', 'rollback', 'promote', 'publish', 'release'])
/** Words that make a tool about deploys only read about them, such as `list_deployments` or `get_release`. */
const READ_VERBS = new Set(['get', 'list', 'read', 'search', 'fetch', 'describe', 'show', 'status', 'logs', 'log'])
const PREVIEW = /^(?:preview|staging|stage|development|dev|draft|test|testing|qa|sandbox|branch)$/i
const TARGET_FIELD = /^(?:target|environment|env|stage|deploy_?target|deployment_?target|channel)$/i

/** A tool name's words: `deployToVercel`, `deploy_to_vercel` and `netlify-deploy` all contain `deploy`. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Whether the arguments name a non-production target, at the top level or one level down. */
function namesPreview(args: Record<string, unknown>, depth = 0): boolean {
  for (const [key, value] of Object.entries(args)) {
    if (TARGET_FIELD.test(key) && typeof value === 'string' && PREVIEW.test(value.trim())) return true
    if (/^(?:production|prod|is_?production)$/i.test(key) && value === false) return true
    if (/^draft$/i.test(key) && value === true) return true
    if (depth === 0 && value && typeof value === 'object' && !Array.isArray(value))
      if (namesPreview(value as Record<string, unknown>, 1)) return true
  }
  return false
}

/**
 * Whether an MCP tool call deploys: its name says deploy, redeploy, rollback, promote, publish or release, and it is
 * not marked read-only. It is production unless its arguments name a preview, staging or development target.
 */
export function toolDeploy(
  tool: { name: string; annotations?: { readOnlyHint?: boolean } | undefined },
  args: Record<string, unknown>,
): DeployKind | null {
  if (tool.annotations?.readOnlyHint === true) return null
  const words = nameWords(tool.name)
  const deploys =
    words.some((word) => DEPLOY_VERBS.has(word)) ||
    (words.includes('deployment') && words.some((word) => ['create', 'trigger', 'start', 'new'].includes(word)))
  if (!deploys || words.some((word) => READ_VERBS.has(word))) return null
  return namesPreview(args) ? 'preview' : 'production'
}
