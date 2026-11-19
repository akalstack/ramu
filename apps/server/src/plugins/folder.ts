// Reads a plugin folder in the Claude Code and Codex layout into what it would add, without running anything: the
// manifest, `skills/<name>/SKILL.md`, `.mcp.json`, `agents/<name>.md` and `AGENTS.md`. Every part is bounded, and a
// problem is reported with its file instead of stopping the read, so `ramu plugin check` can name them all at once.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import type { Ability } from '@ramu/shared/providers/abilities'
import {
  MANIFEST_PATHS,
  PLUGIN_LIMITS,
  UNUSED_PARTS,
  manifestProblems,
  mcpFile,
  pluginManifest,
  readRamuExtension,
  type PluginContents,
  type PluginCredential,
  type PluginManifest,
  type PluginMcpServer,
  type PluginProblem,
  type RamuExtension,
  type UnusedPart,
} from '@ramu/shared/plugins'
import { readSkillFolder, skillMetadata } from '../memory/skillFiles'

export interface PluginSkill {
  name: string
  description: string
  /** Base64 file contents by path, SKILL.md included. */
  files: Record<string, string>
  scripts: string[]
}

export interface PluginAgent {
  name: string
  description: string
  instructions: string
  readOnly: boolean
}

/** Everything read from a plugin folder. Nothing in it has been saved or run. */
export interface PluginFolder {
  root: string
  manifest: PluginManifest
  extension: RamuExtension
  skills: PluginSkill[]
  mcpServers: Record<string, PluginMcpServer>
  agents: PluginAgent[]
  rule: string | null
  contents: PluginContents
  /** Variables its MCP servers read that no declared slot fills, asked for as keys of their own. */
  asked: string[]
  /** A hash per part, so an update can say what changed and whether it needs approval again. */
  fingerprint: PluginFingerprint
}

export interface PluginFingerprint {
  skills: Record<string, string>
  scripts: Record<string, string>
  mcp: Record<string, string>
  agents: Record<string, string>
  rule: string | null
  credentials: string
  reads: string
  cli: string
}

const hash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)

/** Tools an agent definition needs to change files; one that lists none of them is read-only. */
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|Bash|apply_patch|shell)$/i

function frontmatter(markdown: string): { data: Record<string, unknown>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(markdown)
  if (!match) return null
  try {
    const data = parse(match[1]!, { maxAliasCount: 0 }) as unknown
    return data && typeof data === 'object' ? { data: data as Record<string, unknown>, body: match[2]! } : null
  } catch {
    return null
  }
}

function inside(root: string, path: string): boolean {
  const full = resolve(root, path)
  return full === root || full.startsWith(root + sep)
}

function readText(root: string, path: string, limit: number): string | null {
  const full = join(root, path)
  if (!existsSync(full)) return null
  const stat = lstatSync(full)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${path} must be a plain file.`)
  if (stat.size > limit) throw new Error(`${path} is larger than ${Math.round(limit / 1024)} KB.`)
  return readFileSync(full, 'utf8')
}

/** The manifest's path and parsed JSON, in the order Ramu reads them. */
function findManifest(root: string): { file: string; json: unknown } | { file: string; error: string } {
  for (const file of MANIFEST_PATHS) {
    let text: string | null
    try {
      text = readText(root, file, PLUGIN_LIMITS.manifestBytes)
    } catch (error) {
      return { file, error: (error as Error).message }
    }
    if (text === null) continue
    try {
      return { file, json: JSON.parse(text) as unknown }
    } catch (error) {
      return { file, error: `Not valid JSON: ${(error as Error).message}` }
    }
  }
  return { file: 'plugin.json', error: `No manifest: add plugin.json, ${MANIFEST_PATHS.slice(1).join(' or ')}.` }
}

export function readPluginFolder(folder: string): PluginFolder {
  const root = resolve(folder)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`${folder} is not a folder.`)
  const problems: PluginProblem[] = []
  const found = findManifest(root)
  if ('error' in found) throw new PluginReadError([{ file: found.file, message: found.error }])
  // Claude Code accepts a display name such as "Notion"; Ramu keys plugins by the lowercase, dashed form of it.
  const json =
    found.json && typeof found.json === 'object' && typeof (found.json as { name?: unknown }).name === 'string'
      ? {
          ...found.json,
          name: (found.json as { name: string }).name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, ''),
        }
      : found.json
  const parsed = pluginManifest.safeParse(json)
  if (!parsed.success) throw new PluginReadError(manifestProblems(parsed.error, found.file))
  const manifest = parsed.data
  const { extension: declared, problems: extensionProblems } = readRamuExtension(manifest, found.file)
  let extension = declared
  problems.push(...extensionProblems)

  // Skills
  const skills: PluginSkill[] = []
  const skillsDir = join(root, 'skills')
  let totalBytes = 0
  let totalFiles = 0
  if (existsSync(skillsDir) && lstatSync(skillsDir).isDirectory()) {
    // Only folders with a SKILL.md are skills; a README or an old version kept beside them is left alone.
    const names = readdirSync(skillsDir).filter(
      (name) => !name.startsWith('.') && existsSync(join(skillsDir, name, 'SKILL.md')),
    )
    if (names.length > PLUGIN_LIMITS.skills)
      problems.push({ file: 'skills', message: `A plugin has at most ${PLUGIN_LIMITS.skills} skills.` })
    for (const name of names.slice(0, PLUGIN_LIMITS.skills)) {
      const file = `skills/${name}/SKILL.md`
      try {
        const folder = readSkillFolder(join(skillsDir, name), { skipHidden: true })
        const meta = skillMetadata(folder.markdown)
        // Claude Code names a skill by its SKILL.md, whatever its folder is called; so does Ramu.
        if (skills.some((skill) => skill.name === meta.name)) throw new Error(`Two skills are named ${meta.name}.`)
        const bytes = Object.values(folder.files).reduce((sum, value) => sum + Math.ceil((value.length * 3) / 4), 0)
        if (bytes > PLUGIN_LIMITS.skillBytes)
          throw new Error(`The skill is larger than ${PLUGIN_LIMITS.skillBytes / 1024 / 1024} MB.`)
        totalBytes += bytes
        totalFiles += Object.keys(folder.files).length
        skills.push({
          name: meta.name,
          description: meta.description,
          files: folder.files,
          scripts: [...folder.scripts].sort(),
        })
      } catch (error) {
        problems.push({ file, message: (error as Error).message })
      }
    }
  }
  if (totalFiles > PLUGIN_LIMITS.files)
    problems.push({ file: 'skills', message: `A plugin has at most ${PLUGIN_LIMITS.files} files.` })
  if (totalBytes > PLUGIN_LIMITS.totalBytes)
    problems.push({ file: 'skills', message: `A plugin is at most ${PLUGIN_LIMITS.totalBytes / 1024 / 1024} MB.` })

  // Slash commands become skills: Claude Code runs both the same way, and every agent Ramu runs reads skills.
  const commandsDir = join(root, 'commands')
  const commandSkills = existsSync(commandsDir) && lstatSync(commandsDir).isDirectory()
  if (commandSkills)
    for (const file of commandFiles(commandsDir).slice(0, PLUGIN_LIMITS.skills - skills.length)) {
      try {
        const text = readText(root, `commands/${file}`, PLUGIN_LIMITS.skillBytes)
        if (text === null) continue
        const parsedCommand = frontmatter(text)
        const body = (parsedCommand?.body ?? text).trim()
        const name = file
          .replace(/\.md$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64)
        if (!name || !body || skills.some((skill) => skill.name === name)) continue
        const description = (
          (typeof parsedCommand?.data.description === 'string' ? parsedCommand.data.description.trim() : '') ||
          firstLine(body)
        ).slice(0, 1000)
        const markdown = [
          '---',
          `name: ${name}`,
          `description: ${JSON.stringify(description)}`,
          '---',
          '',
          `Follow this when the person asks for /${name}. $ARGUMENTS stands for what they wrote after it.`,
          '',
          body,
          '',
        ].join('\n')
        skills.push({ name, description, files: { 'SKILL.md': Buffer.from(markdown).toString('base64') }, scripts: [] })
      } catch (error) {
        problems.push({ file: `commands/${file}`, message: (error as Error).message })
      }
    }

  // MCP servers: inline in the manifest, a file it names, or `.mcp.json`.
  let mcpServers: Record<string, PluginMcpServer> = {}
  const mcpPath = typeof manifest.mcpServers === 'string' ? manifest.mcpServers.replace(/^\.\//, '') : '.mcp.json'
  if (manifest.mcpServers && typeof manifest.mcpServers === 'object') mcpServers = manifest.mcpServers
  else if (!inside(root, mcpPath)) problems.push({ file: found.file, message: 'mcpServers points outside the plugin.' })
  else
    try {
      const text = readText(root, mcpPath, PLUGIN_LIMITS.manifestBytes)
      if (text !== null) {
        const json = JSON.parse(text) as unknown
        // Claude Code also reads a file that is only the servers, without the `mcpServers` wrapper.
        const file = mcpFile.safeParse(
          json && typeof json === 'object' && !('mcpServers' in json) ? { mcpServers: json } : json,
        )
        if (file.success) mcpServers = file.data.mcpServers
        else problems.push(...manifestProblems(file.error, mcpPath))
      }
    } catch (error) {
      problems.push({ file: mcpPath, message: (error as Error).message })
    }
  if (Object.keys(mcpServers).length > PLUGIN_LIMITS.mcpServers) {
    problems.push({ file: mcpPath, message: `A plugin has at most ${PLUGIN_LIMITS.mcpServers} MCP servers.` })
    mcpServers = Object.fromEntries(Object.entries(mcpServers).slice(0, PLUGIN_LIMITS.mcpServers))
  }
  for (const [name, server] of Object.entries(mcpServers))
    if ('url' in server) {
      try {
        const url = new URL(server.url.replace(/\$\{[^}]+\}/g, 'x'))
        if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
          problems.push({ file: mcpPath, message: `${name} must use an https address.` })
      } catch {
        problems.push({ file: mcpPath, message: `${name}'s url is not an address.` })
      }
    }

  // Custom agents
  const agents: PluginAgent[] = []
  const agentsDir = join(root, 'agents')
  if (existsSync(agentsDir) && lstatSync(agentsDir).isDirectory())
    for (const entry of readdirSync(agentsDir)
      .filter((name) => name.endsWith('.md'))
      .slice(0, PLUGIN_LIMITS.agents)) {
      const file = `agents/${entry}`
      try {
        const text = readText(root, file, 64 * 1024)!
        const parsedAgent = frontmatter(text)
        const name = typeof parsedAgent?.data.name === 'string' ? parsedAgent.data.name : entry.slice(0, -3)
        const instructions = (parsedAgent?.body ?? text).trim()
        // Without a description, its first line of instructions says what it is for.
        const description =
          (typeof parsedAgent?.data.description === 'string' ? parsedAgent.data.description.trim() : '') ||
          firstLine(instructions)
        if (!instructions) throw new Error('An agent needs instructions.')
        const tools = parsedAgent?.data.tools
        const list = Array.isArray(tools)
          ? tools.map(String)
          : typeof tools === 'string'
            ? tools.split(',').map((tool) => tool.trim())
            : null
        agents.push({
          name: name.slice(0, 60),
          description: description.slice(0, 300),
          instructions: instructions.slice(0, 8000),
          readOnly: list !== null && !list.some((tool) => EDIT_TOOLS.test(tool)),
        })
      } catch (error) {
        problems.push({ file, message: (error as Error).message })
      }
    }

  // Values an MCP server reads from the person's environment (`${GITHUB_TOKEN}`, as Claude Code plugins write them)
  // become keys the plugin asks for, the way its own declared keys are, unless a declared key already fills them.
  const filled = new Set(extension.credentials.flatMap((slot) => [slot.env, ...slot.fields.map((field) => field.env)]))
  const wanted = new Set<string>()
  for (const server of Object.values(mcpServers)) {
    const values =
      'url' in server ? [server.url, ...Object.values(server.headers)] : [...Object.values(server.env), ...server.args]
    for (const value of values)
      for (const match of value.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g))
        if (!PLUGIN_ROOT_NAMES.has(match[1]!) && !filled.has(match[1]!)) wanted.add(match[1]!)
  }
  const asked: PluginCredential[] = [...wanted]
    .slice(0, Math.max(0, PLUGIN_LIMITS.credentials - extension.credentials.length))
    .map((env) => ({
      id: env.toLowerCase().replace(/_/g, '-').slice(0, 40),
      label: env.charAt(0) + env.slice(1).toLowerCase().replace(/_/g, ' '),
      env,
      kind: 'token',
      fields: [],
    }))
  if (asked.length) extension = { ...extension, credentials: [...extension.credentials, ...asked] }

  let rule: string | null = null
  try {
    rule = readText(root, 'AGENTS.md', 64 * 1024)
  } catch (error) {
    problems.push({ file: 'AGENTS.md', message: (error as Error).message })
  }

  // Ability mappings must name a server the plugin declares; the tool is checked once the server runs.
  const abilities = Object.entries(extension.abilities).flatMap(([ability, target]) => {
    if (!target) return []
    if (!mcpServers[target.server])
      problems.push({
        file: found.file,
        message: `${ability} is mapped to server ${target.server}, which the plugin does not declare.`,
      })
    return [
      {
        ability: ability as Ability,
        server: target.server,
        tool: target.tool,
        ...(target.status ? { status: target.status } : {}),
        ...(target.balance ? { balance: target.balance } : {}),
        ...(target.fromImage ? { fromImage: target.fromImage } : {}),
        ...(target.refine ? { refine: target.refine } : {}),
        downloads: target.downloads,
      },
    ]
  })

  const unused: UnusedPart[] = UNUSED_PARTS.filter((part) => manifest[part] !== undefined)
  const add = (part: UnusedPart, present: boolean) => {
    if (present && !unused.includes(part)) unused.push(part)
  }
  add('hooks', existsSync(join(root, 'hooks')))
  if (!commandSkills) add('commands', existsSync(join(root, 'commands')))
  else if (unused.includes('commands')) unused.splice(unused.indexOf('commands'), 1)
  add('lspServers', existsSync(join(root, '.lsp.json')))
  add('outputStyles', existsSync(join(root, 'output-styles')))
  add('apps', existsSync(join(root, '.app.json')))

  const author = manifest.author ? manifest.author.name : null
  const contents: PluginContents = {
    name: manifest.name,
    version: manifest.version ?? null,
    description: manifest.description ?? '',
    author,
    homepage: manifest.homepage ?? null,
    license: manifest.license ?? null,
    manifest: found.file,
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      files: Object.keys(skill.files).sort(),
      scripts: skill.scripts,
    })),
    mcpServers: Object.entries(mcpServers).map(([name, server]) =>
      'url' in server
        ? { name, type: 'http' as const, url: server.url, headerKeys: Object.keys(server.headers) }
        : {
            name,
            type: 'stdio' as const,
            command: server.command,
            args: server.args,
            envKeys: Object.keys(server.env),
          },
    ),
    agents: agents.map(({ name, description, readOnly }) => ({ name, description, readOnly })),
    rule: rule === null ? null : { file: 'AGENTS.md', bytes: Buffer.byteLength(rule) },
    credentials: extension.credentials.map((slot) => ({
      id: slot.id,
      label: slot.label,
      kind: slot.kind,
      env: slot.env,
      page: slot.page ?? slot.signIn?.clientPage ?? null,
      scope: slot.scope ?? null,
      fields: slot.fields.map((field) => ({
        id: field.id,
        label: field.label,
        kind: field.kind,
        ...(field.values ? { values: field.values } : {}),
      })),
    })),
    cli: extension.cli
      ? {
          binaries: extension.cli.binaries,
          npx: extension.cli.npx ?? null,
          reads: extension.cli.reads.map((prefix) => prefix.join(' ')),
        }
      : null,
    abilities,
    dataSources: extension.dataSources.map((source) => ({
      id: source.id,
      label: source.label,
      credential: source.credential,
    })),
    stacks: extension.stacks,
    unused,
    requires: extension.requires?.ramu ?? null,
    problems,
  }
  const fingerprint: PluginFingerprint = {
    skills: Object.fromEntries(skills.map((skill) => [skill.name, hash(skill.files)])),
    scripts: Object.fromEntries(
      skills.map((skill) => [skill.name, hash(skill.scripts.map((path) => [path, skill.files[path]]))]),
    ),
    mcp: Object.fromEntries(Object.entries(mcpServers).map(([name, server]) => [name, hash(server)])),
    agents: Object.fromEntries(agents.map((agent) => [agent.name, hash(agent)])),
    rule: rule === null ? null : hash(rule),
    credentials: hash(extension.credentials),
    reads: hash(extension.cli?.reads ?? []),
    cli: hash(extension.cli ? { ...extension.cli, reads: [] } : null),
  }
  return {
    root,
    manifest,
    extension,
    skills,
    mcpServers,
    agents,
    rule,
    contents,
    asked: asked.map((slot) => slot.env),
    fingerprint,
  }
}

/** A manifest that cannot be read at all: nothing else is worth reporting until it is fixed. */
export class PluginReadError extends Error {
  constructor(readonly problems: PluginProblem[]) {
    super(problems.map((problem) => `${problem.file}: ${problem.message}`).join('\n'))
  }
}

/** What changed between two reads of a plugin, and whether it asks for approval again. */
export function pluginChanges(
  before: PluginFingerprint,
  after: PluginFingerprint,
): { changes: string[]; needsApproval: boolean } {
  const changes: string[] = []
  let needsApproval = false
  const compare = (kind: string, a: Record<string, string>, b: Record<string, string>, approval: boolean) => {
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[name] === b[name]) continue
      changes.push(
        !a[name] ? `${kind} ${name} added` : !b[name] ? `${kind} ${name} removed` : `${kind} ${name} changed`,
      )
      if (approval && b[name]) needsApproval = true
    }
  }
  compare('Skill', before.skills, after.skills, false)
  compare('Scripts in skill', before.scripts, after.scripts, true)
  compare('MCP server', before.mcp, after.mcp, true)
  compare('Agent', before.agents, after.agents, false)
  if (before.rule !== after.rule) changes.push(after.rule ? 'Rule changed' : 'Rule removed')
  if (before.credentials !== after.credentials) {
    changes.push('Credentials changed')
    needsApproval = true
  }
  if (before.reads !== after.reads) {
    changes.push('Commands that run without asking changed')
    needsApproval = true
  }
  if (before.cli !== after.cli) {
    changes.push('CLI changed')
    needsApproval = true
  }
  return { changes, needsApproval }
}

/** Names Ramu fills with the plugin's own folder, never asked for. */
const PLUGIN_ROOT_NAMES = new Set(['CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT', 'CODEX_PLUGIN_ROOT'])

/** The first line of text that is not a heading, for a description a file did not give. */
function firstLine(text: string) {
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith('#'))
  return (line ?? text.split('\n')[0]!.replace(/^#+\s*/, '')).slice(0, 300)
}

/** Markdown files under `commands/`, with one folder level kept as a prefix as Claude Code namespaces them. */
function commandFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isFile() && entry.endsWith('.md')) files.push(entry)
    else if (stat.isDirectory())
      for (const inner of readdirSync(full).sort())
        if (inner.endsWith('.md') && lstatSync(join(full, inner)).isFile()) files.push(`${entry}/${inner}`)
  }
  return files
}
