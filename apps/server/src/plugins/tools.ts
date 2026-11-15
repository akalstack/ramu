// What an agent can do with plugins: search the indexes when a task needs a service Ramu does not know, and ask the
// person to install one. The install is the same review as in Settings, shown as a card the agent cannot answer, on
// the desktop or a phone; a credential is never pasted through the agent.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { PLUGIN_NAME, RAMU_EXTENSION, UNUSED_PART_NAMES, type PluginReview } from '@ramu/shared/plugins'
import { checkPlugin, newPlugin } from './authoring'
import type { PluginService } from './service'

/** Where plugins an agent drafts are kept, one folder each, outside any project. */
export const draftPluginsFolder = () => join(homedir(), 'Ramu Plugins')

/** The review in plain words, as the approval card names it. */
export function reviewText(review: PluginReview): string {
  const { contents, source } = review
  const lines = [
    `Install the ${contents.name} plugin${contents.author ? ` by ${contents.author}` : ''}${review.byRamu ? ' (By Ramu)' : ''}?`,
    contents.description,
    `Source: ${source.location}${source.path ? ` (${source.path})` : ''}${source.commit ? ` at ${source.commit.slice(0, 12)}` : ''}${contents.license ? `, ${contents.license} license` : ''}. ${source.signedBy ? `Signed by ${source.signedBy}.` : 'Unsigned.'}`,
  ]
  if (contents.skills.length) lines.push(`Skills: ${contents.skills.map((skill) => skill.name).join(', ')}.`)
  for (const server of contents.mcpServers)
    lines.push(
      server.type === 'stdio'
        ? `MCP server ${server.name} runs: ${[server.command, ...server.args].join(' ')}`
        : `MCP server ${server.name} at ${server.url}`,
    )
  if (contents.agents.length) lines.push(`Custom agents: ${contents.agents.map((agent) => agent.name).join(', ')}.`)
  if (contents.rule) lines.push('A rule from its AGENTS.md.')
  if (contents.credentials.length)
    lines.push(
      `Asks for: ${contents.credentials.map((slot) => slot.label).join(', ')} (pasted in Customize → Plugins).`,
    )
  if (contents.cli)
    lines.push(
      `CLI ${contents.cli.binaries[0]}; runs without asking: ${contents.cli.reads.length ? contents.cli.reads.join(', ') : 'nothing'}.`,
    )
  if (contents.abilities.length)
    lines.push(`Abilities: ${contents.abilities.map((entry) => entry.ability.replace(/_/g, ' ')).join(', ')}.`)
  if (contents.unused.length)
    lines.push(`Not used in Ramu: ${contents.unused.map((part) => UNUSED_PART_NAMES[part]).join(', ')}.`)
  if (review.changes.length) lines.push(`Changes: ${review.changes.join('; ')}.`)
  return lines.filter(Boolean).join('\n')
}

export function registerPluginTools(
  server: McpServer,
  plugins: Pick<PluginService, 'browse' | 'stage' | 'confirm' | 'cancel' | 'list'>,
  /** Asks the person through the thread's approval card. Resolves false when refused. */
  requestApproval: (detail: string, signal?: AbortSignal) => Promise<boolean>,
  installed: (pluginId: string) => void,
  drafts: () => string = draftPluginsFolder,
  /** Keeps a plugin on every host the person connects, as **Available on → All your hosts** does. */
  keepOnAllHosts?: (name: string) => void,
) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'plugin_search',
    {
      description:
        'Search the plugin indexes for a service this task needs that Ramu does not know (a hosting platform, an analytics or issue tracker, an image service). Returns each listed plugin with its source and whether it is installed. Suggest one only when the task needs it, then call plugin_install. When nothing fits, offer plugin_create.',
      inputSchema: { query: z.string().trim().min(1).max(200) },
    },
    async ({ query }: { query: string }) => {
      const listings = await plugins.browse(query)
      return result({
        plugins: listings.slice(0, 20).map((listing) => ({
          name: listing.name,
          description: listing.description,
          index: listing.indexName,
          byRamu: listing.byRamu,
          signed: listing.signed,
          installed: listing.installed,
        })),
      })
    },
  )
  server.registerTool(
    'plugin_install',
    {
      description:
        'Ask the person to install a plugin found with plugin_search. They see the full review (skills, MCP servers and the commands they run, the credential asked for, commands that run without asking) and decide; you cannot approve it, and a refusal is final for this request. A credential the plugin needs is pasted by the person in Customize → Plugins on the host, never through you. New tools from it reach threads started after the install.',
      inputSchema: {
        name: z.string().trim().min(1).max(64),
        hosts: z
          .enum(['this', 'all'])
          .optional()
          .describe(
            '"all" when the person asked for it on all their hosts: each other host gets it to review there, and adds its own key.',
          ),
      },
    },
    async ({ name, hosts }: { name: string; hosts?: 'this' | 'all' }, extra) => {
      const everywhere = hosts === 'all' && !!keepOnAllHosts
      if (plugins.list().some((plugin) => plugin.name === name)) {
        if (everywhere) {
          if (
            !(await requestApproval(
              `Keep the ${name} plugin on all your hosts? Each host reviews it and adds its own key.`,
              extra.signal,
            ))
          )
            throw new Error('The person declined. Do not retry it without a new request.')
          keepOnAllHosts(name)
        }
        return result({ installed: true, name, ...(everywhere ? { hosts: 'all' } : {}) })
      }
      const listing = (await plugins.browse(name)).find((entry) => entry.name === name)
      if (!listing) throw new Error(`${name} is not listed in any plugin index. Call plugin_search first.`)
      const review = await plugins.stage({ source: listing.name, index: listing.index })
      try {
        if (review.blocked) throw new Error(review.blocked)
        const card = everywhere
          ? `${reviewText(review)}\nAlso on all your hosts: each one reviews it there and adds its own key.`
          : reviewText(review)
        if (!(await requestApproval(card, extra.signal)))
          throw new Error('The person declined the install. Do not retry it without a new request.')
        const scripts = review.contents.skills.some((skill) => skill.scripts.length)
          ? await requestApproval(
              `Also install the scripts in ${name}'s skills? ${review.contents.skills
                .flatMap((skill) => skill.scripts.map((path) => `${skill.name}/${path}`))
                .join(', ')}`,
              extra.signal,
            )
          : false
        const plugin = await plugins.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: scripts })
        installed(plugin.id)
        if (everywhere) keepOnAllHosts(plugin.name)
        const missing = plugin.credentials.filter((slot) => slot.state !== 'saved').map((slot) => slot.label)
        return result({
          installed: true,
          name,
          ...(everywhere ? { hosts: 'all' } : {}),
          next: missing.length
            ? `Ask the person to add ${missing.join(' and ')} for ${name} in Customize → Plugins on the host.`
            : null,
        })
      } catch (error) {
        await plugins.cancel(review.stageId).catch(() => {})
        throw error
      }
    },
  )
  server.registerTool(
    'plugin_create',
    {
      description: `Make a plugin for a service no index lists, when the person asks for one ("connect Rodin for 3D models"). step "start" writes a working folder in ~/Ramu Plugins/<name> (mcp: true adds a Node MCP server, cli: true a CLI); then write its .claude-plugin/plugin.json, server and skill from the service's own documentation with your file tools. Declare the API key as a credential slot whose env the server reads, never a value; map an ability under extensions["${RAMU_EXTENSION}"].abilities (model_3d needs a tool, a status tool for its task id, a balance tool, and downloads: the https origins its files come from). step "check" starts the servers and lists every problem with its file; fix them until it passes. step "install" asks the person through the plugin review card and installs it as a Development plugin whose abilities are used at once. The person pastes the key on the plugin's card in Customize → Plugins; you never see it.`,
      inputSchema: {
        name: z.string().regex(PLUGIN_NAME).describe('Lowercase words joined by dashes, such as rodin-3d.'),
        step: z.enum(['start', 'check', 'install']),
        mcp: z.boolean().optional(),
        cli: z.boolean().optional(),
      },
    },
    async (
      { name, step, mcp, cli }: { name: string; step: 'start' | 'check' | 'install'; mcp?: boolean; cli?: boolean },
      extra,
    ) => {
      const folder = join(drafts(), name)
      if (step === 'start') {
        if (existsSync(folder))
          return result({
            folder,
            next: 'This plugin folder already exists. Edit it, then call plugin_create with step "check".',
          })
        newPlugin(drafts(), name, { mcp: mcp ?? true, cli: cli ?? false })
        return result({
          folder,
          next: 'Write the manifest, the MCP server or CLI entry and the skill in this folder, then call plugin_create with step "check".',
        })
      }
      if (!existsSync(folder)) throw new Error(`${folder} does not exist. Call plugin_create with step "start" first.`)
      const report = await checkPlugin(folder)
      if (step === 'check' || report.problems.length)
        return result({
          folder,
          passed: !report.problems.length,
          problems: report.problems,
          servers: report.servers,
          ...(step === 'install' && report.problems.length ? { next: 'Fix these problems before installing.' } : {}),
        })
      const review = await plugins.stage({ source: folder })
      try {
        if (review.blocked) throw new Error(review.blocked)
        if (!(await requestApproval(`${reviewText(review)}\nMade in this thread, in ${folder}.`, extra.signal)))
          throw new Error('The person declined the install. Do not retry it without a new request.')
        const plugin = await plugins.confirm(review.stageId, {
          scope: { kind: 'all' },
          includeScripts: false,
          development: true,
          offerAbilities: true,
        })
        installed(plugin.id)
        const missing = plugin.credentials.filter((slot) => slot.state !== 'saved').map((slot) => slot.label)
        return result({
          installed: true,
          name,
          next: [
            missing.length
              ? `Ask the person to add ${missing.join(' and ')} for ${name} in Customize → Plugins on the host.`
              : '',
            'Its tools reach threads started after the install. Share on its card in Customize → Plugins pushes it to their own repository.',
          ]
            .filter(Boolean)
            .join(' '),
        })
      } catch (error) {
        await plugins.cancel(review.stageId).catch(() => {})
        throw error
      }
    },
  )
}
