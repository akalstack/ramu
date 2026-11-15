// `ramu tools`: what other hosts sent this host, reviewed in a terminal on a host with no desktop app. Each install is
// the same review Customize shows, answered here; keys are typed here and never echoed or sent anywhere else.
import type { InstalledPlugin, PluginListing, PluginReview } from '@ramu/shared/plugins'
import type { SharedMcpConnection, SharedMcpManagement } from '@ramu/shared/mcp'
import { mcpLogins, type PortableTool, type ToolSyncStatus, type WaitingTool } from '@ramu/shared/toolSync'
import type { AppPreferences, LearningSnapshot, SkillInstallPreview } from '@ramu/shared/types'
import type { IdentitySnapshot } from '@ramu/shared/identities'
import { reviewText } from './plugins/tools'

export type ToolsCall = <T>(method: string, args?: unknown[]) => Promise<T>

export interface ToolsTerminal {
  print(line: string): void
  /** A yes or no question; true only for an explicit yes. */
  confirm(question: string): Promise<boolean>
  /** Reads a value without showing it, such as a key; empty skips it. */
  secret(question: string): Promise<string>
}

const KIND: Record<PortableTool['kind'], string> = { plugin: 'plugin', skill: 'skill', mcp: 'MCP server' }

const describe = (entry: WaitingTool) =>
  entry.state === 'remove'
    ? `removed on ${entry.from}: ramu tools remove ${entry.tool.name}`
    : `from ${entry.from}${entry.state === 'update' ? ', another version than here' : ''}${
        entry.state === 'connect-here' && entry.tool.kind === 'mcp' && entry.tool.transport.type === 'stdio'
          ? `, needs ${entry.tool.transport.command} here`
          : ''
      }: ramu tools install ${entry.tool.name}`

/** The waiting tool a name means: its name, or `kind:name` when two kinds share one. */
function pick(waiting: WaitingTool[], name: string | undefined, removal: boolean) {
  if (!name)
    throw new Error(`Name the tool: ramu tools ${removal ? 'remove' : 'install'} <name>. ramu tools lists them.`)
  const matching = waiting.filter(
    (entry) => (entry.key === name || entry.tool.name === name) && (entry.state === 'remove') === removal,
  )
  if (matching.length > 1)
    throw new Error(`Several tools are named ${name}. Use ${matching.map((entry) => entry.key).join(' or ')}.`)
  if (!matching[0]) throw new Error(`Nothing named ${name} is waiting here. ramu tools lists what is.`)
  return matching[0]
}

/**
 * Signs this host in to a server that uses OAuth, with the sign-in page opened on any device, such as a phone. A host
 * with an HTTPS address finishes by itself; otherwise the page the service redirects to does not load on that device,
 * and its address is pasted here, where the same one-time checks apply as on the host.
 */
async function signIn(serverName: string | undefined, call: ToolsCall, io: ToolsTerminal) {
  if (!serverName) throw new Error('Name the server: ramu tools sign-in <name>.')
  const server = (await call<SharedMcpManagement>('mcp.status')).connections.find(
    (entry) => entry.connection.name === serverName,
  )
  if (!server) throw new Error(`No MCP server named ${serverName} is on this host.`)
  if (server.connection.transport.type !== 'http') throw new Error(`${serverName} runs here and has no sign-in.`)
  const started = await call<{ url: string } | null>('mcp.signIn', [server.connection.id])
  if (!started) {
    io.print(`${serverName} is signed in.`)
    return
  }
  io.print(`Open this page on any device, such as your phone, and sign in:\n${started.url}`)
  const redirect = new URL(started.url).searchParams.get('redirect_uri') ?? ''
  if (redirect.startsWith('https://')) {
    io.print(`Ramu finishes the sign-in when the page says so. Then: ramu tools list.`)
    return
  }
  const address = await io.secret(
    'After signing in, the page fails to load. Paste its address from the address bar (leave empty to stop): ',
  )
  if (!address) {
    await call('mcp.cancelSignIn', [server.connection.id])
    return
  }
  const done = await call<boolean>('mcp.completeSignIn', [server.connection.id, address])
  if (!done) throw new Error('That address does not finish this sign-in. Start again with ramu tools sign-in.')
  io.print(`Signed in to ${serverName}.`)
}

/** Runs `ramu tools [list|install|remove|dismiss|sign-in] [name]` against the running host. */
export async function toolsCommand(action: string, name: string | undefined, call: ToolsCall, io: ToolsTerminal) {
  if (action === 'sign-in') return signIn(name, call, io)
  const status = await call<ToolSyncStatus>('toolSync.status')
  if (action === 'list') {
    if (!status.waiting.length) {
      io.print('Nothing from your other hosts is waiting here.')
      return
    }
    for (const entry of status.waiting) io.print(`${entry.tool.name} (${KIND[entry.tool.kind]}) ${describe(entry)}`)
    return
  }
  if (action === 'dismiss') {
    const entry = status.waiting.find((item) => item.key === name || item.tool.name === name)
    if (!entry) throw new Error(`Nothing named ${name ?? ''} is waiting here.`)
    await call('toolSync.dismiss', [entry.key])
    io.print(`Dismissed ${entry.tool.name}. A newer version from ${entry.from} comes back.`)
    return
  }
  if (action === 'remove') {
    const entry = pick(status.waiting, name, true)
    if (!(await io.confirm(`Remove ${entry.tool.name} (${KIND[entry.tool.kind]}) here, as on ${entry.from}?`))) return
    await removeHere(entry.tool, entry.projectId ?? null, call)
    io.print(`Removed ${entry.tool.name}.`)
    return
  }
  if (action !== 'install') throw new Error('Use ramu tools, ramu tools install|remove|dismiss|sign-in <name>.')
  const entry = pick(status.waiting, name, false)
  if (entry.tool.kind === 'plugin') await installPlugin(entry, entry.tool, call, io)
  else if (entry.tool.kind === 'skill') await installSkill(entry.tool, entry.projectId ?? null, call, io)
  else await addServer(entry, call, io)
}

async function removeHere(tool: PortableTool, projectId: string | null, call: ToolsCall) {
  if (tool.kind === 'plugin') {
    const plugin = (await call<InstalledPlugin[]>('plugins.list')).find((item) => item.name === tool.name)
    if (plugin) await call('plugins.remove', [plugin.id])
  } else if (tool.kind === 'skill') {
    const skill = (await call<LearningSnapshot>('learning.get')).skills.find(
      (item) =>
        item.name === tool.name &&
        (item.projectId ?? null) === projectId &&
        !item.installation?.source.startsWith('plugin:'),
    )
    if (skill) await call('skills.remove', [skill.id])
  } else {
    const plugins = await call<InstalledPlugin[]>('plugins.list')
    const owned = new Set(plugins.flatMap((plugin) => plugin.mcpConnections.map((server) => server.id)))
    const server = (await call<SharedMcpManagement>('mcp.status')).connections.find(
      (item) => item.connection.name === tool.name && !item.connection.split && !owned.has(item.connection.id),
    )
    if (server) await call('mcp.remove', [server.connection.id])
  }
}

/** Turns a server on for every signed-in login it is offered to; the host applies the other host's tool choices. */
async function turnOn(connection: Pick<SharedMcpConnection, 'id' | 'providers'>, call: ToolsCall) {
  const logins = mcpLogins(await call<AppPreferences>('settings.app.get'), connection)
  if (!logins.length) return false
  await call('mcp.turnOn', [connection.id, logins])
  return true
}

async function installPlugin(
  entry: WaitingTool,
  tool: Extract<PortableTool, { kind: 'plugin' }>,
  call: ToolsCall,
  io: ToolsTerminal,
) {
  const installed = (await call<InstalledPlugin[]>('plugins.list')).find((plugin) => plugin.name === tool.name)
  const listing = (await call<PluginListing[]>('plugins.browse', [tool.name])).find(
    (item) => item.name === tool.name && item.index === tool.index,
  )
  const review = installed
    ? await call<PluginReview>('plugins.updateReview', [installed.id, ...(tool.commit ? [tool.commit] : [])])
    : await call<PluginReview>('plugins.stage', [
        listing
          ? { source: listing.name, index: listing.index, ...(tool.commit ? { commit: tool.commit } : {}) }
          : {
              source: tool.location,
              ...(tool.commit ? { ref: tool.commit } : {}),
              ...(tool.path ? { path: tool.path } : {}),
            },
      ])
  try {
    io.print(reviewText(review))
    if (review.blocked) throw new Error(review.blocked)
    if (!(await io.confirm(`${installed ? 'Update' : 'Install'} ${tool.name}, as on ${entry.from}?`))) {
      await call('plugins.cancel', [review.stageId])
      return
    }
    const scripts = review.contents.skills.flatMap((skill) => skill.scripts.map((path) => `${skill.name}/${path}`))
    const includeScripts =
      scripts.length > 0 && (await io.confirm(`Also install the scripts in its skills? ${scripts.join(', ')}`))
    const identity = tool.identityId
      ? (await call<IdentitySnapshot>('identities.get')).settings.identities.find((item) => item.id === tool.identityId)
      : undefined
    const plugin = await call<InstalledPlugin>('plugins.confirm', [
      review.stageId,
      {
        scope: identity
          ? { kind: 'identity', identityId: identity.id }
          : entry.projectId
            ? { kind: 'project', projectId: entry.projectId }
            : { kind: 'all' },
        includeScripts,
      },
    ])
    io.print(
      `Installed ${plugin.name}${identity ? ` for ${identity.name} projects` : entry.projectId && tool.project ? ` for ${tool.project.name}` : ''}.`,
    )
    for (const slot of plugin.credentials.filter((item) => item.state !== 'saved')) {
      const value = await io.secret(`${slot.label} for ${plugin.name} (leave empty to add it later): `)
      if (value)
        await call('plugins.setCredential', [plugin.id, slot.id, { token: value, fields: {} }]).then(
          () => io.print(`Saved ${slot.label}.`),
          (error: Error) => io.print(`${slot.label} was not saved: ${error.message}`),
        )
    }
    const servers = (await call<SharedMcpManagement>('mcp.status')).connections
    for (const server of plugin.mcpConnections) {
      const choices = tool.servers[server.name]
      const connection = servers.find((item) => item.connection.id === server.id)?.connection
      if (!choices || !connection) continue
      const logins = mcpLogins(await call<AppPreferences>('settings.app.get'), connection)
      if (logins.length)
        await call('mcp.turnOn', [server.id, logins, choices, 'off']).catch(() =>
          io.print(`Turn ${server.name}'s tools on once it can connect: Customize → MCP servers.`),
        )
    }
  } catch (error) {
    await call('plugins.cancel', [review.stageId]).catch(() => {})
    throw error
  }
}

async function installSkill(
  tool: Extract<PortableTool, { kind: 'skill' }>,
  projectId: string | null,
  call: ToolsCall,
  io: ToolsTerminal,
) {
  const here = (await call<LearningSnapshot>('learning.get')).skills.find(
    (skill) => skill.name === tool.name && (skill.projectId ?? null) === projectId,
  )
  if (!tool.source) {
    io.print(`${tool.name}: ${tool.description}\n\n${tool.content ?? ''}`)
    if (!(await io.confirm(`${here ? 'Replace your' : 'Add the'} skill ${tool.name} with this text?`))) return
    if (here && !here.installation)
      await call('skills.edit', [
        here.id,
        { description: tool.description, content: tool.content ?? '' },
        here.revision,
      ])
    else
      await call('skills.create', [
        { name: tool.name, description: tool.description, content: tool.content ?? '', projectId },
      ])
    io.print(`Saved ${tool.name}.`)
    return
  }
  const preview = await call<SkillInstallPreview>('skills.stage', [
    {
      source: tool.source,
      skill: tool.name,
      projectId,
      ...(here?.installation ? { updatingId: here.id } : {}),
    },
  ])
  io.print(
    `${preview.name}: ${preview.description}\nSource: ${preview.source}\nFiles: ${preview.files
      .map((file) => `${file.path}${file.script ? ' (script)' : ''}`)
      .join(', ')}`,
  )
  if (!(await io.confirm(`Install ${preview.name}?`))) {
    await call('skills.cancel', [preview.id])
    return
  }
  const scripts = preview.files.filter((file) => file.script)
  const include = scripts.length > 0 && (await io.confirm('Also copy its scripts? Ramu does not run them.'))
  await call('skills.confirm', [preview.id, include])
  io.print(`Installed ${preview.name}.`)
}

async function addServer(entry: WaitingTool, call: ToolsCall, io: ToolsTerminal) {
  const tool = entry.tool as Extract<PortableTool, { kind: 'mcp' }>
  const { transport } = tool
  const on = Object.entries(tool.tools).filter(([, choice]) => choice !== 'off')
  io.print(
    `${tool.name} from ${entry.from}\n${transport.type === 'http' ? transport.url : [transport.command, ...transport.args].join(' ')}\n${
      on.length
        ? `Tools on there: ${on.map(([name, choice]) => (choice === 'allow' ? name : `${name} (asks)`)).join(', ')}`
        : 'Its tools are chosen once it connects.'
    }`,
  )
  if (!(await io.confirm(`Add ${tool.name} here?`))) return
  const added = await call<{
    connection: SharedMcpConnection
    secrets: string[]
    connectHere: boolean
  }>('toolSync.addServer', [entry.key])
  for (const secret of added.secrets) {
    const value = await io.secret(`${secret} for ${tool.name} (leave empty to add it later): `)
    if (value)
      await call('mcp.setSecret', [added.connection.id, transport.type === 'http' ? 'header' : 'env', secret, value])
  }
  if (added.connectHere && transport.type === 'stdio') {
    io.print(
      `Added ${tool.name} turned off: install ${transport.command} here, then turn it on in Customize → MCP servers.`,
    )
    return
  }
  const turned = await turnOn(added.connection, call).catch((error: Error) => {
    io.print(`Added ${tool.name}; it could not turn on yet: ${error.message}`)
    return null
  })
  if (transport.type === 'http' && turned !== null) {
    const check = (await call<SharedMcpManagement | undefined>('mcp.status'))?.connections.find(
      (item) => item.connection.id === added.connection.id,
    )
    if (check?.status === 'sign-in-required' && (await io.confirm(`${tool.name} needs a sign-in. Sign in now?`)))
      await signIn(tool.name, call, io)
  }
  if (turned) io.print(`Added ${tool.name} and turned it on with the same tools as on ${entry.from}.`)
  else if (turned === false) io.print(`Added ${tool.name}. Sign in to a provider here, then turn it on.`)
}
