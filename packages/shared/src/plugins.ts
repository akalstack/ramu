// Plugins: one unit that adds a service to Ramu (skills, MCP servers, custom agents, a rule, a credential, a CLI with
// its safe commands, ability mappings and dashboard data sources), in the folder layout Claude Code and Codex already
// use, so one repository works in all three. Ramu's own fields live under `extensions["dev.getramu"]`, which other tools
// ignore. Everything here is pure: the host, both clients, `ramu plugin check` and the index's CI validate with it.
import { z } from 'zod'
import { MCP_ABILITIES, type Ability } from './providers/abilities'
import { STACK_IDS } from './stacks'

/** The key Ramu's fields sit under in a manifest's `extensions` block. */
export const RAMU_EXTENSION = 'dev.getramu'
/** Where an editor finds the manifest's JSON Schema. */
export const PLUGIN_SCHEMA_URL = 'https://getramu.dev/schema/plugin.json'
/** The index Ramu lists by default, and the repository its plugins are added to with a pull request. */
export const DEFAULT_PLUGIN_INDEX = 'https://github.com/akalstack/ramu-plugins'
/** Claude's own plugin directory, listed beside Ramu's: the same marketplace format, read without Akalstack's key. */
export const CLAUDE_PLUGIN_INDEX = 'https://github.com/anthropics/claude-plugins-official'
/**
 * The key Akalstack signs the Ramu index's commits with. A clone of the index whose commit this key did not sign is
 * refused before anything in it is read, so a tampered index or a pushed-over plugin never reaches the review.
 */
export const RAMU_INDEX_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIS8gQ2jWc3cC2dgOV8KqFHnU1WQcSEdVddHVpx6uwQ3 Akalstack plugin index'
/** The loopback callback a plugin's sign-in client registers; the host listens there only during a sign-in. */
export const PLUGIN_CALLBACK_PORT = 7417
export const PLUGIN_CALLBACK = `http://localhost:${PLUGIN_CALLBACK_PORT}/plugin/callback`
/** Manifest locations, read in this order: the first one found is the manifest. */
export const MANIFEST_PATHS = ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json'] as const

export const PLUGIN_LIMITS = {
  manifestBytes: 64 * 1024,
  skills: 60,
  /** Room for the references vendors bundle with a skill, as the plugins in Claude's directory do. */
  skillBytes: 2 * 1024 * 1024,
  /** Every file a plugin brings, skills' supporting files included. */
  files: 1000,
  totalBytes: 16 * 1024 * 1024,
  mcpServers: 10,
  agents: 20,
  credentials: 4,
  fields: 6,
  dataSources: 12,
  readPrefixes: 60,
} as const

/** Plugin names are what Claude Code requires: lowercase kebab case. */
export const PLUGIN_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const SLOT_ID = /^[a-z][a-z0-9_-]{0,39}$/
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
/** Environment a plugin may not set: it would change how the CLI or server finds programs, or where it keeps a login. */
const RESERVED_ENV = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SHELL',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'CLAUDE_PLUGIN_ROOT',
  'PLUGIN_ROOT',
])

const text = (max: number) => z.string().trim().min(1).max(max)
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Use an https address.')
const envName = z
  .string()
  .regex(ENV_NAME, 'Name environment variables in capitals, such as RENDER_API_KEY.')
  .refine(
    (value) => !RESERVED_ENV.has(value) && !/^(RAMU_|CODEX_|CLAUDE_|LD_|DYLD_)/.test(value),
    'That environment variable is reserved.',
  )

const person = z.union([
  text(120).transform((name) => ({ name })),
  z.object({
    name: text(120),
    email: z.string().trim().max(200).optional(),
    url: z.string().trim().max(500).optional(),
  }),
])

// ---- Ramu's extension ----

const extraField = z.strictObject({
  id: z.string().regex(SLOT_ID),
  label: text(80),
  env: envName,
  /** `url` values must be https and become an origin a data source or check may call. */
  kind: z.enum(['text', 'url', 'secret']).default('text'),
  pattern: z.string().max(300).optional(),
  placeholder: z.string().max(200).optional(),
  /** Choices shown as a menu, such as a region. */
  values: z.array(text(60)).min(1).max(20).optional(),
  default: z.string().max(200).optional(),
})

/** One HTTPS request made with a slot's value, never by the plugin's own code. */
const request = z.strictObject({
  method: z.enum(['GET', 'POST']).default('GET'),
  /** An https address, or one starting with `{field.<id>}` where that field is a `url` field. */
  url: z.string().trim().min(1).max(2000),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,60}$/), z.string().max(500)).default({}),
  /** A POST body as JSON; strings in it may use `{token}`, `{field.<id>}` and `{query.<name>}`. */
  body: z.unknown().optional(),
})

const credentialCheck = z.strictObject({
  request,
  /** A dot path in the response naming who the value belongs to, such as `email` or `user.name`. */
  identity: z.string().max(200).optional(),
})

const credential = z
  .strictObject({
    id: z.string().regex(SLOT_ID),
    label: text(80),
    /** The variable a CLI or MCP server reads the value from. */
    env: envName,
    kind: z.enum(['token', 'sign-in']),
    /** Where the token is made, and which scope to pick there. */
    page: httpsUrl.optional(),
    scope: z.string().trim().max(300).optional(),
    pattern: z.string().max(300).optional(),
    fields: z.array(extraField).max(PLUGIN_LIMITS.fields).default([]),
    signIn: z
      .strictObject({
        authorizeUrl: httpsUrl,
        tokenUrl: httpsUrl,
        scopes: z.array(text(200)).max(30).default([]),
        /** A service with a separate test environment, such as Salesforce sandboxes. */
        sandbox: z.strictObject({ label: text(60), authorizeUrl: httpsUrl, tokenUrl: httpsUrl }).optional(),
        /** Where the person makes the client whose id they paste. */
        clientPage: httpsUrl.optional(),
        /** A token response field holding the address later calls go to, such as Salesforce's `instance_url`. */
        instanceField: z
          .string()
          .regex(/^[a-z_]{1,40}$/)
          .optional(),
      })
      .optional(),
    check: credentialCheck.optional(),
  })
  .superRefine((slot, context) => {
    if (slot.kind === 'sign-in' && !slot.signIn)
      context.addIssue({ code: 'custom', message: 'A sign-in slot needs signIn with its authorize and token URLs.' })
    if (slot.kind === 'token' && slot.signIn)
      context.addIssue({ code: 'custom', message: 'A token slot has no signIn block; use kind "sign-in".' })
    const ids = new Set<string>()
    for (const field of slot.fields) {
      if (ids.has(field.id)) context.addIssue({ code: 'custom', message: `Field ${field.id} is named twice.` })
      ids.add(field.id)
      if (field.env === slot.env)
        context.addIssue({ code: 'custom', message: `Field ${field.id} uses the slot's own variable ${slot.env}.` })
    }
  })

const cli = z.strictObject({
  /** The CLI's own names, tried in order. */
  binaries: z
    .array(z.string().regex(/^[A-Za-z0-9._-]{1,60}$/))
    .min(1)
    .max(4),
  /** A published package run through npx when none is installed, such as `@railway/cli` or `wrangler@4`. */
  npx: z
    .string()
    .regex(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[A-Za-z0-9.^~<>=*-]+)?$/)
    .optional(),
  /** Argument prefixes that only read: they run without asking. Every other command asks the person. */
  reads: z
    .array(z.array(z.string().min(1).max(60)).min(1).max(6))
    .max(PLUGIN_LIMITS.readPrefixes)
    .default([]),
  /** Environment set from a slot's field rather than its token, such as `CLOUDFLARE_ACCOUNT_ID`. */
  credential: z.string().regex(SLOT_ID).optional(),
  /**
   * Which commands deploy. A preview runs without asking; a production deploy asks every time unless the person allows
   * production deploys for the thread, and the project's migrations run before it.
   */
  deploys: z
    .strictObject({
      /** Argument prefixes that deploy, such as `["up"]` or `["deploy"]`. */
      commands: z
        .array(z.array(z.string().min(1).max(60)).min(1).max(6))
        .min(1)
        .max(10),
      /** The flag that makes a deploy command production (`--prod`); without one, every deploy is production. */
      productionFlag: z
        .string()
        .regex(/^--?[A-Za-z0-9-]{1,40}$/)
        .optional(),
      /** Prefixes that change production without a new deploy, such as a rollback or a promotion. */
      production: z
        .array(z.array(z.string().min(1).max(60)).min(1).max(6))
        .max(10)
        .default([]),
    })
    .optional(),
})

/**
 * An origin a file may be downloaded from: https, with no path, query or credentials. `https://*.example.com` allows
 * every subdomain of a domain the service owns, for a CDN whose host varies.
 */
const downloadOrigin = z
  .string()
  .trim()
  .max(300)
  .transform((value) => value.replace(/\/$/, '').toLowerCase())
  .refine(
    (value) => /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value),
    'Use an https origin such as https://assets.example.com or https://*.example.com, with no path.',
  )

const ability = z.strictObject({
  /** A server named in `.mcp.json` (or the manifest's `mcpServers`). */
  server: z.string().min(1).max(100),
  tool: z.string().min(1).max(200),
  /** For a service that works in the background: the tool the task id is passed to until the file is ready. */
  status: z.string().min(1).max(200).optional(),
  /** A tool that reports the account's credits, called by the live check instead of making something. */
  balance: z.string().min(1).max(200).optional(),
  /** A tool that makes a model from an image, when image-to-3D is its own tool. */
  fromImage: z.string().min(1).max(200).optional(),
  /** A tool that textures a text preview, given the preview's task id. */
  refine: z.string().min(1).max(200).optional(),
  /** Where a file the tool links to may be downloaded from; a link anywhere else is refused. */
  downloads: z.array(downloadOrigin).max(5).default([]),
})

const queryField = z.strictObject({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  description: z.string().max(300).optional(),
  values: z
    .array(z.union([z.string().max(100), z.number()]))
    .min(1)
    .max(50)
    .optional(),
  default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().min(1).max(4000).default(500),
  /** A pattern the value must match, such as `^\s*SELECT\b` for a query that only reads. */
  pattern: z.string().max(300).optional(),
  required: z.boolean().default(false),
})

/** How a response becomes rows. Paths are dot paths with numeric indices (`results.A.frames.0`). */
const rows = z.discriminatedUnion('shape', [
  /** A list of objects; each one's keys are columns. */
  z.strictObject({ shape: z.literal('objects'), path: z.string().max(200).default('') }),
  /** Named columns of values: names at `names` (objects with `nameKey`, or strings), values as one list per column. */
  z.strictObject({
    shape: z.literal('columns'),
    names: z.string().max(200),
    nameKey: z.string().max(60).optional(),
    values: z.string().max(200),
  }),
  /** Series over dates: one row per date and series, as `date`, `series` and `value`. */
  z.strictObject({
    shape: z.literal('series'),
    dates: z.string().max(200),
    values: z.string().max(200),
    labels: z.string().max(200).optional(),
    /** The series name when the response gives none, such as `{query.event}`. */
    label: z.string().max(200).optional(),
  }),
])

const dataSource = z.strictObject({
  /** What a dashboard's table names, such as `grafana`. Unique across installed plugins. */
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  label: text(80),
  description: z.string().max(500).optional(),
  credential: z.string().regex(SLOT_ID),
  request,
  /** POST is allowed only to an endpoint that only reads, which the author states here. */
  readOnly: z.boolean().default(false),
  query: z.array(queryField).max(20).default([]),
  rows,
})

const ramuExtension = z
  .strictObject({
    credentials: z.array(credential).max(PLUGIN_LIMITS.credentials).default([]),
    cli: cli.optional(),
    abilities: z.record(z.string(), ability).default({}),
    dataSources: z.array(dataSource).max(PLUGIN_LIMITS.dataSources).default([]),
    stacks: z.array(z.enum(STACK_IDS)).max(STACK_IDS.length).default([]),
    /** Services the plugin suits, as words people search for ("deploy", "render", "analytics"). */
    keywords: z.array(text(40)).max(20).default([]),
    requires: z.strictObject({ ramu: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/) }).optional(),
    /**
     * The service's own plugin in Claude's directory, which teaches agents the service while this one connects it to
     * Ramu (sign-in, safe commands, dashboard data). Installing either offers the other.
     */
    companion: z.string().regex(PLUGIN_NAME).optional(),
  })
  .superRefine((value, context) => {
    for (const name of Object.keys(value.abilities))
      if (!(MCP_ABILITIES as readonly string[]).includes(name))
        context.addIssue({
          code: 'custom',
          path: ['abilities', name],
          message: `${name} is not an ability an MCP tool can run. Use one of ${MCP_ABILITIES.join(', ')}.`,
        })
    const slots = new Map(value.credentials.map((slot) => [slot.id, slot]))
    if (slots.size !== value.credentials.length)
      context.addIssue({ code: 'custom', path: ['credentials'], message: 'Two credential slots share an id.' })
    const envs = value.credentials.flatMap((slot) => [slot.env, ...slot.fields.map((field) => field.env)])
    if (new Set(envs).size !== envs.length)
      context.addIssue({ code: 'custom', path: ['credentials'], message: 'Two credential values share a variable.' })
    if (value.cli && value.cli.reads.some((prefix) => prefix.every((part) => !part.trim())))
      context.addIssue({ code: 'custom', path: ['cli', 'reads'], message: 'A read-only prefix is empty.' })
    if (value.cli?.credential && !slots.has(value.cli.credential))
      context.addIssue({
        code: 'custom',
        path: ['cli', 'credential'],
        message: `The CLI names credential ${value.cli.credential}, which no slot declares.`,
      })
    const sources = new Set<string>()
    value.dataSources.forEach((source, index) => {
      const slot = slots.get(source.credential)
      if (!slot)
        context.addIssue({
          code: 'custom',
          path: ['dataSources', index, 'credential'],
          message: `Data source ${source.id} names credential ${source.credential}, which no slot declares.`,
        })
      if (sources.has(source.id))
        context.addIssue({ code: 'custom', path: ['dataSources', index], message: `${source.id} is declared twice.` })
      sources.add(source.id)
      if (source.request.method === 'POST' && !source.readOnly)
        context.addIssue({
          code: 'custom',
          path: ['dataSources', index, 'readOnly'],
          message: 'A POST data source must be an endpoint that only reads; set readOnly to true once it is.',
        })
      const problem = slot ? requestProblem(source.request, slot) : null
      if (problem) context.addIssue({ code: 'custom', path: ['dataSources', index, 'request'], message: problem })
      for (const field of source.query)
        if (field.pattern && !validPattern(field.pattern))
          context.addIssue({
            code: 'custom',
            path: ['dataSources', index, 'query'],
            message: `${field.name}'s pattern is not a valid regular expression.`,
          })
    })
    value.credentials.forEach((slot, index) => {
      const problem = slot.check ? requestProblem(slot.check.request, slot) : null
      if (problem) context.addIssue({ code: 'custom', path: ['credentials', index, 'check'], message: problem })
      for (const pattern of [slot.pattern, ...slot.fields.map((field) => field.pattern)])
        if (pattern && !validPattern(pattern))
          context.addIssue({
            code: 'custom',
            path: ['credentials', index],
            message: `${pattern} is not a valid regular expression.`,
          })
    })
  })

function validPattern(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/** Why a request template could reach somewhere the slot does not name, or null when its origin is fixed. */
export function requestProblem(template: z.input<typeof request>, slot: PluginCredential): string | null {
  const field = /^\{field\.([a-z][a-z0-9_-]*)\}/.exec(template.url)?.[1]
  if (field) {
    const declared = slot.fields.find((entry) => entry.id === field)
    const instance = field === 'instance' && !!slot.signIn?.instanceField
    if (!instance && (!declared || declared.kind !== 'url'))
      return `{field.${field}} must be a url field of ${slot.id}.`
    return /\{[^}]*\}/.test(template.url.slice(`{field.${field}}`.length).split('?')[0]!.split('/')[0]!)
      ? 'The address after the url field may not add a host.'
      : null
  }
  let url: URL
  try {
    url = new URL(template.url.replace(/\{[^}]*\}/g, 'x'))
  } catch {
    return `${template.url} is not an address.`
  }
  if (url.protocol !== 'https:') return 'Data sources and checks call https addresses only.'
  return /\{/.test(template.url.split('/').slice(0, 3).join('/')) ? 'The host may not come from a value.' : null
}

// ---- The manifest ----

/** A server as `.mcp.json` declares it, the same shape Claude Code and Codex read. */
export const pluginMcpServer = z.union([
  z.object({
    command: text(500),
    args: z.array(z.string().max(1000)).max(60).default([]),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.string().max(2000)).default({}),
    cwd: z.string().max(500).optional(),
  }),
  z.object({
    type: z.enum(['http', 'sse', 'streamable-http']).optional(),
    url: z.string().trim().max(2000),
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,60}$/), z.string().max(2000)).default({}),
  }),
])
export type PluginMcpServer = z.infer<typeof pluginMcpServer>
export const mcpFile = z.object({
  mcpServers: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), pluginMcpServer),
})

export const pluginManifest = z.object({
  name: z.string().regex(PLUGIN_NAME, 'Name the plugin in lowercase words joined by dashes, such as render-deploy.'),
  version: z.string().trim().max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  author: person.optional(),
  homepage: z.string().trim().max(500).optional(),
  repository: z.union([z.string().trim().max(500), z.object({ url: z.string().max(500) })]).optional(),
  license: z.string().trim().max(100).optional(),
  keywords: z.array(z.string().max(60)).max(30).optional(),
  /** Inline servers, or the path of a `.mcp.json`-shaped file. */
  mcpServers: z.union([z.string().max(300), mcpFile.shape.mcpServers]).optional(),
  /** Parts Claude Code or Codex use that Ramu lists and never runs. */
  hooks: z.unknown().optional(),
  commands: z.unknown().optional(),
  lspServers: z.unknown().optional(),
  outputStyles: z.unknown().optional(),
  monitors: z.unknown().optional(),
  apps: z.unknown().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
})
export type PluginManifest = z.infer<typeof pluginManifest>

/** The manifest's JSON Schema, with Ramu's block in place, published at getramu.dev/schema/plugin.json for editors. */
export function pluginJsonSchema(): Record<string, unknown> {
  const schema = pluginManifest.extend({
    $schema: z.string().optional(),
    extensions: z
      .object({ [RAMU_EXTENSION]: ramuExtension.optional() })
      .catchall(z.unknown())
      .optional(),
  })
  return {
    ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
    $id: PLUGIN_SCHEMA_URL,
    title: 'Ramu plugin manifest',
  }
}
export type RamuExtension = z.infer<typeof ramuExtension>
export type PluginCredential = z.infer<typeof credential>
export type PluginCli = z.infer<typeof cli>
export type PluginDataSource = z.infer<typeof dataSource>
export type PluginQueryField = z.infer<typeof queryField>
export type PluginRequest = z.infer<typeof request>
export type PluginRows = z.infer<typeof rows>
export type PluginAbilities = Partial<Record<Ability, PluginAbility>>
export type PluginAbility = z.infer<typeof ability>

export const EMPTY_EXTENSION: RamuExtension = {
  credentials: [],
  abilities: {},
  dataSources: [],
  stacks: [],
  keywords: [],
}

export interface PluginProblem {
  file: string
  message: string
}

/** The manifest's Ramu block, validated; problems name the file and field. */
export function readRamuExtension(
  manifest: PluginManifest,
  file: string,
): { extension: RamuExtension; problems: PluginProblem[] } {
  const raw = manifest.extensions?.[RAMU_EXTENSION]
  if (raw === undefined) return { extension: EMPTY_EXTENSION, problems: [] }
  const parsed = ramuExtension.safeParse(raw)
  if (parsed.success) return { extension: parsed.data, problems: [] }
  return {
    extension: EMPTY_EXTENSION,
    problems: parsed.error.issues.map((issue) => ({
      file,
      message: `extensions["${RAMU_EXTENSION}"]${issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('')}: ${issue.message}`,
    })),
  }
}

/** Zod issues as one problem each, naming the field. */
export function manifestProblems(error: z.ZodError, file: string): PluginProblem[] {
  return error.issues.map((issue) => ({
    file,
    message: `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`,
  }))
}

// ---- Indexes ----

/** A plugin's source in an index: a GitHub repository, any Git URL, or a folder relative to the index. */
export const indexSource = z.union([
  z.string().max(500),
  z.object({
    source: z.literal('github'),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    ref: z.string().max(200).optional(),
    sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    path: z.string().max(300).optional(),
  }),
  z.object({
    source: z.enum(['url', 'git']),
    url: z.string().max(1000),
    ref: z.string().max(200).optional(),
    sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    path: z.string().max(300).optional(),
  }),
  z.object({
    source: z.literal('git-subdir'),
    url: z.string().max(1000),
    path: z.string().max(300),
    ref: z.string().max(200).optional(),
    sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
  }),
])
export type IndexSource = z.infer<typeof indexSource>

export const indexEntry = z.object({
  name: z.string().regex(PLUGIN_NAME),
  source: indexSource,
  description: z.string().max(1000).optional(),
  version: z.string().max(60).optional(),
  author: person.optional(),
  homepage: z.string().max(500).optional(),
  category: z.string().max(60).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  keywords: z.array(z.string().max(60)).max(30).optional(),
  /** Ramu's fields for the entry: who signs it and whether Akalstack maintains it. */
  extensions: z
    .object({
      [RAMU_EXTENSION]: z
        .object({
          /** The author's public signing key: an SSH public key line, or an armored GPG public key. */
          signingKey: z.string().max(20_000).optional(),
          byRamu: z.boolean().optional(),
          stacks: z.array(z.enum(STACK_IDS)).optional(),
          /** The service's own plugin in Claude's directory that this one pairs with. */
          companion: z.string().regex(PLUGIN_NAME).optional(),
          adds: z
            .object({
              skills: z.number().int().min(0).optional(),
              mcpServers: z.number().int().min(0).optional(),
              credentials: z.array(z.string().max(80)).max(PLUGIN_LIMITS.credentials).optional(),
              cli: z.string().max(60).optional(),
              abilities: z.array(z.string().max(40)).max(20).optional(),
              dataSources: z.array(z.string().max(40)).max(PLUGIN_LIMITS.dataSources).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .catchall(z.unknown())
    .optional(),
})
export type IndexEntry = z.infer<typeof indexEntry>

/** `.claude-plugin/marketplace.json`: the same file is a Claude Code marketplace and a Ramu index. */
export const marketplaceFile = z.object({
  name: z.string().regex(PLUGIN_NAME),
  owner: person.optional(),
  metadata: z
    .object({
      description: z.string().max(1000).optional(),
      version: z.string().max(60).optional(),
      pluginRoot: z.string().max(300).optional(),
    })
    .optional(),
  plugins: z.array(indexEntry).max(2000),
})
export type MarketplaceFile = z.infer<typeof marketplaceFile>

/**
 * A marketplace read entry by entry, so one listing Ramu cannot use (a source it does not fetch, a field past a limit)
 * is skipped instead of hiding the whole index. Over-long descriptions are shortened rather than refused.
 */
export function readMarketplace(json: unknown): {
  name: string
  pluginRoot?: string
  plugins: IndexEntry[]
  skipped: string[]
} {
  const head = marketplaceFile.omit({ plugins: true }).parse(json)
  const raw = (json as { plugins?: unknown }).plugins
  if (!Array.isArray(raw)) throw new Error('The marketplace lists no plugins.')
  const plugins: IndexEntry[] = []
  const skipped: string[] = []
  for (const item of raw.slice(0, 2000)) {
    const entry =
      item && typeof item === 'object' && typeof (item as { description?: unknown }).description === 'string'
        ? { ...item, description: shorten((item as { description: string }).description, 1000) }
        : item
    const parsed = indexEntry.safeParse(entry)
    if (parsed.success) plugins.push(parsed.data)
    else skipped.push(String((item as { name?: unknown })?.name ?? '?').slice(0, 100))
  }
  return {
    name: head.name,
    ...(head.metadata?.pluginRoot ? { pluginRoot: head.metadata.pluginRoot } : {}),
    plugins,
    skipped,
  }
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The Git URL and folder an index entry points to. Relative paths resolve against the index's own repository. */
export function resolveIndexSource(
  source: IndexSource,
  index: { url: string; pluginRoot?: string },
): { url: string; path: string; ref?: string; sha?: string } {
  if (typeof source === 'string') {
    if (/^(https?:\/\/|git@|ssh:\/\/)/.test(source)) return { url: source, path: '' }
    const root = index.pluginRoot?.replace(/^\.\/?/, '').replace(/\/$/, '')
    const path = source.replace(/^\.\/?/, '')
    return { url: index.url, path: root && !path.startsWith(`${root}/`) ? `${root}/${path}` : path }
  }
  if (source.source === 'github')
    return { url: `https://github.com/${source.repo}`, path: source.path ?? '', ref: source.ref, sha: source.sha }
  return { url: source.url, path: source.path ?? '', ref: source.ref, sha: source.sha }
}

// ---- What the host reports ----

/** Parts a plugin brings that Ramu lists and never runs. */
export const UNUSED_PARTS = ['hooks', 'commands', 'lspServers', 'outputStyles', 'monitors', 'apps'] as const
export type UnusedPart = (typeof UNUSED_PARTS)[number]
export const UNUSED_PART_NAMES: Record<UnusedPart, string> = {
  hooks: 'Hooks',
  commands: 'Slash commands',
  lspServers: 'Language servers',
  outputStyles: 'Output styles',
  monitors: 'Monitors',
  apps: 'App connectors',
}

/** Everything a plugin would add, as the install review and the card show it. */
export interface PluginContents {
  name: string
  version: string | null
  description: string
  author: string | null
  homepage: string | null
  license: string | null
  /** The manifest file that was read. */
  manifest: string
  skills: { name: string; description: string; files: string[]; scripts: string[] }[]
  mcpServers: (
    | { name: string; type: 'stdio'; command: string; args: string[]; envKeys: string[] }
    | { name: string; type: 'http'; url: string; headerKeys: string[] }
  )[]
  agents: { name: string; description: string; readOnly: boolean }[]
  rule: { file: string; bytes: number } | null
  credentials: {
    id: string
    label: string
    kind: 'token' | 'sign-in'
    env: string
    page: string | null
    scope: string | null
    fields: { id: string; label: string; kind: 'text' | 'url' | 'secret'; values?: string[] }[]
  }[]
  cli: { binaries: string[]; npx: string | null; reads: string[] } | null
  abilities: ({ ability: Ability } & Omit<PluginAbility, never>)[]
  dataSources: { id: string; label: string; credential: string }[]
  stacks: string[]
  unused: UnusedPart[]
  requires: string | null
  problems: PluginProblem[]
}

export type PluginScope =
  { kind: 'all' } | { kind: 'project'; projectId: string } | { kind: 'identity'; identityId: string }

export interface PluginSourceInfo {
  kind: 'git' | 'folder' | 'development'
  /** The Git URL, or the folder on the host. */
  location: string
  /** A folder within the repository, for a plugin in a subfolder of an index. */
  path: string
  /** The pinned commit; null for folders. */
  commit: string | null
  /** The index it was installed from, when it was. */
  index: string | null
  signedBy: string | null
}

export type PluginCredentialState = 'missing' | 'saved' | 'failed'

export interface InstalledPlugin {
  id: string
  name: string
  contents: PluginContents
  source: PluginSourceInfo
  scope: PluginScope
  installedAt: number
  updatedAt: number
  enabled: boolean
  /** The MCP connections it added, by the server's name in the plugin, whose tools are chosen in MCP servers. */
  mcpConnections: { name: string; id: string }[]
  credentials: {
    id: string
    label: string
    state: PluginCredentialState
    account: string | null
    identities: string[]
  }[]
  /** What an update would change, when the daily check found one. */
  update: PluginUpdate | null
  byRamu: boolean
  /** Its author's GitHub picture, for a service Ramu has no mark of its own for. */
  picture: string | null
  /**
   * The plugin it pairs with, and whether that is installed: for Ramu's own, the service's plugin in Claude's directory;
   * for that one, Ramu's that connects it.
   */
  companion: { index: string; name: string; installed: boolean } | null
}

export interface PluginUpdate {
  commit: string
  checkedAt: number
  /** One line per change, such as "Skill render-deploy changed" or "MCP server render now runs npx render-mcp@2". */
  changes: string[]
  /** A change to an MCP command, a credential slot, a read-only prefix or a script: the update asks for approval again. */
  needsApproval: boolean
}

/** A plugin waiting for the person's review, before anything is saved. */
export interface PluginReview {
  stageId: string
  contents: PluginContents
  source: PluginSourceInfo
  /** Set when this review updates an installed plugin. */
  replaces: string | null
  changes: string[]
  needsApproval: boolean
  byRamu: boolean
  /** Why the plugin cannot be installed as it is, such as a newer Ramu requirement; the review shows it and disables Install. */
  blocked: string | null
}

export interface PluginListing {
  index: string
  indexName: string
  name: string
  description: string
  source: string
  commit: string | null
  byRamu: boolean
  signed: boolean
  stacks: string[]
  keywords: string[]
  /** The index's category for it, such as development or productivity. */
  category: string | null
  /** Its author's GitHub picture, for a service Ramu has no mark of its own for. */
  picture: string | null
  installed: boolean
  /** The same plugin name in other indexes; the card shows the first listing and offers these instead. */
  alternatives: { index: string; indexName: string; source: string }[]
  /**
   * The plugin it pairs with: for Ramu's own, the service's plugin in Claude's directory that teaches agents the
   * service; for that one, Ramu's that connects it (sign-in, safe commands, dashboard data).
   */
  companion: { index: string; name: string } | null
}

/** Whether a listing matches what the person typed: every word appears in its name, description, keywords or stacks. */
export function listingMatches(listing: PluginListing, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [listing.name, listing.description, ...listing.keywords, ...listing.stacks].join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export interface PluginIndexInfo {
  url: string
  name: string
  builtIn: boolean
  checkedAt: number | null
  error: string | null
  count: number
  /** Listings Ramu could not read, left out of Browse. */
  skipped: number
}

/** The link getramu.dev/plugins opens: the install review for one source. */
export function pluginInstallLink(source: string, index?: string): string {
  const params = new URLSearchParams({ source })
  if (index) params.set('index', index)
  return `ramu://plugin/install?${params.toString()}`
}

export function parseInstallLink(link: string): { source: string; index: string | null } | null {
  try {
    const url = new URL(link)
    if (url.protocol !== 'ramu:' || `${url.host}${url.pathname}` !== 'plugin/install') return null
    const source = url.searchParams.get('source')
    return source ? { source, index: url.searchParams.get('index') } : null
  } catch {
    return null
  }
}

/** Reads a dot path (`results.A.frames.0`) in a parsed response. */
export function readPath(value: unknown, path: string): unknown {
  if (!path) return value
  let current = value
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = Array.isArray(current) ? current[Number(part)] : (current as Record<string, unknown>)[part]
  }
  return current
}

type Cell = string | number | boolean | null
const cell = (value: unknown): Cell =>
  value === null || value === undefined
    ? null
    : typeof value === 'number' || typeof value === 'boolean'
      ? value
      : typeof value === 'string'
        ? value.slice(0, 500)
        : JSON.stringify(value).slice(0, 500)

/**
 * A data source's response as rows of the columns a table asks for, at most `limit`. Object rows are read by dot path,
 * so `Account.Name` follows a relationship; columns and series rows have the names their shape gives them.
 */
export function dataSourceRows(
  response: unknown,
  shape: PluginRows,
  columns: readonly string[],
  limit: number,
  query: Record<string, unknown> = {},
): Record<string, Cell>[] {
  const pick = (entry: unknown) => Object.fromEntries(columns.map((column) => [column, cell(readPath(entry, column))]))
  if (shape.shape === 'objects') {
    const list = readPath(response, shape.path)
    return Array.isArray(list) ? list.slice(0, limit).map(pick) : []
  }
  if (shape.shape === 'columns') {
    const names = readPath(response, shape.names)
    const values = readPath(response, shape.values)
    if (!Array.isArray(names) || !Array.isArray(values)) return []
    const fields = names.map((name) =>
      String(
        shape.nameKey && name && typeof name === 'object' ? (name as Record<string, unknown>)[shape.nameKey] : name,
      ),
    )
    const count = Math.min(limit, Math.max(0, ...values.map((column) => (Array.isArray(column) ? column.length : 0))))
    return Array.from({ length: count }, (_, row) =>
      pick(Object.fromEntries(fields.map((field, index) => [field, (values[index] as unknown[] | undefined)?.[row]]))),
    )
  }
  const dates = readPath(response, shape.dates)
  const series = readPath(response, shape.values)
  const labels = shape.labels ? readPath(response, shape.labels) : undefined
  if (!Array.isArray(dates) || !Array.isArray(series)) return []
  const fallback = shape.label ? fillTemplate(shape.label, { token: '', fields: {}, query }) : null
  const out: Record<string, Cell>[] = []
  series.forEach((values, index) => {
    if (!Array.isArray(values)) return
    const given = Array.isArray(labels) ? labels[index] : undefined
    const label = given === undefined || given === null || given === 0 || given === '' ? fallback : cell(given)
    values.forEach((value, at) => {
      if (out.length >= limit || at >= dates.length) return
      const point = value && typeof value === 'object' && 'value' in value ? (value as { value: unknown }).value : value
      out.push(pick({ date: dates[at], series: label, value: point }))
    })
  })
  return out
}

/**
 * Fills a template string: `{token}`, `{field.<id>}`, `{query.<name>}`, `{basic.<id>}` (HTTP Basic credentials: the
 * token and that field joined by a colon, base64-encoded), `{date.today}` and `{date.since.<name>}` (today, and the day
 * that query field's count of days back starts, as YYYYMMDD in UTC). A `:json` suffix writes the value as JSON, for a
 * value placed inside a JSON string such as Amplitude's `e={"event_type":{query.event:json}}`.
 */
export function fillTemplate(
  template: string,
  values: { token: string; fields: Record<string, string>; query?: Record<string, unknown>; now?: Date },
  encode: (value: string) => string = (value) => value,
): string {
  return template.replace(
    /\{(token|field\.[a-z][a-z0-9_-]*|basic\.[a-z][a-z0-9_-]*|query\.[A-Za-z][A-Za-z0-9_]*|date\.today|date\.since\.[A-Za-z][A-Za-z0-9_]*)(:json)?\}/g,
    (_, key: string, json?: string) => {
      const out = (value: unknown) =>
        encode(
          json
            ? JSON.stringify(value ?? null)
            : value === undefined || value === null
              ? ''
              : typeof value === 'string'
                ? value
                : JSON.stringify(value),
        )
      if (key === 'token') return out(values.token)
      if (key.startsWith('field.')) return out(values.fields[key.slice(6)] ?? '')
      if (key.startsWith('basic.')) return base64(`${values.token}:${values.fields[key.slice(6)] ?? ''}`)
      if (key.startsWith('date.')) {
        const now = values.now ?? new Date()
        const days = key === 'date.today' ? 1 : Math.max(1, Number(values.query?.[key.slice(11)]) || 1)
        return out(new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ''))
      }
      return out(values.query?.[key.slice(6)])
    },
  )
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * A JSON body template with every string filled; a string that is exactly `{query.x}` keeps the value's own type, and
 * a `"..."` key merges that object into its parent.
 */
export function fillBody(
  body: unknown,
  values: { token: string; fields: Record<string, string>; query?: Record<string, unknown> },
): unknown {
  if (typeof body === 'string') {
    const whole = /^\{query\.([A-Za-z][A-Za-z0-9_]*)\}$/.exec(body)
    if (whole) return values.query?.[whole[1]!] ?? null
    return fillTemplate(body, values)
  }
  if (Array.isArray(body)) return body.map((entry) => fillBody(entry, values))
  if (body && typeof body === 'object') {
    // `"...": "{query.x}"` merges an object field into this one, as Grafana takes a data source's own query fields.
    const { '...': spread, ...rest } = body as Record<string, unknown>
    const merged = spread === undefined ? {} : fillBody(spread, values)
    return {
      ...(merged && typeof merged === 'object' && !Array.isArray(merged) ? merged : {}),
      ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, fillBody(value, values)])),
    }
  }
  return body
}

/** A data source's query as its fields allow, or the first problem. Unknown fields are refused, not dropped. */
export function checkQuery(
  fields: readonly PluginQueryField[],
  input: Record<string, unknown>,
): { ok: true; query: Record<string, unknown> } | { ok: false; error: string } {
  const known = new Set(fields.map((field) => field.name))
  const unknown = Object.keys(input).find((key) => !known.has(key) && key !== 'columns' && key !== 'id')
  if (unknown) return { ok: false, error: `${unknown} is not a field of this data source.` }
  const query: Record<string, unknown> = {}
  for (const field of fields) {
    const value = input[field.name] ?? field.default
    if (value === undefined) {
      if (field.required) return { ok: false, error: `${field.name} is required.` }
      continue
    }
    if (field.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return { ok: false, error: `${field.name} must be an object.` }
      if (JSON.stringify(value).length > field.maxLength)
        return { ok: false, error: `${field.name} is longer than ${field.maxLength} characters.` }
    } else if (typeof value !== field.type) return { ok: false, error: `${field.name} must be a ${field.type}.` }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { ok: false, error: `${field.name} must be a number.` }
      if (field.min !== undefined && value < field.min)
        return { ok: false, error: `${field.name} is below ${field.min}.` }
      if (field.max !== undefined && value > field.max)
        return { ok: false, error: `${field.name} is above ${field.max}.` }
    }
    if (typeof value === 'string') {
      if (value.length > field.maxLength)
        return { ok: false, error: `${field.name} is longer than ${field.maxLength} characters.` }
      if (field.pattern && !new RegExp(field.pattern, 'i').test(value))
        return { ok: false, error: `${field.name} does not match what this data source allows.` }
    }
    if (field.values && !field.values.includes(value as string | number))
      return { ok: false, error: `${field.name} must be one of ${field.values.join(', ')}.` }
    query[field.name] = value
  }
  return { ok: true, query }
}

/** Repository owners that publish other people's plugins, whose own picture would not stand for the plugin. */
const DIRECTORY_OWNERS = new Set(['anthropics', 'akalstack'])

/**
 * The picture a plugin's card shows when Ramu has no mark of its own for the service: the GitHub account its source
 * lives under, which for a vendor's plugin is the vendor's logo. A plugin kept inside a directory gets none.
 */
export function pluginPicture(source: string): string | null {
  const match = /^(?:https?:\/\/|git@)github\.com[/:]([A-Za-z0-9-]{1,39})\//.exec(source.trim())
  const owner = match?.[1]
  return owner && !DIRECTORY_OWNERS.has(owner.toLowerCase())
    ? `https://avatars.githubusercontent.com/${owner}?size=96`
    : null
}
