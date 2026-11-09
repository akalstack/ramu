import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { parse, stringify } from 'yaml'
import { ruleWritesClaudeFile } from '@ramu/shared/rules'
import type { Rule, RuleFileStatus, RuleFileTarget } from '@ramu/shared/types'

/** What the sync reads: the saved rules, every project's repository roots and Claude's config home. */
export interface RuleFilesHost {
  rules(): Rule[]
  repositories(): { projectId: string; root: string }[]
  claudeHome(): string
  /** The identity a project acts as, for rules limited to one. */
  identityOf?(projectId: string): string | null
}

const MANAGED_NAME = /^ramu-[a-z0-9-]+\.md$/
const MARKER = 'ramu-rule'

const slug = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'rule'

/** The rules file Claude Code reads: `paths:` frontmatter with Ramu's marker, then the rule. */
function ruleFileText(rule: Rule): string {
  const frontmatter = stringify({ paths: rule.paths, [MARKER]: rule.id })
  return `---\n# Written by Ramu from Settings → Agent setup → Rules. Edit the rule there; changes here are replaced.\n${frontmatter}---\n\n# ${rule.name}\n\n${rule.body}\n`
}

/** The rule id in a file Ramu wrote, or null for anyone else's file. */
function managedId(path: string): string | null {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size > 64 * 1024) return null
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf8'))
  if (!match) return null
  try {
    const value = (parse(match[1]!, { maxAliasCount: 0 }) as Record<string, unknown> | null)?.[MARKER]
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

const within = (root: string, target: string) => {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/**
 * Resolves `base/segments…`, creating missing folders below `base` one at a time when asked, and refuses a folder that
 * a symbolic link carries outside `base`. Returns null when the folder does not exist and was not to be created.
 */
function safeFolder(base: string, segments: string[], create: boolean): string | null {
  if (!lstatSync(base, { throwIfNoEntry: false })) {
    if (create) throw new Error(`${base} was not found.`)
    return null
  }
  const realBase = realpathSync(base)
  let dir = realBase
  for (const segment of segments) {
    const next = join(dir, segment)
    if (!lstatSync(next, { throwIfNoEntry: false })) {
      if (!create) return null
      mkdirSync(next)
    }
    dir = realpathSync(next)
    if (!within(realBase, dir)) throw new Error(`${next} leads outside ${base}; Ramu does not write through it.`)
  }
  return dir
}

function writeAtomically(path: string, dir: string, text: string) {
  const temp = join(dir, `.ramu-${randomUUID()}.tmp`)
  try {
    writeFileSync(temp, text, { flag: 'wx', mode: 0o644 })
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Keeps Claude Code's copies of path rules in step with the saved rules: a project rule as `.claude/rules/ramu-<slug>.md`
 * in each of the project's repositories, a host-wide rule as `ramu-<slug>.md` in Claude's own rules folder. Only files
 * named `ramu-*.md` whose frontmatter carries Ramu's marker are ever rewritten or removed, so the person's own rules files
 * are never touched. The sync is idempotent; a folder it cannot write is reported on the rule, never thrown.
 */
export class RuleFiles {
  private last: RuleFileStatus[] = []

  constructor(
    private readonly host: RuleFilesHost,
    private readonly home = homedir(),
  ) {}

  /** Where the last sync wrote each Claude path rule, with any problem. */
  status(): RuleFileStatus[] {
    return this.last
  }

  /** Writes and removes Ramu's rules files. `alsoClean` names repository roots that just left Ramu, to remove its files there. */
  sync(alsoClean: readonly string[] = []): RuleFileStatus[] {
    const rules = this.host
      .rules()
      .filter(ruleWritesClaudeFile)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    const repositories = this.host.repositories()
    const targets = new Map<string, RuleFileTarget[]>(rules.map((rule) => [rule.id, []]))
    const folders: { base: string; segments: string[]; kind: RuleFileTarget['kind']; rules: Rule[] }[] = [
      ...[...new Set([...repositories.map((repo) => repo.root), ...alsoClean])].map((root) => ({
        base: root,
        segments: ['.claude', 'rules'],
        kind: 'repository' as const,
        // A rule limited to an identity is written into each of its projects' repositories, never the provider's home
        // folder, which every identity shares.
        rules: rules.filter((rule) =>
          repositories.some(
            (repo) =>
              repo.root === root &&
              (repo.projectId === rule.projectId ||
                (rule.projectId?.startsWith('identity:') &&
                  this.host.identityOf?.(repo.projectId) === rule.projectId.slice(9))),
          ),
        ),
      })),
      {
        base: this.host.claudeHome(),
        segments: ['rules'],
        kind: 'user',
        rules: rules.filter((rule) => rule.projectId === null),
      },
    ]
    for (const folder of folders) {
      const display = this.display(join(folder.base, ...folder.segments))
      const report = (rule: Rule, name: string, problem?: string) =>
        targets.get(rule.id)?.push({
          path: join(display, name),
          kind: folder.kind,
          ...(problem ? { problem } : {}),
        })
      const names = this.names(folder.rules)
      try {
        // Claude's config home may not exist before Claude Code first runs; a missing repository is not recreated.
        if (folder.kind === 'user' && folder.rules.length) mkdirSync(folder.base, { recursive: true })
        const dir = safeFolder(folder.base, folder.segments, folder.rules.length > 0)
        if (!dir) continue
        const wanted = new Map(folder.rules.map((rule) => [names.get(rule.id)!, rule]))
        for (const name of readdirSync(dir)) {
          if (!MANAGED_NAME.test(name) || wanted.has(name)) continue
          if (managedId(join(dir, name))) rmSync(join(dir, name), { force: true })
        }
        for (const [name, rule] of wanted) {
          const path = join(dir, name)
          try {
            const text = ruleFileText(rule)
            if (lstatSync(path, { throwIfNoEntry: false }) && managedId(path) === null) {
              report(rule, name, `${join(display, name)} already exists and Ramu did not write it; rename the rule.`)
              continue
            }
            if (!lstatSync(path, { throwIfNoEntry: false }) || readFileSync(path, 'utf8') !== text)
              writeAtomically(path, dir, text)
            report(rule, name)
          } catch (error) {
            report(rule, name, reason(error))
          }
        }
      } catch (error) {
        for (const rule of folder.rules) report(rule, names.get(rule.id)!, reason(error))
      }
    }
    this.last = rules.map((rule) => ({ ruleId: rule.id, targets: targets.get(rule.id) ?? [] }))
    return this.last
  }

  /** File names for the rules sharing one folder; a repeated name gets the rule id's start so both survive. */
  private names(rules: Rule[]): Map<string, string> {
    const names = new Map<string, string>()
    const used = new Set<string>()
    for (const rule of rules) {
      let name = `ramu-${slug(rule.name)}.md`
      if (used.has(name)) name = `ramu-${slug(rule.name)}-${slug(rule.id).slice(0, 8)}.md`
      used.add(name)
      names.set(rule.id, name)
    }
    return names
  }

  private display(path: string) {
    return path === this.home || path.startsWith(this.home + sep) ? '~' + path.slice(this.home.length) : path
  }
}
