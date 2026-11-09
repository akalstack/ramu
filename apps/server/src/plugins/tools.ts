// What an agent can do with plugins: search the indexes when a task needs a service Ramu does not know, and ask the
// person to install one. The install is the same review as in Settings, shown as a card the agent cannot answer, on
// the desktop or a phone; a credential is never pasted through the agent.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { UNUSED_PART_NAMES, type PluginReview } from '@ramu/shared/plugins'
import type { PluginService } from './service'

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
    lines.push(`Asks for: ${contents.credentials.map((slot) => slot.label).join(', ')} (pasted in Settings → Plugins).`)
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
) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'plugin_search',
    {
      description:
        'Search the plugin indexes for a service this task needs that Ramu does not know (a hosting platform, an analytics or issue tracker, an image service). Returns each listed plugin with its source and whether it is installed. Suggest one only when the task needs it, then call plugin_install.',
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
        'Ask the person to install a plugin found with plugin_search. They see the full review (skills, MCP servers and the commands they run, the credential asked for, commands that run without asking) and decide; you cannot approve it, and a refusal is final for this request. A credential the plugin needs is pasted by the person in Settings → Plugins on the host, never through you. New tools from it reach threads started after the install.',
      inputSchema: { name: z.string().trim().min(1).max(64) },
    },
    async ({ name }: { name: string }, extra) => {
      if (plugins.list().some((plugin) => plugin.name === name)) return result({ installed: true, name })
      const listing = (await plugins.browse(name)).find((entry) => entry.name === name)
      if (!listing) throw new Error(`${name} is not listed in any plugin index. Call plugin_search first.`)
      const review = await plugins.stage({ source: listing.name, index: listing.index })
      try {
        if (review.blocked) throw new Error(review.blocked)
        if (!(await requestApproval(reviewText(review), extra.signal)))
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
        const missing = plugin.credentials.filter((slot) => slot.state !== 'saved').map((slot) => slot.label)
        return result({
          installed: true,
          name,
          next: missing.length
            ? `Ask the person to add ${missing.join(' and ')} for ${name} in Settings → Plugins on the host.`
            : null,
        })
      } catch (error) {
        await plugins.cancel(review.stageId).catch(() => {})
        throw error
      }
    },
  )
}
