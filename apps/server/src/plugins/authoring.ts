// `ramu plugin new` and `ramu plugin check`: a working plugin folder from a template, and every problem in one, each
// with its file and the fix, before anyone installs it. The index repository's CI runs the same check.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { PLUGIN_NAME, PLUGIN_SCHEMA_URL, RAMU_EXTENSION, type PluginProblem } from '@ramu/shared/plugins'
import { platformCli } from '../workspace/deploy/signIn'
import { git } from '../workspace/git'
import { PluginReadError, readPluginFolder } from './folder'

const ROOT = /\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|CODEX_PLUGIN_ROOT)\}/g

/** Writes a new plugin folder named `name` inside `parent`; `--mcp` adds a TypeScript MCP server, `--cli` a CLI. */
export function newPlugin(parent: string, name: string, options: { mcp: boolean; cli: boolean }): string {
  if (!PLUGIN_NAME.test(name))
    throw new Error('Name the plugin in lowercase words joined by dashes, such as render-deploy.')
  const root = resolve(parent, name)
  if (existsSync(root) && readdirSync(root).length) throw new Error(`${root} already exists and is not empty.`)
  const env = `${name.replace(/-/g, '_').toUpperCase()}_TOKEN`
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': `${JSON.stringify(
      {
        $schema: PLUGIN_SCHEMA_URL,
        name,
        version: '0.1.0',
        description: `What ${name} lets an agent do, in one sentence.`,
        author: { name: 'Your name' },
        license: 'MIT',
        extensions: {
          [RAMU_EXTENSION]: {
            credentials: [
              {
                id: 'token',
                label: `${name} API token`,
                env,
                kind: 'token',
                page: 'https://example.com/account/tokens',
                scope: 'Read and deploy',
              },
            ],
            ...(options.cli
              ? { cli: { binaries: [name], reads: [['--help'], ['--version'], ['whoami'], ['status'], ['list']] } }
              : {}),
            stacks: [],
            keywords: [name],
          },
        },
      },
      null,
      2,
    )}\n`,
    [`skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: Use when the task needs ${name}. Say what it does and when an agent should reach for it.\n---\n\n# ${name}\n\nThe steps an agent follows, in plain imperative sentences.\n${options.cli ? `\nRun the CLI through \`platform_cli\` with \`platform: "${name}"\`; never run it yourself or pass a token.\n` : ''}`,
    'README.md': `# ${name}\n\nA plugin for Ramu, Claude Code and Codex.\n\n- Test it in a thread: \`ramu plugin dev .\`\n- Check it: \`ramu plugin check .\`\n- Get it listed: open a pull request adding it to https://github.com/akalstack/ramu-plugins.\n\nThe Ramu-only fields live under \`extensions["${RAMU_EXTENSION}"]\` in \`.claude-plugin/plugin.json\`; other tools ignore them. See https://getramu.dev/docs/plugins for each field.\n`,
    'AGENTS.md': `When working with ${name}, follow the ${name} skill.\n`,
  }
  if (options.mcp) {
    files['.mcp.json'] = `${JSON.stringify(
      {
        mcpServers: {
          [name]: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/index.mjs'], env: { [env]: `\${${env}}` } },
        },
      },
      null,
      2,
    )}\n`
    files['server/index.mjs'] =
      `// A minimal MCP server: one read-only tool. Install the SDK with \`npm install @modelcontextprotocol/sdk zod\`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: '${name}', version: '0.1.0' })
server.registerTool(
  'status',
  { description: 'Read the status of the ${name} account.', inputSchema: { verbose: z.boolean().optional() }, annotations: { readOnlyHint: true } },
  async () => {
    // The token arrives in the environment, never as an argument.
    const signedIn = Boolean(process.env.${env})
    return { content: [{ type: 'text', text: JSON.stringify({ signedIn }) }] }
  },
)
await server.connect(new StdioServerTransport())
`
    files['package.json'] = `${JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        dependencies: { '@modelcontextprotocol/sdk': '^1.20.0', zod: '^3.25.0' },
      },
      null,
      2,
    )}\n`
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

export interface CheckReport {
  name: string | null
  problems: PluginProblem[]
  /** Each MCP server that started, with its tools. */
  servers: { name: string; tools: string[] }[]
  /** Whether the folder's current commit is signed, when it is a repository. */
  signed: boolean | null
}

/**
 * Validates the manifest, parses every skill, starts each local MCP server and lists its tools, and checks that
 * ability mappings name real tools and that every `${VAR}` a server reads comes from a credential slot.
 */
export async function checkPlugin(
  folder: string,
  options: { startServers?: boolean; timeoutMs?: number } = {},
): Promise<CheckReport> {
  let read: ReturnType<typeof readPluginFolder>
  try {
    read = readPluginFolder(folder)
  } catch (error) {
    if (error instanceof PluginReadError) return { name: null, problems: error.problems, servers: [], signed: null }
    return { name: null, problems: [{ file: folder, message: (error as Error).message }], servers: [], signed: null }
  }
  const problems = [...read.contents.problems]
  // Installing asks for an undeclared variable on its own; an author still declares it, to name it and say where it is made.
  const declared = new Set(
    read.extension.credentials
      .filter((slot) => !read.asked.includes(slot.env))
      .flatMap((slot) => [slot.env, ...slot.fields.map((f) => f.env)]),
  )
  const mcpFile =
    typeof read.manifest.mcpServers === 'object'
      ? read.contents.manifest
      : (read.manifest.mcpServers?.replace(/^\.\//, '') ?? '.mcp.json')
  for (const [name, server] of Object.entries(read.mcpServers)) {
    const values = 'url' in server ? Object.values(server.headers) : [...Object.values(server.env), ...server.args]
    for (const value of values)
      for (const match of value.replace(ROOT, '').matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g))
        if (!declared.has(match[1]!))
          problems.push({
            file: mcpFile,
            message: `${name} reads \${${match[1]}}, which no credential slot declares. Add a slot or a field with env ${match[1]}.`,
          })
    if ('url' in server && /\$\{/.test(server.url))
      problems.push({ file: mcpFile, message: `${name}'s url may not use variables; put secrets in headers.` })
  }
  const servers: CheckReport['servers'] = []
  if (options.startServers !== false)
    for (const [name, server] of Object.entries(read.mcpServers)) {
      if ('url' in server) continue
      const command = server.command.replace(ROOT, read.root)
      const executable = command.startsWith('/') ? command : platformCli(command)
      if (!executable) {
        problems.push({ file: mcpFile, message: `${name} runs ${server.command}, which is not installed here.` })
        continue
      }
      const env: Record<string, string> = { PATH: process.env.PATH ?? '' }
      for (const [key, value] of Object.entries(server.env))
        env[key] = value.replace(ROOT, read.root).replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, 'check')
      const client = new Client({ name: 'ramu-plugin-check', version: '0.1.0' }, { capabilities: {} })
      try {
        await client.connect(
          new StdioClientTransport({
            command: executable,
            args: server.args.map((arg) => arg.replace(ROOT, read.root)),
            cwd: server.cwd ? resolve(read.root, server.cwd.replace(ROOT, read.root)) : read.root,
            env,
            stderr: 'ignore',
          }),
          { timeout: options.timeoutMs ?? 30_000 },
        )
        const { tools } = await client.listTools(undefined, { timeout: options.timeoutMs ?? 30_000 })
        servers.push({ name, tools: tools.map((tool) => tool.name) })
      } catch (error) {
        problems.push({
          file: mcpFile,
          message: `${name} did not start or list its tools: ${(error as Error).message.slice(0, 200)}. Run its command yourself to see why.`,
        })
      } finally {
        await client.close().catch(() => {})
      }
    }
  for (const entry of read.contents.abilities) {
    const started = servers.find((server) => server.name === entry.server)
    for (const tool of [entry.tool, entry.status, entry.balance, entry.fromImage, entry.refine])
      if (started && tool && !started.tools.includes(tool))
        problems.push({
          file: read.contents.manifest,
          message: `${entry.ability} is mapped to ${entry.server}.${tool}, but ${entry.server} has no tool named ${tool} (it has ${started.tools.join(', ') || 'none'}).`,
        })
  }
  let signed: boolean | null = null
  if (existsSync(join(read.root, '.git')))
    // An empty allowed-signers file makes Git report an SSH signature it cannot vouch for as U, not as missing.
    signed = await git(read.root, ['-c', 'gpg.ssh.allowedSignersFile=/dev/null', 'log', '-1', '--format=%G?'])
      .then((out) => !['N', ''].includes(out.trim()))
      .catch(() => null)
  return { name: read.manifest.name, problems, servers, signed }
}
